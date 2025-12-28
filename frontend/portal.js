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

function readSessionCache(key) {
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (_err) {
    return null;
  }
}

function writeSessionCache(key, value) {
  try {
    sessionStorage.setItem(key, JSON.stringify(value));
  } catch (_err) {
    // ignore
  }
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

function studentClassroomUrl(classroomId) {
  const id = encodeURIComponent(String(classroomId || "").trim());
  if (window.location.protocol === "file:") return `./classroom.html?id=${id}`;
  return `/classroom?id=${id}`;
}

function studentAssignmentUrl({ classroomId, assignmentId }) {
  const cid = encodeURIComponent(String(classroomId || "").trim());
  const aid = encodeURIComponent(String(assignmentId || "").trim());
  if (window.location.protocol === "file:") return `./assignment.html?classroomId=${cid}&assignmentId=${aid}`;
  return `/assignment?classroomId=${cid}&assignmentId=${aid}`;
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
    metaEl.textContent = `${section ? `${section} - ` : ""}Join code: ${joinCode || "—"}`;
    if (termEl) termEl.textContent = section || " ";
  } catch (err) {
    nameEl.textContent = "Classroom not found";
    metaEl.textContent = err?.status === 403 ? "Forbidden" : "";
    if (titleEl) titleEl.textContent = "Classroom";
    if (termEl) termEl.textContent = "";
  }
}

async function loadStudentClassroomDetails() {
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
    const data = await apiFetch(`/api/student/classrooms/${encodeURIComponent(id)}`);
    const c = data?.item;
    if (!c) throw new Error("Not found");
    const className = String(c.name || "Untitled");
    nameEl.textContent = className;
    if (titleEl) titleEl.textContent = className;
    const section = String(c.section || "").trim();
    metaEl.textContent = section ? section : "";
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

function renderClassroomAnnouncements(container, items, { showDelete = false } = {}) {
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
    item.setAttribute("data-announcement-id", String(a.id || ""));

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    const when = formatShortDate(a.createdAt);
    meta.textContent = when ? when : "Announcement";

    const title = document.createElement("h3");
    title.className = "feed__title";
    title.textContent = String(a.title || "Announcement");

    const body = document.createElement("p");
    body.className = "feed__text";
    setTextWithLinks(body, String(a.body || ""));

    let actions = null;
    if (showDelete) {
      actions = document.createElement("div");
      actions.className = "feed__actions";

      const del = document.createElement("button");
      del.type = "button";
      del.className = "btn btn--danger";
      del.textContent = "Delete";
      del.setAttribute("data-announcement-delete", String(a.id || ""));
      actions.appendChild(del);
    }

    item.appendChild(meta);
    item.appendChild(title);
    item.appendChild(body);
    if (actions) item.appendChild(actions);
    list.appendChild(item);
  }

  container.appendChild(list);
}

// Override student grade view with a more realistic system:
// - Weighted categories
// - Missing/late/excused statuses
// - Late penalty based on settings and submission time
function renderStudentGrades(container, payload) {
  container.innerHTML = "";

  const assignments = Array.isArray(payload?.assignments) ? payload.assignments : [];
  const grades = Array.isArray(payload?.grades) ? payload.grades : [];
  const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
  const settings = payload?.settings || {};

  const categories = Array.isArray(settings?.categories) ? settings.categories : [];
  const perDayPct = Number(settings?.latePenaltyPerDayPct) || 0;
  const maxPct = Number(settings?.maxLatePenaltyPct) || 0;

  const gradeByAssignment = new Map(grades.map((g) => [String(g.assignmentId || ""), g]));
  const latestSubmissionByAssignment = new Map();
  for (const s of submissions) {
    const aid = String(s.assignmentId || "").trim();
    if (!aid) continue;
    if (!latestSubmissionByAssignment.has(aid)) latestSubmissionByAssignment.set(aid, s);
  }

  const percentToLetter = (pct) => {
    if (!Number.isFinite(pct)) return "";
    if (pct >= 93) return "A";
    if (pct >= 90) return "A-";
    if (pct >= 87) return "B+";
    if (pct >= 83) return "B";
    if (pct >= 80) return "B-";
    if (pct >= 77) return "C+";
    if (pct >= 73) return "C";
    if (pct >= 70) return "C-";
    if (pct >= 67) return "D+";
    if (pct >= 63) return "D";
    if (pct >= 60) return "D-";
    return "F";
  };

  if (assignments.length === 0) {
    container.innerHTML = `<p class="empty-state">No assignments yet.</p>`;
    return;
  }

  const now = Date.now();
  const computed = assignments.map((a) => {
    const id = String(a.id || "");
    const g = gradeByAssignment.get(id) || null;
    const submission = latestSubmissionByAssignment.get(id) || null;

    const pointsMax = Number(String(a.points || "").trim());
    const hasPoints = Number.isFinite(pointsMax) && pointsMax > 0;
    const earnedRaw = g && g.pointsEarned !== null && g.pointsEarned !== undefined ? Number(g.pointsEarned) : null;
    const status = String(g?.status || "").trim().toLowerCase() || "";

    const due = a.dueAt ? new Date(a.dueAt) : null;
    const dueMs = due && !Number.isNaN(due.getTime()) ? due.getTime() : null;
    const derivedMissing = !g && hasPoints && dueMs !== null && dueMs < now && !submission;

    let finalStatus = status || (derivedMissing ? "missing" : earnedRaw !== null ? "graded" : "ungraded");
    if (!["graded", "late", "missing", "excused", "ungraded"].includes(finalStatus)) finalStatus = "ungraded";

    let earned = earnedRaw;
    if (finalStatus === "excused") earned = null;
    if (finalStatus === "missing") earned = 0;

    let adjustedEarned = earned;
    let daysLate = 0;
    if (finalStatus === "late" && earned !== null) {
      const override =
        g?.lateDaysOverride !== null && g?.lateDaysOverride !== undefined ? Number(g.lateDaysOverride) : null;
      daysLate = Number.isFinite(override)
        ? Math.max(0, Math.floor(override))
        : computeDaysLate({ dueAt: a.dueAt, submittedAt: submission?.createdAt });
      adjustedEarned = applyLatePenalty({ earned, daysLate, perDayPct, maxPct });
    }

    return {
      assignment: a,
      grade: g,
      submission,
      pointsMax: hasPoints ? pointsMax : null,
      earned,
      adjustedEarned,
      status: finalStatus,
      daysLate,
    };
  });

  const totalsByCategory = new Map();
  for (const item of computed) {
    const cat = String(item.assignment.category || "Homework").trim() || "Homework";
    const t = totalsByCategory.get(cat) || { earned: 0, possible: 0 };

    if (item.pointsMax !== null && item.status !== "excused") {
      if (item.status === "missing") {
        t.possible += item.pointsMax;
      } else if (item.earned !== null) {
        t.earned += Number(item.adjustedEarned) || 0;
        t.possible += item.pointsMax;
      }
    }

    totalsByCategory.set(cat, t);
  }

  const catWeights = new Map(categories.map((c) => [String(c.name || "").trim(), Number(c.weightPct) || 0]));
  let activeWeightSum = 0;
  let weightedSum = 0;

  for (const [cat, totals] of totalsByCategory.entries()) {
    if (!(totals.possible > 0)) continue;
    const w = catWeights.get(cat) ?? 0;
    activeWeightSum += w;
    const pct = (totals.earned / totals.possible) * 100;
    weightedSum += pct * w;
  }

  const overallPct = activeWeightSum > 0 ? Math.round((weightedSum / activeWeightSum) * 10) / 10 : null;
  const overallLetter = overallPct !== null ? percentToLetter(overallPct) : "";

  const summary = document.createElement("div");
  summary.className = "grade-summary";

  const header = document.createElement("div");
  header.className = "grade-summary__header";

  const h = document.createElement("h3");
  h.className = "grade-summary__title";
  h.textContent = "Current grade";

  const sub = document.createElement("p");
  sub.className = "grade-summary__meta";
  const gradedCount = computed.filter((i) => i.earned !== null && i.status !== "ungraded").length;
  sub.textContent = gradedCount ? `${gradedCount} graded` : "No grades yet.";

  header.appendChild(h);
  header.appendChild(sub);
  summary.appendChild(header);

  const body = document.createElement("div");
  body.className = "grade-summary__body";

  const big = document.createElement("p");
  big.className = "grade-summary__big";
  big.textContent = overallPct === null ? "—" : `${overallPct}% - ${overallLetter}`;
  body.appendChild(big);

  summary.appendChild(body);
  container.appendChild(summary);

  const breakdown = document.createElement("div");
  breakdown.className = "grade-breakdown";

  const bdTitle = document.createElement("h4");
  bdTitle.className = "grade-breakdown__title";
  bdTitle.textContent = "Category breakdown";
  breakdown.appendChild(bdTitle);

  const bdList = document.createElement("div");
  bdList.className = "grade-breakdown__list";

  for (const c of categories) {
    const name = String(c.name || "").trim();
    const w = Number(c.weightPct) || 0;
    const totals = totalsByCategory.get(name) || { earned: 0, possible: 0 };
    const pct = totals.possible > 0 ? Math.round((totals.earned / totals.possible) * 1000) / 10 : null;

    const row = document.createElement("div");
    row.className = "grade-breakdown__row";
    row.textContent = pct === null ? `${name} (${w}%): —` : `${name} (${w}%): ${pct}%`;
    bdList.appendChild(row);
  }

  breakdown.appendChild(bdList);
  container.appendChild(breakdown);

  const list = document.createElement("div");
  list.className = "feed";

  for (const item of computed) {
    const a = item.assignment;
    const row = document.createElement("div");
    row.className = "feed__item";

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    const cat = String(a.category || "Homework").trim() || "Homework";
    const points = item.pointsMax !== null ? `${item.pointsMax} pts` : "";
    meta.textContent = [cat, points].filter(Boolean).join(" - ");

    const title = document.createElement("h3");
    title.className = "feed__title";
    title.textContent = String(a.title || "Assignment");

    const text = document.createElement("p");
    text.className = "feed__text";

    if (item.status === "excused") {
      text.textContent = "Excused.";
    } else if (item.status === "missing") {
      text.textContent = "Missing (0).";
    } else if (item.earned === null) {
      text.textContent = "Not graded yet.";
    } else if (item.pointsMax !== null) {
      const pct = Math.round((Number(item.adjustedEarned) / item.pointsMax) * 1000) / 10;
      const letter = percentToLetter(pct);
      const lateNote = item.status === "late" ? ` (late - ${item.daysLate} days)` : "";
      text.textContent = `Score: ${item.adjustedEarned} / ${item.pointsMax} (${pct}% - ${letter})${lateNote}`;
    } else {
      text.textContent = `Score: ${item.adjustedEarned}`;
    }

    row.appendChild(meta);
    row.appendChild(title);
    row.appendChild(text);

    if (item.grade && item.grade.feedback) {
      const fb = document.createElement("p");
      fb.className = "feed__text";
      fb.textContent = `Feedback: ${String(item.grade.feedback)}`;
      row.appendChild(fb);
    }

    list.appendChild(row);
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
    renderClassroomAnnouncements(container, data?.items || [], { showDelete: true });
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load announcements.";
    container.appendChild(msg);
  }
}

