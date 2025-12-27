const path = require("path");

const express = require("express");
const cors = require("cors");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { buildAuthRouter } = require("./routes/auth");
const { buildAdminUsersRouter } = require("./routes/adminUsers");
const {
  buildAnnouncementsRouter,
  buildAdminAnnouncementsRouter,
} = require("./routes/announcements");

const app = express();

// Trust Railway/hosted proxies so req.ip reflects the real client IP (used for rate limiting).
app.set("trust proxy", 1);

app.use(express.json({ limit: "1mb" }));

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

app.use(
  cors({
    origin(origin, callback) {
      if (!allowed) return callback(null, true);
      if (!origin) return callback(null, true); // non-browser requests
      const o = normalizeOrigin(origin);
      return callback(null, allowed.includes(o));
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
app.use("/api/admin", buildAdminAnnouncementsRouter());
app.use("/api/admin", buildAdminUsersRouter());

const port = Number(process.env.PORT || 3001);
app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(
    `User store: ${process.env.DATABASE_URL ? "postgres (DATABASE_URL set)" : "json (no DATABASE_URL)"}`
  );
  // eslint-disable-next-line no-console
  console.log(`API listening on http://localhost:${port}`);
});
