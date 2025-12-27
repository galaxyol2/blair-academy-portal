const express = require("express");

const { usersStore } = require("../store/usersStore");

function createFixedWindowRateLimiter({ windowMs, max, keyFn }) {
  const buckets = new Map();

  return function rateLimit(req, res, next) {
    const now = Date.now();
    const key = String(keyFn(req) || "").trim() || "anonymous";

    let bucket = buckets.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }

    bucket.count += 1;
    if (bucket.count > max) {
      const retryAfterSeconds = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
      res.set("Retry-After", String(retryAfterSeconds));
      return res.status(429).json({ error: "Too many requests" });
    }

    return next();
  };
}

function requireAdminKey(req, res, next) {
  const expected = String(process.env.ADMIN_API_KEY || "").trim();
  if (!expected) return res.status(501).json({ error: "Admin API not configured" });

  const got = String(req.get("x-admin-key") || req.get("x-api-key") || "").trim();
  if (!got || got !== expected) return res.status(401).json({ error: "Unauthorized" });

  return next();
}

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildAdminUsersRouter() {
  const router = express.Router();

  // 5 deletions per minute per admin key (fallback to IP for safety).
  const rateLimitDeletes = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 5,
    keyFn: (req) =>
      String(req.get("x-admin-key") || req.get("x-api-key") || "").trim() ||
      String(req.ip || "").trim(),
  });

  // Delete a user so they can re-create their account with the same email.
  // NOTE: JWTs are stateless; existing tokens may remain valid until expiry.
  router.delete("/users", requireAdminKey, rateLimitDeletes, async (req, res) => {
    const email = normalizeEmail(req.query?.email);
    if (!email) return res.status(400).json({ error: "Email is required" });

    const deleted = await usersStore.deleteByEmail(email);
    if (!deleted) return res.status(404).json({ error: "User not found" });

    res.json({ ok: true, deleted: { id: deleted.id, email: deleted.email, name: deleted.name } });
  });

  return router;
}

module.exports = { buildAdminUsersRouter };
