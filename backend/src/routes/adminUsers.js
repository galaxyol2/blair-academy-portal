const express = require("express");

const { usersStore } = require("../store/usersStore");
const { createFixedWindowRateLimiter, requestIp } = require("../middleware/rateLimit");

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
      requestIp(req),
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
