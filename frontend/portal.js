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
  const authLinkEl = document.querySelector("[data-auth-link]");
  const logoutBtn = document.querySelector("[data-logout]");

  if (userNameEl) userNameEl.textContent = session?.user?.name || "Guest";
  if (greetingEl) greetingEl.textContent = session?.user?.name || "Student";

  if (authLinkEl) {
    authLinkEl.hidden = !!session?.token;
  }
  if (logoutBtn) {
    logoutBtn.hidden = !session?.token;
    logoutBtn.addEventListener("click", () => {
      clearSession();
      window.location.href = "./index.html";
    });
  }
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

function setFormError(form, message) {
  const errorEl = form.querySelector("[data-form-error]");
  if (!errorEl) return;
  errorEl.hidden = !message;
  errorEl.textContent = message || "";
}

async function handleAuthSubmit(form) {
  const mode = form.getAttribute("data-auth");
  const formData = new FormData(form);
  const payload = Object.fromEntries(formData.entries());

  setFormError(form, "");

  try {
    const path = mode === "signup" ? "/api/auth/signup" : "/api/auth/login";
    const body = await apiFetch(path, {
      method: "POST",
      body: JSON.stringify(payload),
    });

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

initHeaderAuthUi();
initSidebarToggle();
initAuthForms();