async function loadStudentClassroomAnnouncements() {
  const container = document.querySelector("[data-classroom-announcements]");
  if (!container) return;

  const id = currentClassroomIdFromQuery();
  if (!id) return;

  try {
    const data = await apiFetch(
      `/api/student/classrooms/${encodeURIComponent(id)}/announcements?limit=50`
    );
    renderClassroomAnnouncements(container, data?.items || [], { showDelete: false });
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load announcements.";
    container.appendChild(msg);
  }
}

async function loadStudentClassroomRecentActivity() {
  const container = document.querySelector("[data-classroom-recent]");
  if (!container) return;

  const id = currentClassroomIdFromQuery();
  if (!id) return;

  try {
    const data = await apiFetch(
      `/api/student/classrooms/${encodeURIComponent(id)}/announcements?limit=5`
    );
    renderClassroomAnnouncements(container, data?.items || [], { showDelete: false });
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load recent activity.";
    container.appendChild(msg);
  }
}

function renderStudentModules(container, modules, classroomId) {
  container.innerHTML = "";

  if (!Array.isArray(modules) || modules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No modules yet.";
    container.appendChild(empty);
    return;
  }

  for (const m of modules) {
    const card = document.createElement("div");
    card.className = "module-card";

    const header = document.createElement("div");
    header.className = "module-card__header";

    const left = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "module-card__title";
    title.textContent = String(m.title || "Untitled module");
    left.appendChild(title);

    const desc = String(m.description || "").trim();
    if (desc) {
      const p = document.createElement("p");
      p.className = "module-card__desc";
      p.textContent = desc;
      left.appendChild(p);
    }

    header.appendChild(left);
    card.appendChild(header);

    const listWrap = document.createElement("div");
    listWrap.className = "assignment-list";

    const assignments = Array.isArray(m.assignments) ? m.assignments : [];
    if (assignments.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No assignments yet.";
      listWrap.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "feed";
      for (const a of assignments) {
        const row = document.createElement("div");
        row.className = "feed__item";

        const meta = document.createElement("p");
        meta.className = "feed__meta";
        const due = String(a.dueAt || "").trim();
        const when = due ? formatShortDate(due) : "";
        const pts = Number.isFinite(Number(a.points)) ? `${Number(a.points)} pts` : "";
        meta.textContent = [when ? `Due ${when}` : "Assignment", pts].filter(Boolean).join(" - ");

        const t = document.createElement("h4");
        t.className = "feed__title";
        t.textContent = String(a.title || "Assignment");

        const body = document.createElement("p");
        body.className = "feed__text";
        setTextWithLinks(body, String(a.body || ""));

        const actions = document.createElement("div");
        actions.className = "feed__actions feed__actions--between";

        const submitted = Boolean(a.submitted);
        if (submitted) {
          const status = document.createElement("span");
          status.className = "feed__status feed__status--submitted";
          status.textContent = "Submitted";
          actions.appendChild(status);
        } else {
          const spacer = document.createElement("span");
          spacer.className = "feed__status";
          spacer.textContent = "";
          actions.appendChild(spacer);
        }

        const submit = document.createElement("a");
        submit.className = submitted ? "btn btn--secondary btn--sm" : "btn btn--primary btn--sm";
        submit.href = studentAssignmentUrl({ classroomId, assignmentId: a.id });
        submit.textContent = submitted ? "Re-submit" : "Submit";
        actions.appendChild(submit);

        row.appendChild(meta);
        row.appendChild(t);
        row.appendChild(body);
        row.appendChild(actions);
        list.appendChild(row);
      }
      listWrap.appendChild(list);
    }

    card.appendChild(listWrap);
    container.appendChild(card);
  }
}

async function loadStudentClassroomModules() {
  const container = document.querySelector("[data-student-modules]");
  if (!container) return;

  const id = currentClassroomIdFromQuery();
  if (!id) return;

  const cacheKey = `blair.portal.student.modules:${id}`;
  const cached = readSessionCache(cacheKey);
  if (cached && Array.isArray(cached.items)) {
    renderStudentModules(container, cached.items, id);
  } else {
    container.innerHTML = `<p class="empty-state">Loading.</p>`;
  }

  try {
    const data = await apiFetch(`/api/student/classrooms/${encodeURIComponent(id)}/modules?limit=50`);
    renderStudentModules(container, data?.items || [], id);
    writeSessionCache(cacheKey, { items: data?.items || [], cachedAt: new Date().toISOString() });
  } catch (_err) {
    if (cached && Array.isArray(cached.items)) return;
    container.innerHTML = `<p class="empty-state">Unable to load modules.</p>`;
  }
}

async function prefetchStudentModules(classroomId) {
  const cid = String(classroomId || "").trim();
  if (!cid) return;

  const cacheKey = `blair.portal.student.modules:${cid}`;
  const cached = readSessionCache(cacheKey);
  if (cached && cached.cachedAt) return;

  try {
    const data = await apiFetch(`/api/student/classrooms/${encodeURIComponent(cid)}/modules?limit=50`);
    writeSessionCache(cacheKey, { items: data?.items || [], cachedAt: new Date().toISOString() });
  } catch (_err) {
    // ignore
  }
}

function renderStudentClassrooms(container, items) {
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
    tile.href = studentClassroomUrl(c.id);

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
      const sec = document.createElement("p");
      sec.className = "tile__text";
      sec.textContent = section;
      left.appendChild(kicker);
      left.appendChild(title);
      left.appendChild(sec);
    } else {
      left.appendChild(kicker);
      left.appendChild(title);
    }

    tile.appendChild(left);
    grid.appendChild(tile);
  }

  container.appendChild(grid);
}

function renderStudentGradesSummary(container, items) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No grades yet.";
    container.appendChild(empty);
    return;
  }

  const grid = document.createElement("div");
  grid.className = "tile-grid tile-grid--compact tile-grid--rows";

  for (const item of items) {
    const link = document.createElement("a");
    link.className = "tile tile--compact tile--row grade-tile";
    link.href = `${studentClassroomUrl(item.id)}#grades`;

    const name = document.createElement("div");
    name.className = "grade-tile__name";
    name.textContent = String(item.name || "Untitled");

    const grade = document.createElement("div");
    grade.className = "grade-tile__grade";

    const letter = document.createElement("div");
    letter.className = "grade-tile__letter";
    letter.textContent = String(item.letter || "N/A");

    const percent = document.createElement("div");
    percent.className = "grade-tile__percent";
    percent.textContent =
      item.percent == null || item.percent === ""
        ? "No grade"
        : `${Number(item.percent)}%`;

    grade.appendChild(letter);
    grade.appendChild(percent);

    link.appendChild(name);
    link.appendChild(grade);
    grid.appendChild(link);
  }

  container.appendChild(grid);
}

async function loadStudentGradesSummaryPage() {
  const container = document.querySelector("[data-student-grades-summary]");
  if (!container) return;

  const cacheKey = "blair.portal.student.gradesSummary";
  const cached = readSessionCache(cacheKey);
  if (cached && Array.isArray(cached.items)) {
    renderStudentGradesSummary(container, cached.items);
  } else {
    container.innerHTML = `<p class="empty-state">Loading...</p>`;
  }

  try {
    const data = await apiFetch("/api/student/classrooms/grades-summary");
    const items = Array.isArray(data?.items) ? data.items : [];
    renderStudentGradesSummary(container, items);
    writeSessionCache(cacheKey, { items, cachedAt: new Date().toISOString() });
  } catch (_err) {
    if (cached && Array.isArray(cached.items)) return;
    container.innerHTML = `<p class="empty-state">Unable to load grades.</p>`;
  }
}

async function loadStudentClassrooms() {
  const container = document.querySelector("[data-student-classrooms]");
  if (!container) return;

  try {
    const data = await apiFetch("/api/student/classrooms");
    renderStudentClassrooms(container, data?.items || []);
    loadStudentGradesSummaryPage();
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load classrooms.";
    container.appendChild(msg);
  }
}

function initStudentJoinClassroom() {
  const form = document.querySelector("form[data-student-join-classroom]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFormError(form, "");
    setFormSuccess(form, "");

    const formData = new FormData(form);
    const joinCode = String(formData.get("joinCode") || "").trim();
    if (!joinCode) {
      setFormError(form, "Join code is required.");
      return;
    }

    try {
      await apiFetch("/api/student/classrooms/join", {
        method: "POST",
        body: JSON.stringify({ joinCode }),
      });
      form.reset();
      setFormSuccess(form, "Joined classroom.");
      await loadStudentClassrooms();
      await loadStudentGradesSummaryPage();
    } catch (err) {
      setFormError(form, err?.message || "Failed to join.");
    }
  });
}

