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
  return localStorage.getItem("blair.portal.apiBaseUrl") || "http://localhost:3001";
}

function currentPage() {
  const raw = window.location.pathname.split("/").pop();
  return raw || "index.html";
}

function isAuthPage(page) {
  return (
    page === "login.html" ||
    page === "signup.html" ||
    page === "forgot-password.html" ||
    page === "reset-password.html"
  );
}

function isDashboardPage(page) {
  return page === "index.html";
}

function routeGuards() {
  if (window.location.protocol === "file:") return true;

  const page = currentPage();
  const session = getSession();

  if (isDashboardPage(page) && !session?.token) {
    window.location.replace("./login.html");
    return false;
  }

  if (isAuthPage(page) && session?.token) {
    window.location.replace("./index.html");
    return false;
  }

  return true;
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
      window.location.href = "./login.html";
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
        window.location.href = "./login.html";
      }, 900);
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
    window.location.href = "./index.html";
  } catch (err) {
    const msg =
      err?.message ||
      "Login/signup failed. Start your backend auth server and try again.";
    setFormError(form, `${msg} (API: ${apiBaseUrl()})`);
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

if (routeGuards()) {
  initHeaderAuthUi();
  initSidebarToggle();
  initUserMenu();
  initAuthForms();
  initResetToken();
}
