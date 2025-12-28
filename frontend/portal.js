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

function pageRole() {
  const shell = document.querySelector(".portal-shell");
  const role = shell ? String(shell.getAttribute("data-role") || "").trim().toLowerCase() : "";
  if (role === "teacher") return "teacher";
  if (role === "student") return "student";
  return "";
}

function isTeacherPath() {
  return window.location.pathname.startsWith("/teacher");
}

function teacherLoginUrl() {
  if (window.location.protocol === "file:") return "./teacher/login.html";
  return "/teacher/login";
}

function teacherDashboardUrl() {
  if (window.location.protocol === "file:") return "./teacher/dashboard.html";
  return "/teacher/dashboard";
}

function teacherClassroomUrl(classroomId) {
  const id = encodeURIComponent(String(classroomId || "").trim());
  if (window.location.protocol === "file:") return `./teacher/classroom.html?id=${id}`;
  return `/teacher/classroom?id=${id}`;
}

function studentLoginUrl() {
  if (window.location.protocol === "file:") return "./index.html";
  return "/";
}

function studentDashboardUrl() {
  if (window.location.protocol === "file:") return "./dashboard.html";
  return "/dashboard";
}

function initBackgroundVideo() {
  const video = document.querySelector(".video-bg__media");
  if (!video || typeof video.play !== "function") return;

  video.muted = true;
  video.playsInline = true;
  video.loop = true;
  video.autoplay = true;

  const tryPlay = async () => {
    if (document.hidden) return;
    try {
      await video.play();
    } catch {
      // ignore (autoplay policies / background throttling)
    }
  };

  video.addEventListener("canplay", tryPlay);
  video.addEventListener("pause", tryPlay);
  document.addEventListener("visibilitychange", tryPlay);
  window.addEventListener("focus", tryPlay);
  window.addEventListener("pageshow", tryPlay);

  tryPlay();
}