function initSubmissionTypePicker() {
  const buttons = Array.from(document.querySelectorAll("[data-submit-type]"));
  const panels = new Map();
  document.querySelectorAll("[data-submit-panel]").forEach((el) => {
    panels.set(String(el.getAttribute("data-submit-panel") || ""), el);
  });
  if (buttons.length === 0 || panels.size === 0) return;

  const textEl = document.querySelector('textarea[name="text"]');
  const urlEl = document.querySelector('input[name="url"]');
  const fileEl = document.querySelector('input[name="file"]');

  const setActive = (type) => {
    for (const b of buttons) {
      b.classList.toggle("is-active", b.getAttribute("data-submit-type") === type);
    }
    for (const [t, el] of panels.entries()) el.hidden = t !== type;
    document.documentElement.setAttribute("data-submit-type", type);

    if (textEl) textEl.required = type === "text";
    if (urlEl) urlEl.required = type === "url";
    if (fileEl) fileEl.required = type === "upload";
  };

  setActive("text");
  for (const b of buttons) {
    b.addEventListener("click", () => setActive(String(b.getAttribute("data-submit-type") || "text")));
  }
}

function renderStudentSubmissions(container, items) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No submissions yet.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "feed";

  for (const s of items) {
    const row = document.createElement("div");
    row.className = "feed__item";

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    meta.textContent = formatShortDate(s.createdAt) || "Submitted";

    const title = document.createElement("h3");
    title.className = "feed__title";
    title.textContent = `Type: ${String(s.type || "").toUpperCase()}`;

    const body = document.createElement("div");
    body.className = "feed__text";

    if (s.type === "text") {
      body.textContent = String(s.payload?.text || "");
    } else if (s.type === "url") {
      const url = String(s.payload?.url || "").trim();
      if (!url) {
        body.textContent = "(no url)";
      } else {
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noreferrer";
        a.textContent = url;
        body.appendChild(a);
      }
    } else if (s.type === "upload") {
      body.appendChild(
        renderUploadContent({
          fileName: s.payload?.fileName,
          dataUrl: s.payload?.dataUrl,
        })
      );
    } else {
      body.textContent = "";
    }

    row.appendChild(meta);
    row.appendChild(title);
    row.appendChild(body);
    list.appendChild(row);
  }

  container.appendChild(list);
}

async function loadStudentAssignmentSubmissions({ classroomId, assignmentId }) {
  const container = document.querySelector("[data-assignment-submissions]");
  if (!container) return;

  try {
    const data = await apiFetch(
      `/api/student/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(assignmentId)}/submissions?limit=10`
    );
    renderStudentSubmissions(container, data?.items || []);
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load submissions.";
    container.appendChild(msg);
  }
}

function initStudentAssignmentSubmission() {
  const form = document.querySelector("form[data-assignment-submit]");
  if (!form) return;

  const params = new URLSearchParams(window.location.search);
  const classroomId = String(params.get("classroomId") || "").trim();
  const assignmentId = String(params.get("assignmentId") || "").trim();

  const back = document.querySelector("[data-assignment-back]");
  const cancel = document.querySelector("[data-assignment-cancel]");
  const backUrl = studentClassroomUrl(classroomId);
  if (back) back.setAttribute("href", backUrl);
  if (cancel) cancel.setAttribute("href", backUrl);

  initSubmissionTypePicker();

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFormError(form, "");
    setFormSuccess(form, "");

    if (!classroomId || !assignmentId) {
      setFormError(form, "Missing assignment.");
      return;
    }

    const type = String(document.documentElement.getAttribute("data-submit-type") || "text");

    const formData = new FormData(form);
    let payload = {};

    if (type === "text") {
      payload = { text: String(formData.get("text") || "").trim() };
    } else if (type === "url") {
      payload = { url: String(formData.get("url") || "").trim() };
    } else if (type === "upload") {
      const file = formData.get("file");
      if (!(file instanceof File) || !file.size) {
        setFormError(form, "Choose a file.");
        return;
      }
      if (file.size > 2_000_000) {
        setFormError(form, "File is too large (max ~2MB).");
        return;
      }
      const dataUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("Failed to read file"));
        reader.readAsDataURL(file);
      });
      payload = { fileName: file.name, dataUrl };
    }

    try {
      await apiFetch(
        `/api/student/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(assignmentId)}/submissions`,
        { method: "POST", body: JSON.stringify({ type, payload }) }
      );
      // Invalidate modules cache so the classroom Modules tab can immediately show "Submitted".
      try {
        sessionStorage.removeItem(`blair.portal.student.modules:${classroomId}`);
      } catch (_e) {
        // ignore
      }

      const target = `${studentClassroomUrl(classroomId)}#modules`;
      window.location.href = target;
    } catch (err) {
      setFormError(form, err?.message || "Failed to submit.");
    }
  });

  loadStudentAssignmentSubmissions({ classroomId, assignmentId });
}

async function loadClassroomRecentActivity() {
  const container = document.querySelector("[data-classroom-recent]");
  if (!container) return;

  const id = currentClassroomIdFromQuery();
  if (!id) return;

  try {
    const data = await apiFetch(
      `/api/classrooms/${encodeURIComponent(id)}/announcements?limit=5`
    );
    renderClassroomAnnouncements(container, data?.items || [], { showDelete: false });
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load recent activity.";
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
      await loadClassroomRecentActivity();
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

function initClassroomAnnouncementDelete() {
  const container = document.querySelector("[data-classroom-announcements]");
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;
    const id = target.getAttribute("data-announcement-delete");
    if (!id) return;

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const ok = window.confirm("Delete this announcement?");
    if (!ok) return;

    try {
      await apiFetch(
        `/api/classrooms/${encodeURIComponent(classroomId)}/announcements/${encodeURIComponent(id)}`,
        { method: "DELETE" }
      );
      await loadClassroomRecentActivity();
      await loadClassroomAnnouncements();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err?.message || "Failed to delete.");
    }
  });
}

function renderModules(container, modules) {
  container.innerHTML = "";

  if (!Array.isArray(modules) || modules.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No modules yet.";
    container.appendChild(empty);
    return;
  }

  for (const m of modules) {
    const card = document.createElement("div");
    card.className = "module-card";
    card.setAttribute("data-module-id", String(m.id || ""));

    const header = document.createElement("div");
    header.className = "module-card__header";

    const left = document.createElement("div");

    const title = document.createElement("h3");
    title.className = "module-card__title";
    title.textContent = String(m.title || "Untitled module");

    left.appendChild(title);

    const desc = String(m.description || "").trim();
    if (desc) {
      const p = document.createElement("p");
      p.className = "module-card__desc";
      p.textContent = desc;
      left.appendChild(p);
    }

    const actions = document.createElement("div");
    actions.className = "module-card__actions";

    const addBtn = document.createElement("button");
    addBtn.type = "button";
    addBtn.className = "btn btn--secondary btn--sm";
    addBtn.textContent = "Add assignment";
    addBtn.setAttribute("data-module-add-assignment", String(m.id || ""));

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "btn btn--danger btn--sm";
    delBtn.textContent = "Delete";
    delBtn.setAttribute("data-module-delete", String(m.id || ""));

    actions.appendChild(addBtn);
    actions.appendChild(delBtn);

    header.appendChild(left);
    header.appendChild(actions);
    card.appendChild(header);

    const formWrap = document.createElement("div");
    formWrap.className = "assignment-form";
    formWrap.hidden = true;
    formWrap.setAttribute("data-assignment-form", String(m.id || ""));
    formWrap.innerHTML = `
      <form class="auth-form" data-assignment-create="${String(m.id || "")}" novalidate>
        <label class="field">
          <span class="field__label">Assignment title (optional)</span>
          <input name="title" type="text" placeholder="e.g., Homework 1" />
        </label>
        <label class="field">
          <span class="field__label">Instructions</span>
          <textarea name="body" rows="5" placeholder="What should students do?" required></textarea>
        </label>
        <label class="field">
          <span class="field__label">Due date (optional)</span>
          <input name="dueAt" type="datetime-local" />
        </label>
        <label class="field">
          <span class="field__label">Category</span>
          <input name="category" type="text" placeholder="Homework" value="Homework" />
        </label>
        <label class="field">
          <span class="field__label">Points (1-100)</span>
          <input name="points" type="number" min="1" max="100" step="1" placeholder="100" />
        </label>
        <p class="form-success" data-form-success hidden></p>
        <p class="form-error" data-form-error hidden></p>
        <button class="btn btn--primary btn--sm" type="submit">Create assignment</button>
      </form>
    `;
    card.appendChild(formWrap);

    const listWrap = document.createElement("div");
    listWrap.className = "assignment-list";

    const assignments = Array.isArray(m.assignments) ? m.assignments : [];
    if (assignments.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty-state";
      empty.textContent = "No assignments yet.";
      listWrap.appendChild(empty);
    } else {
      const list = document.createElement("div");
      list.className = "feed";
      for (const a of assignments) {
        const row = document.createElement("div");
        row.className = "feed__item";
        row.setAttribute("data-assignment-id", String(a.id || ""));

        const meta = document.createElement("p");
        meta.className = "feed__meta";
        const due = String(a.dueAt || "").trim();
        const when = due ? formatShortDate(due) : "";
        const pts = Number.isFinite(Number(a.points)) ? `${Number(a.points)} pts` : "";
        meta.textContent = [when ? `Due ${when}` : "Assignment", pts].filter(Boolean).join(" - ");

        const t = document.createElement("h4");
        t.className = "feed__title";
        t.textContent = String(a.title || "Assignment");

        const body = document.createElement("p");
        body.className = "feed__text";
        setTextWithLinks(body, String(a.body || ""));

        const actions = document.createElement("div");
        actions.className = "feed__actions";

        const viewSubs = document.createElement("button");
        viewSubs.type = "button";
        viewSubs.className = "btn btn--secondary btn--sm";
        viewSubs.textContent = "Submissions";
        viewSubs.setAttribute("data-assignment-submissions", String(a.id || ""));
        viewSubs.setAttribute("data-assignment-module", String(m.id || ""));
        actions.appendChild(viewSubs);

        const del = document.createElement("button");
        del.type = "button";
        del.className = "btn btn--danger btn--sm";
        del.textContent = "Delete";
        del.setAttribute("data-assignment-delete", String(a.id || ""));
        del.setAttribute("data-assignment-module", String(m.id || ""));
        actions.appendChild(del);

        const subsWrap = document.createElement("div");
        subsWrap.className = "assignment-submissions";
        subsWrap.hidden = true;
        subsWrap.setAttribute("data-assignment-submissions-wrap", String(a.id || ""));
        subsWrap.innerHTML = `<p class="empty-state">Loading...</p>`;

        row.appendChild(meta);
        row.appendChild(t);
        row.appendChild(body);
        row.appendChild(actions);
        row.appendChild(subsWrap);
        list.appendChild(row);
      }
      listWrap.appendChild(list);
    }

    card.appendChild(listWrap);

    container.appendChild(card);
  }
}

