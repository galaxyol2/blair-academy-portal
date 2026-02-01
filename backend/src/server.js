const path = require("path");

const express = require("express");
const cors = require("cors");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { buildAuthRouter } = require("./routes/auth");
const { buildAdminUsersRouter } = require("./routes/adminUsers");
const { buildClassroomsRouter } = require("./routes/classrooms");
const { buildStudentClassroomsRouter } = require("./routes/studentClassrooms");
const {
  buildAnnouncementsRouter,
  buildAdminAnnouncementsRouter,
} = require("./routes/announcements");

const app = express();

// Trust Railway/hosted proxies so req.ip reflects the real client IP (used for rate limiting).
app.set("trust proxy", 1);

// Upload submissions are sent as base64 in JSON; keep this above the expected max upload size.
app.use(express.json({ limit: "6mb" }));

function normalizeOrigin(value) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (v.startsWith("http://") || v.startsWith("https://")) return v.replace(/\/+$/, "");
  return `https://${v.replace(/\/+$/, "")}`;
}

function allowedOrigins() {
  const raw = String(process.env.CORS_ORIGIN || "").trim();
  if (!raw) return null; // allow all
  return raw
    .split(",")
    .map((s) => normalizeOrigin(s))
    .filter(Boolean);
}

const allowed = allowedOrigins();
const allowedWildcards = (allowed || []).filter((o) => o.includes("*."));
const strictCors =
  ["1", "true", "yes"].includes(String(process.env.CORS_STRICT || "").trim().toLowerCase()) &&
  Boolean(allowed && allowed.length);

function originMatchesWildcard(origin, pattern) {
  // pattern like: https://*.vercel.app
  try {
    const o = new URL(origin);
    const p = new URL(pattern.replace("*.", "wildcard."));
    if (o.protocol !== p.protocol) return false;
    const suffix = p.hostname.replace(/^wildcard\./, "");
    return o.hostname === suffix || o.hostname.endsWith(`.${suffix}`);
  } catch {
    return false;
  }
}

function isAlwaysAllowedOrigin(origin) {
  try {
    const o = new URL(origin);
    if (o.hostname === "localhost" || o.hostname === "127.0.0.1") return true;
    if (o.hostname.endsWith(".vercel.app")) return true;
  } catch {
    // ignore
  }
  return false;
}

app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true); // non-browser requests
      const o = normalizeOrigin(origin);
      if (isAlwaysAllowedOrigin(origin) || isAlwaysAllowedOrigin(o)) return callback(null, true);
      if (!strictCors) return callback(null, true);
      if (allowed.includes(o)) return callback(null, true);
      if (allowedWildcards.some((p) => originMatchesWildcard(o, p))) return callback(null, true);
      return callback(null, false);
    },
    credentials: true,
  })
);

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    userStore: process.env.DATABASE_URL ? "postgres" : "json",
    announcementsStore: process.env.DATABASE_URL ? "postgres" : "json",
  });
});

app.use("/api/auth", buildAuthRouter());
app.use("/api/announcements", buildAnnouncementsRouter());
app.use("/api/classrooms", buildClassroomsRouter());
app.use("/api/student/classrooms", buildStudentClassroomsRouter());
app.use("/api/admin", buildAdminAnnouncementsRouter());
app.use("/api/admin", buildAdminUsersRouter());

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  console.log(
    `User store: ${process.env.DATABASE_URL ? "postgres (DATABASE_URL set)" : "json (no DATABASE_URL)"}`
  );
  console.log(`API listening on http://localhost:${port}`);
});
