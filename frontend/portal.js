const STORAGE_KEY = "blair.portal.session";

function getSession() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function setSession(session) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function apiBaseUrl() {
  const override = localStorage.getItem("blair.portal.apiBaseUrl");
  if (override) {
    const cleaned = String(override).trim().replace(/\/+$/, "");
    const isAbsolute = /^https?:\/\//i.test(cleaned);
    const origin = typeof window !== "undefined" ? window.location.origin : "";
    const sameOrigin =
      Boolean(origin) && origin !== "null" && isAbsolute && cleaned.startsWith(origin);

    // If someone accidentally points the API at the same origin (Vercel static site),
    // it will try to call `/api/*` on the frontend and fail (often 401/404).
    // Auto-clear obviously bad overrides and fall back to config.js.
    if (!isAbsolute || sameOrigin) {
      localStorage.removeItem("blair.portal.apiBaseUrl");
    } else {
      return cleaned;
    }
  }

  const cfg = window.__BLAIR_CONFIG__ && typeof window.__BLAIR_CONFIG__ === "object"
    ? window.__BLAIR_CONFIG__
    : null;
  if (cfg && typeof cfg.apiBaseUrl === "string" && cfg.apiBaseUrl.trim()) {
    return cfg.apiBaseUrl.trim().replace(/\/+$/, "");
  }

  return "http://localhost:3001";
}

function currentPage() {
  const raw = window.location.pathname.split("/").pop();
  return raw || "index.html";
}

function pageKind() {
  if (document.querySelector(".portal-shell")) return "dashboard";
  if (document.querySelector("form[data-auth]")) return "auth";
  return "other";
}

function routeGuards() {
  if (window.location.protocol === "file:") return true;

  const session = getSession();
  const kind = pageKind();

  if (kind === "dashboard" && !session?.token) {
    window.location.replace("/");
    return false;
  }

  if (kind === "auth" && session?.token) {
    window.location.replace("/dashboard");
    return false;
  }

  return true;
}

async function validateSessionAndAutoLogout() {
  const session = getSession();
  if (!session?.token) return;
  if (pageKind() !== "dashboard") return;

  try {
    await apiFetch("/api/auth/me");
  } catch (err) {
    if (err?.status === 401) {
      clearSession();
      window.location.replace("/");
    }
  }
}

async function apiFetch(path, options = {}) {
  const session = getSession();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  if (session?.token) headers.set("Authorization", `Bearer ${session.token}`);

  const res = await fetch(`${apiBaseUrl()}${path}`, {
    ...options,
    headers,
  });

  let body = null;
  const contentType = res.headers.get("content-type") || "";
  if (contentType.includes("application/json")) {
    body = await res.json().catch(() => null);
  } else {
    body = await res.text().catch(() => null);
  }

  if (!res.ok) {
    const message =
      (body && typeof body === "object" && body.error) ||
      (body && typeof body === "object" && body.message) ||
      `Request failed (${res.status})`;
    const err = new Error(message);
    err.status = res.status;
    err.body = body;
    const retryAfter = res.headers.get("retry-after");
    if (retryAfter) err.retryAfterSeconds = Number(retryAfter) || null;
    throw err;
  }

  return body;
}

function setText(selector, value) {
  const el = document.querySelector(selector);
  if (el) el.textContent = value;
}

function initHeaderAuthUi() {
  const session = getSession();

  const userNameEl = document.querySelector("[data-user-name]");
  const greetingEl = document.querySelector("[data-user-greeting]");

  if (userNameEl) userNameEl.textContent = session?.user?.name || "Student";
  if (greetingEl) greetingEl.textContent = session?.user?.name || "Student";
}

function initSidebarToggle() {
  const toggle = document.querySelector(".sidebar-toggle");
  const sidebar = document.querySelector(".portal-sidebar");
  if (!toggle || !sidebar) return;

  toggle.addEventListener("click", () => {
    const isOpen = sidebar.classList.toggle("is-open");
    toggle.setAttribute("aria-expanded", isOpen ? "true" : "false");
  });
}