async function loadClassroomModules() {
  const container = document.querySelector("[data-classroom-modules]");
  if (!container) return;

  const classroomId = currentClassroomIdFromQuery();
  if (!classroomId) return;

  const cacheKey = `blair.portal.teacher.modules:${classroomId}`;
  const cached = readSessionCache(cacheKey);
  if (cached && Array.isArray(cached.items)) {
    renderModules(container, cached.items);
  } else {
    container.innerHTML = `<p class="empty-state">Loading.</p>`;
  }

  try {
    const data = await apiFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/modules?limit=50`);
    renderModules(container, data?.items || []);
    writeSessionCache(cacheKey, { items: data?.items || [], cachedAt: new Date().toISOString() });
  } catch (_err) {
    if (cached && Array.isArray(cached.items)) return;
    container.innerHTML = `<p class="empty-state">Unable to load modules.</p>`;
  }
}

function renderTeacherPeople(container, items) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    container.innerHTML = `<p class="empty-state">No students have joined yet.</p>`;
    return;
  }

  const list = document.createElement("div");
  list.className = "feed";

  for (const entry of items) {
    const row = document.createElement("div");
    row.className = "feed__item";

    const student = entry.student || {};
    const name = String(student.name || "Student");
    const email = String(student.email || "");
    const joinedAt = formatShortDate(entry.joinedAt);

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    meta.textContent = joinedAt ? `Joined ${joinedAt}` : "Joined";

    const title = document.createElement("h4");
    title.className = "feed__title";
    const baseLabel = email ? `${name} (${email})` : name;
    title.appendChild(document.createTextNode(baseLabel));

    const letter = String(entry?.grade?.letter || "").trim();
    const percentRaw = entry?.grade?.percent;
    const percent = Number.isFinite(Number(percentRaw)) ? Number(percentRaw) : null;
    if (letter && letter !== "N/A" && percent !== null) {
      const badge = document.createElement("span");
      badge.className = "people-grade";
      badge.textContent = `${letter} ${percent}%`;
      title.appendChild(document.createTextNode(" "));
      title.appendChild(badge);
    }

    const actions = document.createElement("div");
    actions.className = "feed__actions";

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "btn btn--danger btn--sm";
    remove.textContent = "Remove";
    remove.setAttribute("data-classroom-remove-student", String(student.id || ""));
    actions.appendChild(remove);

    row.appendChild(meta);
    row.appendChild(title);
    row.appendChild(actions);
    list.appendChild(row);
  }

  container.appendChild(list);
}

async function loadTeacherPeople() {
  const container = document.querySelector("[data-classroom-people]");
  if (!container) return;

  const classroomId = currentClassroomIdFromQuery();
  if (!classroomId) return;

  container.innerHTML = `<p class="empty-state">Loading...</p>`;
  try {
    const data = await apiFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/people`);
    renderTeacherPeople(container, data?.items || []);
  } catch (_err) {
    container.innerHTML = `<p class="empty-state">Unable to load students.</p>`;
  }
}

function normalizePointsDisplay(value) {
  if (value === null || value === undefined || value === "") return "";
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  return String(n);
}

let teacherGradebookMeta = null;
let teacherGradebookAssignment = null;

