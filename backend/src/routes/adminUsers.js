const express = require("express");

const { usersStore } = require("../store/usersStore");
const { hashPassword } = require("../services/passwords");
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
  const rateLimitPasswordResets = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 10,
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

  router.put("/users/name", requireAdminKey, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const firstName = String(req.body?.firstName || "").trim();
    const lastName = String(req.body?.lastName || "").trim();
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!firstName && !lastName) return res.status(400).json({ error: "firstName or lastName is required" });

    const updated = await usersStore.updateNameByEmail({ email, firstName: firstName || null, lastName: lastName || null });
    if (!updated) return res.status(404).json({ error: "User not found" });
    res.json({ ok: true, user: updated });
  });

  router.post("/users/reset-password", requireAdminKey, rateLimitPasswordResets, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const newPassword = String(req.body?.newPassword || "");
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const user = await usersStore.findByEmail(email);
    if (!user) return res.status(404).json({ error: "User not found" });

    const passwordHash = await hashPassword(newPassword);
    const updated = await usersStore.updatePassword({ userId: user.id, passwordHash });
    if (!updated) return res.status(404).json({ error: "User not found" });

    res.json({ ok: true, user: { id: updated.id, email: updated.email, name: updated.name } });
  });

  return router;
}

module.exports = { buildAdminUsersRouter };