function initUserMenu() {
  const button = document.querySelector("[data-user-menu-button]");
  const menu = document.querySelector("[data-user-menu]");
  const logoutBtn = document.querySelector("[data-logout]");
  if (!button || !menu) return;

  const close = () => {
    menu.hidden = true;
    button.setAttribute("aria-expanded", "false");
  };

  const open = () => {
    menu.hidden = false;
    button.setAttribute("aria-expanded", "true");
  };

  button.addEventListener("click", (e) => {
    e.stopPropagation();
    if (menu.hidden) open();
    else close();
  });

  document.addEventListener("click", () => close());
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") close();
  });

  if (logoutBtn) {
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "/";
    });
  }
}

function setFormError(form, message) {
  const errorEl = form.querySelector("[data-form-error]");
  if (!errorEl) return;
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

function setFormSuccess(form, message) {
  const successEl = form.querySelector("[data-form-success]");
  if (!successEl) return;
  successEl.hidden = !message;
  successEl.textContent = message || "";
}

async function handleAuthSubmit(form) {
  const mode = form.getAttribute("data-auth");
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  setFormError(form, "");
  setFormSuccess(form, "");

  try {
    if (mode === "signup") {
      const firstName = String(payload.firstName || "").trim();
      const lastName = String(payload.lastName || "").trim();
      const signupCode = String(payload.signupCode || "").trim();
      if (!firstName || !lastName) {
        throw new Error("First and last name are required.");
      }
      if (!signupCode) {
        throw new Error("Sign up code is required.");
      }
      payload.name = `${firstName} ${lastName}`.trim();
      delete payload.firstName;
      delete payload.lastName;
    }

    if (mode === "forgot") {
      await apiFetch("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: payload.email }),
      });
      setFormSuccess(
        form,
        "If that email exists, a reset link has been sent. Check your inbox."
      );
      return;
    }

    if (mode === "reset") {
      if (!payload.token) throw new Error("Missing reset token");
      if (!payload.password || String(payload.password).length < 8) {
        throw new Error("Password must be at least 8 characters");
      }
      if (payload.password !== payload.confirmPassword) {
        throw new Error("Passwords do not match");
      }

      await apiFetch("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token: payload.token, password: payload.password }),
      });

      setFormSuccess(form, "Password updated. You can now log in.");
      setTimeout(() => {
        window.location.href = "/";
      }, 900);
      return;
    }

    if (mode === "change-password") {
      const currentPassword = String(payload.currentPassword || "");
      const newPassword = String(payload.newPassword || "");
      const confirm = String(payload.confirmNewPassword || "");

      if (!currentPassword) throw new Error("Current password is required");
      if (!newPassword || newPassword.length < 8) {
        throw new Error("New password must be at least 8 characters");
      }
      if (newPassword !== confirm) throw new Error("New passwords do not match");

      await apiFetch("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword, newPassword }),
      });

      form.reset();
      setFormSuccess(form, "Password updated.");
      return;
    }

    const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const body = await apiFetch(path, { method: "POST", body: JSON.stringify(payload) });

    if (!body || typeof body !== "object") {
      throw new Error("Unexpected response from server");
    }

    const token = body.token;
    const user = body.user || { name: payload.name || payload.email };

    if (!token) {
      throw new Error("Missing token in response");
    }

    setSession({ token, user });
    if (window.location.protocol === "file:") {
      window.location.href = "./dashboard.html";
    } else {
      window.location.href = "/dashboard";
    }
  } catch (err) {
    if (err?.status === 429) {
      const retry =
        typeof err.retryAfterSeconds === "number" && err.retryAfterSeconds > 0
          ? ` Try again in ${err.retryAfterSeconds}s.`
          : " Try again in a bit.";
      setFormError(form, `Too many attempts.${retry}`);
      return;
    }

    if (err?.status === 409 && mode === "signup") {
      setFormError(form, "That email is already in use. Try logging in instead.");
      return;
    }

    if (err?.status === 401 && mode === "signup") {
      setFormError(form, "Invalid sign up code.");
      return;
    }

    if (err?.status === 401 && mode === "login") {
      setFormError(form, "Invalid email or password.");
      return;
    }

    if (err?.status === 401 && mode === "reset") {
      setFormError(form, "That reset link is invalid or expired. Request a new one.");
      return;
    }

    // Helpful hint if the API base URL is still pointing to localhost / not configured.
    const base = apiBaseUrl();
    const baseMisconfigured =
      base.includes("localhost") || base.includes("127.0.0.1") || base === "";

    const msg = err?.message || "Request failed.";
    setFormError(
      form,
      baseMisconfigured
        ? `${msg} Set your deployed API URL in frontend/config.js (or localStorage blair.portal.apiBaseUrl).`
        : `${msg}`
    );
  }
}