function renderTeacherGradeSettings(container, settings) {
  container.innerHTML = "";

  const categories = Array.isArray(settings?.categories) ? settings.categories : [];
  const latePenaltyPerDayPct = Number(settings?.latePenaltyPerDayPct) || 0;
  const maxLatePenaltyPct = Number(settings?.maxLatePenaltyPct) || 0;

  const form = document.createElement("form");
  form.className = "auth-form";
  form.setAttribute("data-grade-settings-form", "");
  form.noValidate = true;

  const header = document.createElement("div");
  header.className = "widget__header";
  header.innerHTML = `<h3 class="widget__title">Grade settings</h3>`;

  const note = document.createElement("p");
  note.className = "empty-state";
  note.textContent = "Weights must add up to 100.";

  const catWrap = document.createElement("div");
  catWrap.className = "grade-settings__categories";
  catWrap.innerHTML = `<h4 class="grade-settings__subhead">Categories</h4>`;

  const list = document.createElement("div");
  list.className = "grade-settings__list";

  const renderRow = (c) => {
    const row = document.createElement("div");
    row.className = "grade-settings__row";
    row.innerHTML = `
      <label class="field field--inline">
        <span class="field__label">Name</span>
        <input name="catName" type="text" value="${escapeHtml(String(c?.name || ""))}" />
      </label>
      <label class="field field--inline">
        <span class="field__label">Weight %</span>
        <input name="catWeight" type="number" min="0" max="100" step="1" value="${escapeHtml(String(c?.weightPct ?? ""))}" />
      </label>
      <button class="btn btn--danger btn--sm" type="button" data-grade-settings-remove>Remove</button>
    `;
    return row;
  };

  for (const c of categories) list.appendChild(renderRow(c));
  catWrap.appendChild(list);

  const addRow = document.createElement("button");
  addRow.type = "button";
  addRow.className = "btn btn--secondary btn--sm";
  addRow.textContent = "Add category";
  addRow.addEventListener("click", () => list.appendChild(renderRow({ name: "", weightPct: 0 })));

  const penalties = document.createElement("div");
  penalties.className = "grade-settings__penalties";
  penalties.innerHTML = `
    <h4 class="grade-settings__subhead">Late policy</h4>
    <div class="grade-settings__row">
      <label class="field field--inline">
        <span class="field__label">Penalty per day (%)</span>
        <input name="latePenaltyPerDayPct" type="number" min="0" max="100" step="1" value="${escapeHtml(String(latePenaltyPerDayPct))}" />
      </label>
      <label class="field field--inline">
        <span class="field__label">Max penalty (%)</span>
        <input name="maxLatePenaltyPct" type="number" min="0" max="100" step="1" value="${escapeHtml(String(maxLatePenaltyPct))}" />
      </label>
    </div>
  `;

  const sumEl = document.createElement("p");
  sumEl.className = "grade-settings__sum";

  const error = document.createElement("p");
  error.className = "form-error";
  error.hidden = true;

  const success = document.createElement("p");
  success.className = "form-success";
  success.hidden = true;

  const save = document.createElement("button");
  save.type = "submit";
  save.className = "btn btn--primary";
  save.textContent = "Save settings";

  const recomputeSum = () => {
    const weights = Array.from(list.querySelectorAll('input[name="catWeight"]')).map((i) => Number(i.value) || 0);
    const sum = weights.reduce((a, b) => a + b, 0);
    sumEl.textContent = `Total weight: ${sum}%`;
  };

  list.addEventListener("input", recomputeSum);
  recomputeSum();

  list.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.hasAttribute("data-grade-settings-remove")) {
      const row = t.closest(".grade-settings__row");
      if (row) row.remove();
      recomputeSum();
    }
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    error.hidden = true;
    success.hidden = true;

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const rows = Array.from(list.querySelectorAll(".grade-settings__row"));
    const cats = rows
      .map((r) => {
        const name = String(r.querySelector('input[name="catName"]')?.value || "").trim();
        const weightPct = Number(r.querySelector('input[name="catWeight"]')?.value || 0);
        return { name, weightPct };
      })
      .filter((c) => c.name);

    const sum = cats.reduce((a, c) => a + (Number(c.weightPct) || 0), 0);
    if (Math.round(sum) !== 100) {
      error.textContent = "Category weights must add up to 100.";
      error.hidden = false;
      return;
    }

    try {
      const data = await apiFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/grade-settings`, {
        method: "PUT",
        body: JSON.stringify({
          categories: cats,
          latePenaltyPerDayPct: Number(form.querySelector('input[name="latePenaltyPerDayPct"]')?.value || 0),
          maxLatePenaltyPct: Number(form.querySelector('input[name="maxLatePenaltyPct"]')?.value || 0),
        }),
      });
      teacherGradebookMeta = teacherGradebookMeta ? { ...teacherGradebookMeta, settings: data.item } : teacherGradebookMeta;
      success.textContent = "Saved.";
      success.hidden = false;
    } catch (err) {
      error.textContent = err?.message || "Failed to save settings.";
      error.hidden = false;
    }
  });

  form.appendChild(header);
  form.appendChild(note);
  form.appendChild(catWrap);
  form.appendChild(addRow);
  form.appendChild(penalties);
  form.appendChild(sumEl);
  form.appendChild(success);
  form.appendChild(error);
  form.appendChild(save);

  container.appendChild(form);
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&#39;");
}

function computeDaysLate({ dueAt, submittedAt }) {
  const due = dueAt ? new Date(dueAt) : null;
  const sub = submittedAt ? new Date(submittedAt) : null;
  if (!due || Number.isNaN(due.getTime())) return 0;
  if (!sub || Number.isNaN(sub.getTime())) return 0;
  const ms = sub.getTime() - due.getTime();
  if (ms <= 0) return 0;
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

function applyLatePenalty({ earned, daysLate, perDayPct, maxPct }) {
  if (!Number.isFinite(earned) || earned <= 0) return earned;
  const penaltyPct = Math.min(Math.max(0, daysLate * perDayPct), maxPct);
  const adjusted = earned * (1 - penaltyPct / 100);
  return Math.round(adjusted * 100) / 100;
}

function renderSubmissionPreview(submission) {
  const wrap = document.createElement("div");
  wrap.className = "gradebook__submission";

  if (!submission) {
    wrap.innerHTML = `<p class="empty-state">No submission.</p>`;
    return wrap;
  }

  const when = formatShortDate(submission.createdAt);
  const meta = document.createElement("p");
  meta.className = "feed__meta";
  meta.textContent = when ? `Submitted ${when}` : "Submitted";
  wrap.appendChild(meta);

  if (submission.type === "text") {
    const p = document.createElement("p");
    p.className = "feed__text";
    p.textContent = String(submission.payload?.text || "");
    wrap.appendChild(p);
  } else if (submission.type === "url") {
    const url = String(submission.payload?.url || "").trim();
    const p = document.createElement("p");
    p.className = "feed__text";
    const a = document.createElement("a");
    a.href = url;
    a.target = "_blank";
    a.rel = "noreferrer";
    a.textContent = url || "(no url)";
    p.appendChild(a);
    wrap.appendChild(p);
  } else if (submission.type === "upload") {
    wrap.appendChild(
      renderUploadContent({
        fileName: submission.payload?.fileName,
        dataUrl: submission.payload?.dataUrl,
      })
    );
  }

  return wrap;
}

function renderTeacherGradebookAssignment(container, payload) {
  container.innerHTML = "";

  const assignment = payload?.assignment;
  const people = Array.isArray(payload?.people) ? payload.people : [];
  const grades = Array.isArray(payload?.grades) ? payload.grades : [];
  const submissions = Array.isArray(payload?.submissions) ? payload.submissions : [];
  const rubric = Array.isArray(payload?.rubric) ? payload.rubric : [];
  const settings = payload?.settings || {};

  if (!assignment) {
    container.innerHTML = `<p class="empty-state">Select an assignment.</p>`;
    return;
  }
  if (people.length === 0) {
    container.innerHTML = `<p class="empty-state">No students have joined yet.</p>`;
    return;
  }

  const gradeByStudent = new Map(grades.map((g) => [String(g.studentId || ""), g]));
  const submissionByStudent = new Map(submissions.map((s) => [String(s.studentId || ""), s]));

  const maxPoints = Number(assignment.points);
  const perDayPct = Number(settings.latePenaltyPerDayPct) || 0;
  const maxPct = Number(settings.maxLatePenaltyPct) || 0;

  const header = document.createElement("div");
  header.className = "gradebook-head";
  header.innerHTML = `
    <h4 class="gradebook-head__title">${escapeHtml(String(assignment.title || "Assignment"))}</h4>
    <p class="gradebook-head__meta">${escapeHtml(String(assignment.category || "Homework"))} - ${escapeHtml(String(maxPoints || ""))} pts</p>
  `;
  header.innerHTML = header.innerHTML.replaceAll("\u0007", " - ");
  container.appendChild(header);

  const rubricBox = document.createElement("div");
  rubricBox.className = "rubric-box";

  const rubricHeader = document.createElement("div");
  rubricHeader.className = "rubric-box__header";

  const rubricTitle = document.createElement("h4");
  rubricTitle.className = "rubric-box__title";
  rubricTitle.textContent = "Rubric";

  const rubricToggle = document.createElement("button");
  rubricToggle.type = "button";
  rubricToggle.className = "btn btn--secondary btn--sm";
  rubricToggle.textContent = "Edit rubric";

  rubricHeader.appendChild(rubricTitle);
  rubricHeader.appendChild(rubricToggle);
  rubricBox.appendChild(rubricHeader);

  const rubricMeta = document.createElement("p");
  rubricMeta.className = "empty-state";
  rubricMeta.textContent = rubric.length ? `Enabled (${rubric.length} criteria)` : "No rubric set.";
  rubricBox.appendChild(rubricMeta);

  const editor = document.createElement("div");
  editor.className = "rubric-box__editor";
  editor.hidden = true;

  const rows = document.createElement("div");
  rows.className = "rubric-box__rows";

  const renderRubricRow = (r) => {
    const row = document.createElement("div");
    row.className = "rubric-box__row";
    row.innerHTML = `
      <label class="field field--inline">
        <span class="field__label">Criterion</span>
        <input name="rubricTitle" type="text" value="${escapeHtml(String(r?.title || ""))}" placeholder="e.g., Work shown" />
      </label>
      <label class="field field--inline">
        <span class="field__label">Points</span>
        <input name="rubricPoints" type="number" min="1" max="100" step="1" value="${escapeHtml(String(r?.pointsMax ?? ""))}" />
      </label>
      <button class="btn btn--danger btn--sm" type="button" data-rubric-remove>Remove</button>
    `;
    return row;
  };

  for (const r of rubric) rows.appendChild(renderRubricRow(r));
  if (!rubric.length) rows.appendChild(renderRubricRow({ title: "Total", pointsMax: maxPoints }));

  const addCrit = document.createElement("button");
  addCrit.type = "button";
  addCrit.className = "btn btn--secondary btn--sm";
  addCrit.textContent = "Add criterion";
  addCrit.addEventListener("click", () => rows.appendChild(renderRubricRow({ title: "", pointsMax: 1 })));

  const sumEl = document.createElement("p");
  sumEl.className = "empty-state";

  const errEl = document.createElement("p");
  errEl.className = "form-error";
  errEl.hidden = true;

  const okEl = document.createElement("p");
  okEl.className = "form-success";
  okEl.hidden = true;

  const saveRubric = document.createElement("button");
  saveRubric.type = "button";
  saveRubric.className = "btn btn--primary btn--sm";
  saveRubric.textContent = "Save rubric";

  const computeSum = () => {
    const pts = Array.from(rows.querySelectorAll('input[name="rubricPoints"]')).map((i) => Number(i.value) || 0);
    const sum = pts.reduce((a, b) => a + b, 0);
    sumEl.textContent = `Total rubric points: ${sum} (must equal ${maxPoints})`;
    return sum;
  };
  rows.addEventListener("input", computeSum);
  computeSum();

  rows.addEventListener("click", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.hasAttribute("data-rubric-remove")) {
      const row = t.closest(".rubric-box__row");
      if (row) row.remove();
      computeSum();
    }
  });

  saveRubric.addEventListener("click", async () => {
    errEl.hidden = true;
    okEl.hidden = true;

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const rubricRows = Array.from(rows.querySelectorAll(".rubric-box__row"));
    const nextRubric = rubricRows
      .map((r) => ({
        title: String(r.querySelector('input[name="rubricTitle"]')?.value || "").trim(),
        pointsMax: Number(r.querySelector('input[name="rubricPoints"]')?.value || 0),
      }))
      .filter((r) => r.title);

    const sum = nextRubric.reduce((a, r) => a + (Number(r.pointsMax) || 0), 0);
    if (Math.floor(sum) !== Math.floor(maxPoints)) {
      errEl.textContent = `Rubric points must add up to ${maxPoints}.`;
      errEl.hidden = false;
      return;
    }

    try {
      await apiFetch(
        `/api/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(String(assignment.id))}/rubric`,
        { method: "PUT", body: JSON.stringify({ rubric: nextRubric }) }
      );
      okEl.textContent = "Rubric saved.";
      okEl.hidden = false;
      editor.hidden = true;
      await loadTeacherGradebookAssignment(String(assignment.id));
    } catch (err) {
      errEl.textContent = err?.message || "Failed to save rubric.";
      errEl.hidden = false;
    }
  });

  editor.appendChild(rows);
  editor.appendChild(addCrit);
  editor.appendChild(sumEl);
  editor.appendChild(okEl);
  editor.appendChild(errEl);
  editor.appendChild(saveRubric);
  rubricBox.appendChild(editor);

  rubricToggle.addEventListener("click", () => {
    editor.hidden = !editor.hidden;
  });

  container.appendChild(rubricBox);

  const list = document.createElement("div");
  list.className = "gradebook";

  for (const p of people) {
    const sid = String(p.id || "");
    const current = gradeByStudent.get(sid) || null;
    const submission = submissionByStudent.get(sid) || null;

    const row = document.createElement("div");
    row.className = "gradebook__row";
    row.setAttribute("data-gradebook-student-row", sid);

    const left = document.createElement("div");
    left.className = "gradebook__left";

    const name = document.createElement("button");
    name.type = "button";
    name.className = "gradebook__name gradebook__name--link";
    const email = String(p.email || "").trim();
    name.textContent = email ? `${p.name || "Student"} (${email})` : String(p.name || "Student");
    name.setAttribute("data-gradebook-student-report", sid);

    left.appendChild(name);
    left.appendChild(renderSubmissionPreview(submission));

    const right = document.createElement("div");
    right.className = "gradebook__right";

    const statusField = document.createElement("label");
    statusField.className = "field field--inline";
    statusField.innerHTML = `
      <span class="field__label">Status</span>
      <select name="status">
        <option value="graded">Graded</option>
        <option value="late">Late</option>
        <option value="missing">Missing</option>
        <option value="excused">Excused</option>
      </select>
    `;
    const statusSelect = statusField.querySelector("select");
    if (statusSelect) statusSelect.value = String(current?.status || "graded");

    const lateField = document.createElement("label");
    lateField.className = "field field--inline";
    lateField.innerHTML = `
      <span class="field__label">Late days (optional)</span>
      <input name="lateDaysOverride" type="number" min="0" max="60" step="1" placeholder="auto" />
    `;
    const lateInput = lateField.querySelector("input");
    if (lateInput && current?.lateDaysOverride !== null && current?.lateDaysOverride !== undefined) {
      lateInput.value = String(current.lateDaysOverride);
    }

    const pointsField = document.createElement("label");
    pointsField.className = "field field--inline";
    pointsField.innerHTML = `
      <span class="field__label">Points earned</span>
      <input name="pointsEarned" type="number" min="0" max="${escapeHtml(String(maxPoints || 100))}" step="1" placeholder="-" />
    `;
    const pointsInput = pointsField.querySelector("input");
    if (pointsInput) pointsInput.value = normalizePointsDisplay(current?.pointsEarned);

    const rubricScoresWrap = document.createElement("div");
    rubricScoresWrap.className = "rubric-scores";

    if (rubric.length) {
      for (const r of rubric) {
        const rid = String(r.id || "");
        const crit = document.createElement("label");
        crit.className = "field field--inline";
        crit.innerHTML = `
          <span class="field__label">${escapeHtml(String(r.title || "Criterion"))} (${escapeHtml(String(r.pointsMax || ""))})</span>
          <input name="rubric:${escapeHtml(rid)}" type="number" min="0" max="${escapeHtml(String(r.pointsMax || 0))}" step="1" />
        `;
        const input = crit.querySelector("input");
        const existing = current?.rubricScores && typeof current.rubricScores === "object" ? current.rubricScores : null;
        if (input && existing && existing[rid] !== undefined && existing[rid] !== null) {
          input.value = String(existing[rid]);
        }
        rubricScoresWrap.appendChild(crit);
      }
    }

    const adjusted = document.createElement("p");
    adjusted.className = "gradebook__meta";

    const computeAdjustedText = () => {
      const status = String(statusSelect?.value || "graded");
      const earned = Number(pointsInput?.value || "");
      if (!Number.isFinite(earned)) {
        adjusted.textContent = "";
        return;
      }
      if (status === "excused") {
        adjusted.textContent = "Excluded from totals.";
        return;
      }
      if (status === "missing") {
        adjusted.textContent = "Counts as 0 (missing).";
        return;
      }
      if (status === "late") {
        const override = lateInput?.value === "" ? null : Number(lateInput?.value);
        const daysLate = Number.isFinite(override)
          ? Math.max(0, Math.floor(override))
          : computeDaysLate({ dueAt: assignment.dueAt, submittedAt: submission?.createdAt });
        const adj = applyLatePenalty({ earned, daysLate, perDayPct, maxPct });
        adjusted.textContent = `Adjusted: ${adj} / ${maxPoints} (${daysLate} days late)`;
        return;
      }
      adjusted.textContent = `Out of ${maxPoints}`;
    };

    const syncRubricSum = () => {
      if (!rubric.length) return;
      let sum = 0;
      const scores = {};
      for (const r of rubric) {
        const rid = String(r.id || "");
        const input = rubricScoresWrap.querySelector(`input[name="rubric:${CSS.escape(rid)}"]`);
        const n = Number(input?.value || "");
        if (Number.isFinite(n)) {
          scores[rid] = n;
          sum += n;
        }
      }
      if (pointsInput) pointsInput.value = sum ? String(Math.min(maxPoints, Math.round(sum))) : "";
      computeAdjustedText();
      return scores;
    };

    const feedbackField = document.createElement("label");
    feedbackField.className = "field field--inline";
    feedbackField.innerHTML = `
      <span class="field__label">Feedback (optional)</span>
      <input name="feedback" type="text" placeholder="Nice work" />
    `;
    const feedbackInput = feedbackField.querySelector("input");
    if (feedbackInput) feedbackInput.value = String(current?.feedback || "");

    const actions = document.createElement("div");
    actions.className = "gradebook__actions";

    const save = document.createElement("button");
    save.type = "button";
    save.className = "btn btn--primary btn--sm";
    save.textContent = "Save";
    save.setAttribute("data-gradebook-save", sid);
    actions.appendChild(save);

    const msg = document.createElement("p");
    msg.className = "gradebook__status";
    msg.setAttribute("data-gradebook-status", sid);

    const showLate = () => {
      lateField.hidden = String(statusSelect?.value || "graded") !== "late";
      computeAdjustedText();
    };

    if (statusSelect) statusSelect.addEventListener("change", showLate);
    if (lateInput) lateInput.addEventListener("input", computeAdjustedText);
    if (pointsInput) pointsInput.addEventListener("input", computeAdjustedText);
    rubricScoresWrap.addEventListener("input", syncRubricSum);
    showLate();
    computeAdjustedText();

    right.appendChild(statusField);
    right.appendChild(lateField);
    if (rubric.length) right.appendChild(rubricScoresWrap);
    right.appendChild(pointsField);
    right.appendChild(adjusted);
    right.appendChild(feedbackField);
    right.appendChild(actions);
    right.appendChild(msg);

    row.appendChild(left);
    row.appendChild(right);
    list.appendChild(row);
  }

  container.appendChild(list);
}

async function loadTeacherGradebookMeta() {
  const filterForm = document.querySelector("form[data-gradebook-filter]");
  const settingsWrap = document.querySelector("[data-grade-settings]");
  const gradebookWrap = document.querySelector("[data-gradebook]");
  if (!filterForm || !settingsWrap || !gradebookWrap) return;

  const classroomId = currentClassroomIdFromQuery();
  if (!classroomId) return;

  gradebookWrap.innerHTML = `<p class="empty-state">Loading...</p>`;
  settingsWrap.innerHTML = `<p class="empty-state">Loading grade settings...</p>`;

  try {
    const data = await apiFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/gradebook`);
    teacherGradebookMeta = data;
    renderTeacherGradeSettings(settingsWrap, data?.settings);

    const select = filterForm.querySelector('select[name="assignmentId"]');
    if (select) {
      const assignments = Array.isArray(data?.assignments) ? data.assignments : [];
      select.innerHTML = "";
      const placeholder = document.createElement("option");
      placeholder.value = "";
      placeholder.textContent = "Select an assignment";
      select.appendChild(placeholder);
      for (const a of assignments) {
        const opt = document.createElement("option");
        opt.value = String(a.id || "");
        const moduleLabel = String(a.moduleTitle || "").trim();
        opt.textContent = moduleLabel ? `${moduleLabel} - ${a.title || "Assignment"}` : String(a.title || "Assignment");
        select.appendChild(opt);
      }
    }

    gradebookWrap.innerHTML = `<p class="empty-state">Select an assignment to start grading.</p>`;
  } catch (_err) {
    gradebookWrap.innerHTML = `<p class="empty-state">Unable to load gradebook.</p>`;
    settingsWrap.innerHTML = `<p class="empty-state">Unable to load grade settings.</p>`;
  }
}

async function loadTeacherGradebookAssignment(assignmentId) {
  const gradebookWrap = document.querySelector("[data-gradebook]");
  if (!gradebookWrap) return;

  const classroomId = currentClassroomIdFromQuery();
  if (!classroomId) return;

  if (!assignmentId) {
    gradebookWrap.innerHTML = `<p class="empty-state">Select an assignment.</p>`;
    return;
  }

  gradebookWrap.innerHTML = `<p class="empty-state">Loading...</p>`;
  try {
    const data = await apiFetch(
      `/api/classrooms/${encodeURIComponent(classroomId)}/gradebook/assignment/${encodeURIComponent(assignmentId)}`
    );
    teacherGradebookAssignment = data;
    renderTeacherGradebookAssignment(gradebookWrap, data);
  } catch (_err) {
    gradebookWrap.innerHTML = `<p class="empty-state">Unable to load gradebook.</p>`;
  }
}

async function loadTeacherStudentReport(studentId) {
  const report = document.querySelector("[data-grade-report]");
  if (!report) return;

  const classroomId = currentClassroomIdFromQuery();
  if (!classroomId) return;

  report.hidden = false;
  report.innerHTML = `<p class="empty-state">Loading...</p>`;
  try {
    const data = await apiFetch(
      `/api/classrooms/${encodeURIComponent(classroomId)}/gradebook/student/${encodeURIComponent(studentId)}`
    );
    report.innerHTML = "";

    const back = document.createElement("button");
    back.type = "button";
    back.className = "btn btn--secondary btn--sm";
    back.textContent = "Close";
    back.addEventListener("click", () => {
      report.hidden = true;
      report.innerHTML = "";
    });

    const title = document.createElement("h3");
    title.className = "widget__title";
    title.textContent = `Report: ${data?.student?.name || "Student"}`;

    report.appendChild(back);
    report.appendChild(title);

    // Reuse student-grade rendering in a simple container
    const inner = document.createElement("div");
    report.appendChild(inner);
    renderStudentGrades(inner, {
      settings: data?.settings,
      assignments: data?.assignments,
      grades: data?.grades,
      submissions: data?.submissions,
    });
  } catch (_err) {
    report.innerHTML = `<p class="empty-state">Unable to load report.</p>`;
  }
}