function routeGuards() {
  if (window.location.protocol === "file:") return true;

  const session = getSession();
  const kind = pageKind();
  const sessionRole = String(session?.user?.role || "").trim().toLowerCase();

  if (kind === "dashboard" && !session?.token) {
    window.location.replace(isTeacherPath() ? teacherLoginUrl() : studentLoginUrl());
    return false;
  }

  if (kind === "auth" && session?.token) {
    window.location.replace(sessionRole === "teacher" ? teacherDashboardUrl() : studentDashboardUrl());
    return false;
  }

  if (kind === "dashboard" && session?.token) {
    const expected = pageRole();
    if (expected === "teacher" && sessionRole !== "teacher") {
      window.location.replace(studentDashboardUrl());
      return false;
    }
    if (expected === "student" && sessionRole === "teacher") {
      window.location.replace(teacherDashboardUrl());
      return false;
    }
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
      window.location.replace(isTeacherPath() ? teacherLoginUrl() : studentLoginUrl());
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
      window.location.href = isTeacherPath() ? teacherLoginUrl() : studentLoginUrl();
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

function renderTeacherClassrooms(container, items) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No classrooms yet.";
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "tile-grid tile-grid--compact tile-grid--rows";

  for (const c of items) {
    const tile = document.createElement("a");
    tile.className = "tile tile--compact tile--row";
    tile.href = teacherClassroomUrl(c.id);
    tile.setAttribute("aria-label", `Open classroom: ${String(c.name || "Untitled")}`);

    const left = document.createElement("div");
    left.className = "tile__left";

    const kicker = document.createElement("p");
    kicker.className = "tile__kicker";
    kicker.textContent = "Classroom";

    const title = document.createElement("h3");
    title.className = "tile__title";
    title.textContent = String(c.name || "Untitled");

    const section = String(c.section || "").trim();
    if (section) {
      const sectionEl = document.createElement("p");
      sectionEl.className = "tile__text";
      sectionEl.textContent = section;
      left.appendChild(kicker);
      left.appendChild(title);
      left.appendChild(sectionEl);
    } else {
      left.appendChild(kicker);
      left.appendChild(title);
    }

    const right = document.createElement("div");
    right.className = "tile__right";

    const joinLabel = document.createElement("p");
    joinLabel.className = "tile__meta";
    joinLabel.textContent = "Join code";

    const joinCode = String(c.joinCode || "").trim();
    const joinValue = document.createElement("p");
    joinValue.className = "tile__code";
    joinValue.textContent = joinCode || "—";

    right.appendChild(joinLabel);
    right.appendChild(joinValue);

    tile.appendChild(left);
    tile.appendChild(right);
    grid.appendChild(tile);
  }

  container.appendChild(grid);
}

async function loadTeacherClassrooms() {
  const container = document.querySelector("[data-classrooms-list]");
  if (!container) return;

  try {
    const data = await apiFetch("/api/classrooms");
    renderTeacherClassrooms(container, data?.items || []);
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load classrooms.";
    container.appendChild(msg);
  }
}

async function loadTeacherClassroomDetails() {
  const nameEl = document.querySelector("[data-classroom-name]");
  const metaEl = document.querySelector("[data-classroom-meta]");
  const titleEl = document.querySelector("[data-classroom-title]");
  const termEl = document.querySelector("[data-classroom-term]");
  if (!nameEl || !metaEl) return;

  const params = new URLSearchParams(window.location.search);
  const id = String(params.get("id") || "").trim();
  if (!id) {
    nameEl.textContent = "Missing classroom id";
    metaEl.textContent = "";
    return;
  }

  try {
    const data = await apiFetch(`/api/classrooms/${encodeURIComponent(id)}`);
    const c = data?.item;
    if (!c) throw new Error("Not found");
    const className = String(c.name || "Untitled");
    nameEl.textContent = className;
    if (titleEl) titleEl.textContent = className;
    const section = String(c.section || "").trim();
    const joinCode = String(c.joinCode || "").trim();
    metaEl.textContent = `${section ? `${section} • ` : ""}Join code: ${joinCode || "—"}`;
    if (termEl) termEl.textContent = section || " ";
  } catch (err) {
    nameEl.textContent = "Classroom not found";
    metaEl.textContent = err?.status === 403 ? "Forbidden" : "";
    if (titleEl) titleEl.textContent = "Classroom";
    if (termEl) termEl.textContent = "";
  }
}

function initTeacherClassroomTabs() {
  const links = Array.from(document.querySelectorAll("[data-classroom-tab]"));
  if (links.length === 0) return;

  const panels = new Map();
  document.querySelectorAll("[data-classroom-panel]").forEach((el) => {
    panels.set(String(el.getAttribute("data-classroom-panel") || ""), el);
  });

  const setActive = (tab) => {
    for (const a of links) {
      const t = String(a.getAttribute("data-classroom-tab") || "");
      a.classList.toggle("is-active", t === tab);
    }
    for (const [t, el] of panels.entries()) {
      el.hidden = t !== tab;
    }
    window.dispatchEvent(new CustomEvent("blair:classroomTab", { detail: { tab } }));
  };

  const initial = String((window.location.hash || "").replace(/^#/, "") || "home");
  setActive(panels.has(initial) ? initial : "home");

  for (const a of links) {
    a.addEventListener("click", (e) => {
      e.preventDefault();
      const tab = String(a.getAttribute("data-classroom-tab") || "home");
      window.location.hash = tab;
      setActive(tab);
    });
  }

  window.addEventListener("hashchange", () => {
    const tab = String((window.location.hash || "").replace(/^#/, "") || "home");
    if (panels.has(tab)) setActive(tab);
  });
}

function renderClassroomAnnouncements(container, items) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No announcements yet.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "feed";

  for (const a of items) {
    const item = document.createElement("div");
    item.className = "feed__item";

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    const when = formatShortDate(a.createdAt);
    meta.textContent = when ? when : "Announcement";

    const title = document.createElement("h3");
    title.className = "feed__title";
    title.textContent = String(a.title || "Announcement");

    const body = document.createElement("p");
    body.className = "feed__text";
    body.textContent = String(a.body || "");

    item.appendChild(meta);
    item.appendChild(title);
    item.appendChild(body);
    list.appendChild(item);
  }

  container.appendChild(list);
}

function currentClassroomIdFromQuery() {
  const params = new URLSearchParams(window.location.search);
  return String(params.get("id") || "").trim();
}

async function loadClassroomAnnouncements() {
  const container = document.querySelector("[data-classroom-announcements]");
  if (!container) return;

  const id = currentClassroomIdFromQuery();
  if (!id) {
    container.innerHTML = "";
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "Missing classroom id.";
    container.appendChild(empty);
    return;
  }

  try {
    const data = await apiFetch(
      `/api/classrooms/${encodeURIComponent(id)}/announcements?limit=50`
    );
    renderClassroomAnnouncements(container, data?.items || []);
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load announcements.";
    container.appendChild(msg);
  }
}

function initClassroomAnnouncementComposer() {
  const form = document.querySelector("form[data-classroom-announce]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFormError(form, "");
    setFormSuccess(form, "");

    const id = currentClassroomIdFromQuery();
    if (!id) {
      setFormError(form, "Missing classroom id.");
      return;
    }

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const title = String(payload.title || "").trim();
    const body = String(payload.body || "").trim();

    if (!body) {
      setFormError(form, "Message is required.");
      return;
    }

    try {
      await apiFetch(`/api/classrooms/${encodeURIComponent(id)}/announcements`, {
        method: "POST",
        body: JSON.stringify({ title, body }),
      });
      form.reset();
      setFormSuccess(form, "Posted.");
      await loadClassroomAnnouncements();
    } catch (err) {
      if (err?.status === 403) {
        setFormError(form, "Only teachers can post announcements.");
        return;
      }
      setFormError(form, err?.message || "Failed to post.");
    }
  });
}

function initTeacherClassroomCreate() {
  const form = document.querySelector("form[data-classroom-create]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFormError(form, "");
    setFormSuccess(form, "");

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const name = String(payload.name || "").trim();
    const section = String(payload.section || "").trim();

    if (!name) {
      setFormError(form, "Class name is required.");
      return;
    }

    try {
      const data = await apiFetch("/api/classrooms", {
        method: "POST",
        body: JSON.stringify({ name, section }),
      });
      const item = data?.item;
      form.reset();
      setFormSuccess(
        form,
        item?.joinCode ? `Created. Join code: ${item.joinCode}` : "Created."
      );
      await loadTeacherClassrooms();
    } catch (err) {
      if (err?.status === 403) {
        setFormError(form, "Only teachers can create classrooms.");
        return;
      }
      setFormError(form, err?.message || "Failed to create classroom.");
    }
  });
}

async function handleAuthSubmit(form) {
  const mode = form.getAttribute("data-auth");
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  setFormError(form, "");
  setFormSuccess(form, "");

  try {
    if (mode === "signup" || mode === "teacher-signup") {
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

    const path =
      mode === "signup"
        ? "/api/auth/signup"
        : mode === "teacher-signup"
          ? "/api/auth/teacher/signup"
          : mode === "teacher-login"
            ? "/api/auth/teacher/login"
            : "/api/auth/login";
    const body = await apiFetch(path, { method: "POST", body: JSON.stringify(payload) });

    if (!body || typeof body !== "object") {
      throw new Error("Unexpected response from server");
    }

    const token = body.token;
    const user = body.user || { name: payload.name || payload.email, role: "student" };

    if (!token) {
      throw new Error("Missing token in response");
    }

    setSession({ token, user });
    if (window.location.protocol === "file:") {
      window.location.href = user?.role === "teacher" ? "./teacher/dashboard.html" : "./dashboard.html";
    } else {
      window.location.href = user?.role === "teacher" ? "/teacher/dashboard" : "/dashboard";
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
  initBackgroundVideo();

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

  if (pageKind() === "dashboard" && pageRole() === "teacher") {
    initTeacherClassroomCreate();
    loadTeacherClassrooms();
  }

  if (pageKind() === "dashboard" && pageRole() === "teacher") {
    initTeacherClassroomTabs();
    loadTeacherClassroomDetails();
  }

  if (pageKind() === "dashboard" && pageRole() === "teacher") {
    initClassroomAnnouncementComposer();

    const maybeLoad = () => {
      if (window.location.pathname.endsWith("/classroom") || window.location.pathname.endsWith("/classroom.html")) {
        const tab = String((window.location.hash || "").replace(/^#/, "") || "home");
        if (tab === "announcements") loadClassroomAnnouncements();
      }
    };

    window.addEventListener("blair:classroomTab", (e) => {
      const tab = e?.detail?.tab;
      if (tab === "announcements") loadClassroomAnnouncements();
    });

    // Load on first visit if the hash is already #announcements
    maybeLoad();
  }
}