function initAuthForms() {
  document.querySelectorAll("form[data-auth]").forEach((form) => {
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      handleAuthSubmit(form);
    });
  });
}

function initResetToken() {
  const tokenInput = document.querySelector("[data-reset-token]");
  if (!tokenInput) return;
  const params = new URLSearchParams(window.location.search);
  const token = params.get("token") || "";
  tokenInput.value = token;
}

function formatShortDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(date);
}

function renderAnnouncements(container, items, { variant }) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No announcements yet.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className =
    variant === "preview"
      ? "announcement-list announcement-list--preview"
      : "announcement-list";

  for (const item of items) {
    const row = document.createElement("article");
    row.className = "announcement";

    const meta = document.createElement("p");
    meta.className = "announcement__meta";
    const when = formatShortDate(item.createdAt);
    meta.textContent = when ? `${when} • Announcement` : "Announcement";

    const title = document.createElement("h3");
    title.className = "announcement__title";
    title.textContent = String(item.title || "Announcement");

    const body = document.createElement("p");
    body.className = "announcement__body";
    body.textContent = String(item.body || "");

    row.appendChild(meta);
    row.appendChild(title);
    row.appendChild(body);
    list.appendChild(row);
  }

  container.appendChild(list);
}

async function loadAnnouncements(target, { limit, variant }) {
  const container = document.querySelector(target);
  if (!container) return;

  const empty = container.querySelector("[data-announcements-empty]");
  if (empty) empty.textContent = "Loading…";

  try {
    const data = await apiFetch(
      `/api/announcements?limit=${encodeURIComponent(String(limit))}`
    );
    const items = (data && data.items) || [];
    renderAnnouncements(container, items, { variant });
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load announcements.";
    container.appendChild(msg);
  }
}

function initAnnouncements() {
  if (document.querySelector("[data-announcements-preview]")) {
    loadAnnouncements("[data-announcements-preview]", { limit: 3, variant: "preview" });
  }
  if (document.querySelector("[data-announcements-list]")) {
    loadAnnouncements("[data-announcements-list]", { limit: 50, variant: "list" });
  }
}

function initPasswordToggles() {
  document.querySelectorAll("[data-password-toggle]").forEach((button) => {
    const field = button.closest(".field");
    const input = field ? field.querySelector("input") : null;
    if (!input) return;

    const setState = (visible) => {
      input.type = visible ? "text" : "password";
      button.textContent = visible ? "Hide" : "Show";
      button.setAttribute("aria-pressed", visible ? "true" : "false");
      button.setAttribute("aria-label", visible ? "Hide password" : "Show password");
    };

    setState(false);

    button.addEventListener("click", () => {
      setState(input.type !== "text");
      input.focus({ preventScroll: true });
    });
  });
}

if (routeGuards()) {
  validateSessionAndAutoLogout();
  // Keep sessions in sync if an admin deletes the account while the user is logged in.
  if (pageKind() === "dashboard") {
    setInterval(validateSessionAndAutoLogout, 60_000);
    window.addEventListener("focus", validateSessionAndAutoLogout);
  }

  initHeaderAuthUi();
  initSidebarToggle();
  initUserMenu();
  initAuthForms();
  initResetToken();
  initPasswordToggles();
  initAnnouncements();
}