function initTeacherGradebookInteractions() {
  const filterForm = document.querySelector("form[data-gradebook-filter]");
  if (!filterForm) return;

  filterForm.addEventListener("change", () => {
    const selected = String(filterForm.querySelector('select[name="assignmentId"]')?.value || "").trim();
    loadTeacherGradebookAssignment(selected);
  });

  const gradebook = document.querySelector("[data-gradebook]");
  if (!gradebook) return;

  gradebook.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const studentId = target.getAttribute("data-gradebook-save");
    if (studentId) {
      const classroomId = currentClassroomIdFromQuery();
      if (!classroomId) return;
      const assignmentId = String(filterForm.querySelector('select[name="assignmentId"]')?.value || "").trim();
      if (!assignmentId) return;

      const row = gradebook.querySelector(`[data-gradebook-student-row="${CSS.escape(studentId)}"]`);
      const pointsEarned = row?.querySelector('input[name="pointsEarned"]')?.value ?? "";
      const feedback = row?.querySelector('input[name="feedback"]')?.value ?? "";
      const statusValue = row?.querySelector('select[name="status"]')?.value ?? "graded";
      const lateDaysOverride = row?.querySelector('input[name="lateDaysOverride"]')?.value ?? "";

      const rubricScores = {};
      row?.querySelectorAll('input[name^="rubric:"]').forEach((input) => {
        const name = input.getAttribute("name") || "";
        const id = name.replace(/^rubric:/, "");
        const n = Number(input.value);
        if (id && Number.isFinite(n)) rubricScores[id] = n;
      });

      const status = gradebook.querySelector(`[data-gradebook-status="${CSS.escape(studentId)}"]`);
      if (status) status.textContent = "Saving...";

      try {
        await apiFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/grades`, {
          method: "PUT",
          body: JSON.stringify({
            assignmentId,
            studentId,
            pointsEarned,
            feedback,
            status: statusValue,
            lateDaysOverride,
            rubricScores: Object.keys(rubricScores).length ? rubricScores : null,
          }),
        });
        if (status) status.textContent = "Saved.";
      } catch (err) {
        if (status) status.textContent = err?.message || "Failed to save.";
      }
      return;
    }

    const reportId = target.getAttribute("data-gradebook-student-report");
    if (reportId) {
      loadTeacherStudentReport(reportId);
    }
  });
}

function renderStudentGrades(container, payload) {
  container.innerHTML = "";

  const assignments = Array.isArray(payload?.assignments) ? payload.assignments : [];
  const grades = Array.isArray(payload?.grades) ? payload.grades : [];
  const gradeByAssignment = new Map(grades.map((g) => [String(g.assignmentId || ""), g]));

  const percentToLetter = (pct) => {
    if (!Number.isFinite(pct)) return "";
    // Common US +/- grading scale
    if (pct >= 93) return "A";
    if (pct >= 90) return "A-";
    if (pct >= 87) return "B+";
    if (pct >= 83) return "B";
    if (pct >= 80) return "B-";
    if (pct >= 77) return "C+";
    if (pct >= 73) return "C";
    if (pct >= 70) return "C-";
    if (pct >= 67) return "D+";
    if (pct >= 63) return "D";
    if (pct >= 60) return "D-";
    return "F";
  };

  if (assignments.length === 0) {
    container.innerHTML = `<p class="empty-state">No assignments yet.</p>`;
    return;
  }

  let earnedTotal = 0;
  let possibleTotal = 0;
  let gradedCount = 0;
  let countedCount = 0;
  for (const a of assignments) {
    const g = gradeByAssignment.get(String(a.id || "")) || null;
    const earned = g && g.pointsEarned !== null && g.pointsEarned !== undefined ? Number(g.pointsEarned) : null;
    const max = String(a.points || "").trim() ? Number(a.points) : null;
    if (!Number.isFinite(earned)) continue;
    gradedCount += 1;
    if (Number.isFinite(max) && max > 0) {
      earnedTotal += earned;
      possibleTotal += max;
      countedCount += 1;
    }
  }

  const summary = document.createElement("div");
  summary.className = "grade-summary";

  const header = document.createElement("div");
  header.className = "grade-summary__header";

  const h = document.createElement("h3");
  h.className = "grade-summary__title";
  h.textContent = "Class grade";

  const sub = document.createElement("p");
  sub.className = "grade-summary__meta";
  if (!gradedCount) {
    sub.textContent = "No grades yet.";
  } else if (countedCount !== gradedCount) {
    sub.textContent = `${gradedCount} graded (${countedCount} counted)`;
  } else {
    sub.textContent = `${gradedCount} graded`;
  }

  header.appendChild(h);
  header.appendChild(sub);
  summary.appendChild(header);

  const body = document.createElement("div");
  body.className = "grade-summary__body";

  if (possibleTotal > 0) {
    const pct = Math.round((earnedTotal / possibleTotal) * 1000) / 10;
    const letter = percentToLetter(pct);

    const big = document.createElement("p");
    big.className = "grade-summary__big";
    big.textContent = `${pct}% - ${letter}`;

    const pts = document.createElement("p");
    pts.className = "grade-summary__points";
    pts.textContent = `Points: ${Math.round(earnedTotal * 100) / 100} / ${Math.round(possibleTotal * 100) / 100}`;

    body.appendChild(big);
    body.appendChild(pts);
  } else {
    const big = document.createElement("p");
    big.className = "grade-summary__big";
    big.textContent = "—";
    body.appendChild(big);

    if (gradedCount) {
      const hint = document.createElement("p");
      hint.className = "grade-summary__points";
      hint.textContent = "Tip: teachers need to set assignment points for totals.";
      body.appendChild(hint);
    }
  }

  summary.appendChild(body);
  container.appendChild(summary);

  const list = document.createElement("div");
  list.className = "feed";

  for (const a of assignments) {
    const row = document.createElement("div");
    row.className = "feed__item";

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    const moduleTitle = String(a.moduleTitle || "").trim();
    meta.textContent = moduleTitle ? moduleTitle : "Assignment";

    const title = document.createElement("h3");
    title.className = "feed__title";
    title.textContent = String(a.title || "Assignment");

    const g = gradeByAssignment.get(String(a.id || "")) || null;
    const pointsRaw = String(a.points || "").trim();
    const maxPoints = pointsRaw ? Number(pointsRaw) : null;
    const scoreNum = g && g.pointsEarned !== null && g.pointsEarned !== undefined ? Number(g.pointsEarned) : null;
    const score = Number.isFinite(scoreNum) ? String(scoreNum) : "";

    const text = document.createElement("p");
    text.className = "feed__text";
    if (!score) {
      text.textContent = "Not graded yet.";
    } else if (Number.isFinite(maxPoints) && maxPoints > 0) {
      const pct = Math.round((Number(score) / maxPoints) * 1000) / 10;
      const letter = percentToLetter(pct);
      text.textContent = `Score: ${score} / ${pointsRaw} (${pct}% - ${letter})`;
    } else {
      text.textContent = `Score: ${score}`;
    }

    if (g && g.feedback) {
      const fb = document.createElement("p");
      fb.className = "feed__text";
      fb.textContent = `Feedback: ${String(g.feedback)}`;
      row.appendChild(meta);
      row.appendChild(title);
      row.appendChild(text);
      row.appendChild(fb);
    } else {
      row.appendChild(meta);
      row.appendChild(title);
      row.appendChild(text);
    }

    list.appendChild(row);
  }

  container.appendChild(list);
}

async function loadStudentGrades() {
  const container = document.querySelector("[data-student-grades]");
  if (!container) return;

  const classroomId = currentClassroomIdFromQuery();
  if (!classroomId) return;

  container.innerHTML = `<p class="empty-state">Loading...</p>`;
  try {
    const data = await apiFetch(`/api/student/classrooms/${encodeURIComponent(classroomId)}/grades`);
    renderStudentGrades(container, data);
  } catch (_err) {
    container.innerHTML = `<p class="empty-state">Unable to load grades.</p>`;
  }
}

async function prefetchTeacherModules(classroomId) {
  const cid = String(classroomId || "").trim();
  if (!cid) return;

  const cacheKey = `blair.portal.teacher.modules:${cid}`;
  const cached = readSessionCache(cacheKey);
  if (cached && cached.cachedAt) return;

  try {
    const data = await apiFetch(`/api/classrooms/${encodeURIComponent(cid)}/modules?limit=50`);
    writeSessionCache(cacheKey, { items: data?.items || [], cachedAt: new Date().toISOString() });
  } catch (_err) {
    // ignore
  }
}

function renderTeacherSubmissions(container, items) {
  container.innerHTML = "";

  if (!Array.isArray(items) || items.length === 0) {
    const empty = document.createElement("p");
    empty.className = "empty-state";
    empty.textContent = "No submissions yet.";
    container.appendChild(empty);
    return;
  }

  const list = document.createElement("div");
  list.className = "feed";

  for (const s of items) {
    const row = document.createElement("div");
    row.className = "feed__item";

    const meta = document.createElement("p");
    meta.className = "feed__meta";
    const when = formatShortDate(s.createdAt);
    const student = s.student || {};
    meta.textContent = `${student.name || "Student"}${student.email ? ` (${student.email})` : ""}${when ? ` - ${when}` : ""}`;

    const title = document.createElement("h4");
    title.className = "feed__title";
    title.textContent = `Type: ${String(s.type || "").toUpperCase()}`;

    const body = document.createElement("div");
    body.className = "feed__text";

    if (s.type === "text") {
      body.textContent = String(s.payload?.text || "");
    } else if (s.type === "url") {
      const url = String(s.payload?.url || "").trim();
      const a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noreferrer";
      a.textContent = url || "(no url)";
      body.textContent = "";
      body.appendChild(a);
    } else if (s.type === "upload") {
      body.appendChild(
        renderUploadContent({
          fileName: s.payload?.fileName,
          dataUrl: s.payload?.dataUrl,
        })
      );
    } else {
      body.textContent = "";
    }

    row.appendChild(meta);
    row.appendChild(title);
    row.appendChild(body);
    list.appendChild(row);
  }

  container.appendChild(list);
}

async function loadTeacherAssignmentSubmissions({ classroomId, assignmentId, container }) {
  try {
    const data = await apiFetch(
      `/api/classrooms/${encodeURIComponent(classroomId)}/assignments/${encodeURIComponent(assignmentId)}/submissions?limit=100`
    );
    renderTeacherSubmissions(container, data?.items || []);
  } catch (_err) {
    container.innerHTML = "";
    const msg = document.createElement("p");
    msg.className = "empty-state";
    msg.textContent = "Unable to load submissions.";
    container.appendChild(msg);
  }
}

function initModuleCreate() {
  const form = document.querySelector("form[data-classroom-module-create]");
  if (!form) return;

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    setFormError(form, "");
    setFormSuccess(form, "");

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const title = String(payload.title || "").trim();
    const description = String(payload.description || "").trim();

    if (!title) {
      setFormError(form, "Module title is required.");
      return;
    }

    try {
      await apiFetch(`/api/classrooms/${encodeURIComponent(classroomId)}/modules`, {
        method: "POST",
        body: JSON.stringify({ title, description }),
      });
      form.reset();
      setFormSuccess(form, "Module created.");
      await loadClassroomModules();
    } catch (err) {
      setFormError(form, err?.message || "Failed to create module.");
    }
  });
}

function initModulesInteractions() {
  const container = document.querySelector("[data-classroom-modules]");
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const add = target.getAttribute("data-module-add-assignment");
    if (add) {
      const formWrap = container.querySelector(`[data-assignment-form="${CSS.escape(add)}"]`);
      if (formWrap) formWrap.hidden = !formWrap.hidden;
      return;
    }

    const moduleDel = target.getAttribute("data-module-delete");
    if (moduleDel) {
      const ok = window.confirm("Delete this module and all its assignments?");
      if (!ok) return;
      try {
        await apiFetch(
          `/api/classrooms/${encodeURIComponent(classroomId)}/modules/${encodeURIComponent(moduleDel)}`,
          { method: "DELETE" }
        );
        await loadClassroomModules();
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(err?.message || "Failed to delete module.");
      }
      return;
    }

    const assignmentDel = target.getAttribute("data-assignment-delete");
    if (assignmentDel) {
      const moduleId = target.getAttribute("data-assignment-module") || "";
      const ok = window.confirm("Delete this assignment?");
      if (!ok) return;
      try {
        await apiFetch(
          `/api/classrooms/${encodeURIComponent(classroomId)}/modules/${encodeURIComponent(moduleId)}/assignments/${encodeURIComponent(assignmentDel)}`,
          { method: "DELETE" }
        );
        await loadClassroomModules();
      } catch (err) {
        // eslint-disable-next-line no-alert
        alert(err?.message || "Failed to delete assignment.");
      }
    }

    const assignmentSubs = target.getAttribute("data-assignment-submissions");
    if (assignmentSubs) {
      const wrap = container.querySelector(
        `[data-assignment-submissions-wrap="${CSS.escape(assignmentSubs)}"]`
      );
      if (!wrap) return;

      wrap.hidden = !wrap.hidden;
      if (!wrap.hidden) {
        wrap.innerHTML = `<p class="empty-state">Loading...</p>`;
        loadTeacherAssignmentSubmissions({
          classroomId,
          assignmentId: assignmentSubs,
          container: wrap,
        });
      }
    }
  });

  container.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    const moduleId = form.getAttribute("data-assignment-create");
    if (!moduleId) return;
    e.preventDefault();

    setFormError(form, "");
    setFormSuccess(form, "");

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const formData = new FormData(form);
    const payload = Object.fromEntries(formData.entries());
    const title = String(payload.title || "").trim();
    const body = String(payload.body || "").trim();
    const dueAt = String(payload.dueAt || "").trim();
    const category = String(payload.category || "").trim();
    const points = String(payload.points || "").trim();

    if (!body) {
      setFormError(form, "Instructions are required.");
      return;
    }

    try {
      await apiFetch(
        `/api/classrooms/${encodeURIComponent(classroomId)}/modules/${encodeURIComponent(moduleId)}/assignments`,
        {
          method: "POST",
          body: JSON.stringify({
            title,
            body,
            dueAt: dueAt ? new Date(dueAt).toISOString() : "",
            category,
            points: points ? Number(points) : null,
          }),
        }
      );
      form.reset();
      setFormSuccess(form, "Assignment created.");
      await loadClassroomModules();
    } catch (err) {
      setFormError(form, err?.message || "Failed to create assignment.");
    }
  });
}

function initTeacherPeopleInteractions() {
  const container = document.querySelector("[data-classroom-people]");
  if (!container) return;

  container.addEventListener("click", async (e) => {
    const target = e.target;
    if (!(target instanceof HTMLElement)) return;

    const studentId = target.getAttribute("data-classroom-remove-student");
    if (!studentId) return;

    const classroomId = currentClassroomIdFromQuery();
    if (!classroomId) return;

    const ok = window.confirm("Remove this student from your class?");
    if (!ok) return;

    try {
      await apiFetch(
        `/api/classrooms/${encodeURIComponent(classroomId)}/people/${encodeURIComponent(studentId)}`,
        { method: "DELETE" }
      );
      await loadTeacherPeople();
    } catch (err) {
      // eslint-disable-next-line no-alert
      alert(err?.message || "Failed to remove student.");
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

    if (err?.status === 403 && mode === "login") {
      setFormError(form, "Invalid login.");
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

function linkifyTextToFragment(text) {
  const fragment = document.createDocumentFragment();
  const raw = String(text || "");
  if (!raw) return fragment;

  const urlRe = /\bhttps?:\/\/[^\s<]+/gi;
  let lastIndex = 0;
  let match;

  while ((match = urlRe.exec(raw))) {
    const start = match.index;
    const end = urlRe.lastIndex;

    if (start > lastIndex) {
      fragment.appendChild(document.createTextNode(raw.slice(lastIndex, start)));
    }

    const full = match[0];
    const trimmed = full.replace(/[)\].,;!?]+$/g, "");
    const trailing = full.slice(trimmed.length);

    const a = document.createElement("a");
    a.textContent = trimmed;
    a.href = trimmed;
    a.target = "_blank";
    a.rel = "noreferrer";
    fragment.appendChild(a);

    if (trailing) fragment.appendChild(document.createTextNode(trailing));

    lastIndex = end;
  }

  if (lastIndex < raw.length) {
    fragment.appendChild(document.createTextNode(raw.slice(lastIndex)));
  }

  return fragment;
}

function setTextWithLinks(el, text) {
  if (!el) return;
  el.textContent = "";
  el.appendChild(linkifyTextToFragment(text));
}

function renderUploadContent({ fileName, dataUrl }) {
  const wrap = document.createElement("div");
  wrap.className = "submission-upload";

  const name = String(fileName || "file");
  const url = String(dataUrl || "");

  const link = document.createElement("a");
  link.className = "submission-upload__link";
  link.textContent = name;

  if (url) {
    link.href = url;
    link.target = "_blank";
    link.rel = "noreferrer";
    link.download = name;
  } else {
    link.href = "#";
    link.addEventListener("click", (e) => e.preventDefault());
  }

  const meta = document.createElement("p");
  meta.className = "submission-upload__meta";
  meta.textContent = url ? "Open/download file" : "No file attached.";

  wrap.appendChild(link);
  wrap.appendChild(meta);

  if (!url) return wrap;

  const isImage = url.startsWith("data:image/");
  const isPdf = url.startsWith("data:application/pdf");
  const isVideo = url.startsWith("data:video/");
  const isAudio = url.startsWith("data:audio/");

  if (isImage) {
    const img = document.createElement("img");
    img.className = "submission-upload__preview";
    img.alt = name;
    img.src = url;
    wrap.appendChild(img);
  } else if (isPdf) {
    const iframe = document.createElement("iframe");
    iframe.className = "submission-upload__preview submission-upload__preview--doc";
    iframe.title = name;
    iframe.src = url;
    wrap.appendChild(iframe);
  } else if (isVideo) {
    const video = document.createElement("video");
    video.className = "submission-upload__preview submission-upload__preview--media";
    video.controls = true;
    video.src = url;
    wrap.appendChild(video);
  } else if (isAudio) {
    const audio = document.createElement("audio");
    audio.className = "submission-upload__preview submission-upload__preview--media";
    audio.controls = true;
    audio.src = url;
    wrap.appendChild(audio);
  }

  return wrap;
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
    meta.textContent = when ? `${when} - Announcement` : "Announcement";

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
  if (empty) empty.textContent = "Loading...";

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

  initStudentJoinClassroom();
  loadStudentClassrooms();
  loadStudentGradesSummaryPage();

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
    initClassroomAnnouncementDelete();
    initModuleCreate();
    initModulesInteractions();
    initTeacherPeopleInteractions();
    initTeacherGradebookInteractions();

    if (window.location.pathname.endsWith("/classroom") || window.location.pathname.endsWith("/classroom.html")) {
      prefetchTeacherModules(currentClassroomIdFromQuery());
    }

    const maybeLoad = () => {
      if (window.location.pathname.endsWith("/classroom") || window.location.pathname.endsWith("/classroom.html")) {
        const tab = String((window.location.hash || "").replace(/^#/, "") || "home");
        if (tab === "announcements") loadClassroomAnnouncements();
        if (tab === "home") loadClassroomRecentActivity();
        if (tab === "modules") loadClassroomModules();
        if (tab === "people") loadTeacherPeople();
        if (tab === "grades") loadTeacherGradebookMeta();
      }
    };

    window.addEventListener("blair:classroomTab", (e) => {
      const tab = e?.detail?.tab;
      if (tab === "announcements") loadClassroomAnnouncements();
      if (tab === "home") loadClassroomRecentActivity();
      if (tab === "modules") loadClassroomModules();
      if (tab === "people") loadTeacherPeople();
      if (tab === "grades") loadTeacherGradebookMeta();
    });

    // Load on first visit based on current tab
    maybeLoad();
  }

  if (pageKind() === "dashboard" && pageRole() === "student") {
    // Student classroom page
    if (window.location.pathname.endsWith("/classroom") || window.location.pathname.endsWith("/classroom.html")) {
      initTeacherClassroomTabs(); // reuse tab UI
      loadStudentClassroomDetails();
      prefetchStudentModules(currentClassroomIdFromQuery());

      const maybeLoad = () => {
        const tab = String((window.location.hash || "").replace(/^#/, "") || "home");
        if (tab === "home") loadStudentClassroomRecentActivity();
        if (tab === "announcements") loadStudentClassroomAnnouncements();
        if (tab === "modules") loadStudentClassroomModules();
        if (tab === "grades") loadStudentGrades();
      };

      window.addEventListener("blair:classroomTab", (e) => {
        const tab = e?.detail?.tab;
        if (tab === "home") loadStudentClassroomRecentActivity();
        if (tab === "announcements") loadStudentClassroomAnnouncements();
        if (tab === "modules") loadStudentClassroomModules();
        if (tab === "grades") loadStudentGrades();
      });

      maybeLoad();
    }
  }

  // Student assignment submission page (doesn't use `.portal-shell`).
  if (document.querySelector("form[data-assignment-submit]")) {
    initStudentAssignmentSubmission();
  }
}
