const express = require("express");

const { usersStore } = require("../store/usersStore");
const { hashPassword, verifyPassword } = require("../services/passwords");
const { signAccessToken } = require("../services/tokens");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildAuthRouter() {
  const router = express.Router();

  router.post("/signup", async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!name) return res.status(400).json({ error: "Name is required" });
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await usersStore.findByEmail(email);
    if (existing) return res.status(409).json({ error: "Email already in use" });

    const passwordHash = await hashPassword(password);
    const user = await usersStore.create({ name, email, passwordHash });

    const token = signAccessToken({ userId: user.id });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  });

  router.post("/login", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = await usersStore.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signAccessToken({ userId: user.id });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email } });
  });

  router.post("/forgot-password", async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Intentionally do not reveal whether the email exists.
    // Hook this up to email sending + reset tokens later.
    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildAuthRouter };

