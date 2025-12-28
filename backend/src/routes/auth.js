const express = require("express");

const { usersStore } = require("../store/usersStore");
const { hashPassword, verifyPassword } = require("../services/passwords");
const {
  signAccessToken,
  verifyAccessToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
} = require("../services/tokens");
const { sendPasswordResetEmail } = require("../services/mailer");
const { postSignupLog } = require("../services/signupLog");
const { createFixedWindowRateLimiter, requestIp } = require("../middleware/rateLimit");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function buildAuthRouter() {
  const router = express.Router();

  const rateLimitSignup = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 5,
    keyFn: requestIp,
  });
  const rateLimitLogin = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 15,
    keyFn: requestIp,
  });
  const rateLimitForgotPassword = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 5,
    keyFn: requestIp,
  });
  const rateLimitResetPassword = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 10,
    keyFn: requestIp,
  });

  function expectedSignupCode() {
    return String(process.env.SIGNUP_CODE || "BLAIR-F25-9KQ7").trim();
  }

  function expectedTeacherSignupCode() {
    return String(process.env.TEACHER_SIGNUP_CODE || expectedSignupCode()).trim();
  }

  async function requireAuth(req, res, next) {
    const header = String(req.get("authorization") || "");
    const match = header.match(/^Bearer\s+(.+)$/i);
    const token = match ? match[1].trim() : "";
    if (!token) return res.status(401).json({ error: "Missing access token" });

    try {
      const { userId } = verifyAccessToken(token);
      req.userId = userId;
      const user = await usersStore.findById(userId);
      if (!user) return res.status(401).json({ error: "Invalid access token" });
      req.user = user;
      return next();
    } catch (_err) {
      return res.status(401).json({ error: "Invalid access token" });
    }
  }

  function validateFullName(name) {
    const parts = String(name || "")
      .trim()
      .split(/\s+/)
      .filter(Boolean);
    if (parts.length < 2) return false;
    return parts.every((p) => p.length >= 2);
  }

  router.post("/signup", rateLimitSignup, async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const signupCode = String(req.body?.signupCode || "").trim();

    if (signupCode !== expectedSignupCode()) {
      return res.status(401).json({ error: "Invalid sign up code" });
    }
    if (!validateFullName(name)) {
      return res.status(400).json({ error: "First and last name are required" });
    }
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await usersStore.findByEmail(email);
    if (existing) {
      const existingRole = String(existing.role || "student").toLowerCase();
      return res.status(409).json({
        error:
          existingRole === "teacher"
            ? "That email is already linked to a teacher/employee account"
            : "That email is already linked to a student account",
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await usersStore.create({ name, email, passwordHash, role: "student" });
    if (!user) return res.status(409).json({ error: "Email already in use" });

    postSignupLog({ user }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[signup-log] Failed: ${err.message || err}`);
    });

    const token = signAccessToken({ userId: user.id });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role || "student" },
    });
  });

  router.post("/teacher/signup", rateLimitSignup, async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");
    const signupCode = String(req.body?.signupCode || "").trim();

    if (signupCode !== expectedTeacherSignupCode()) {
      return res.status(401).json({ error: "Invalid sign up code" });
    }
    if (!validateFullName(name)) {
      return res.status(400).json({ error: "First and last name are required" });
    }
    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    const existing = await usersStore.findByEmail(email);
    if (existing) {
      const existingRole = String(existing.role || "student").toLowerCase();
      return res.status(409).json({
        error:
          existingRole === "teacher"
            ? "That email is already linked to a teacher/employee account"
            : "That email is already linked to a student account",
      });
    }

    const passwordHash = await hashPassword(password);
    const user = await usersStore.create({ name, email, passwordHash, role: "teacher" });
    if (!user) return res.status(409).json({ error: "Email already in use" });

    const token = signAccessToken({ userId: user.id });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: "teacher" } });
  });

  router.post("/login", rateLimitLogin, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = await usersStore.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signAccessToken({ userId: user.id });
    res.json({
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role || "student" },
    });
  });

  router.post("/teacher/login", rateLimitLogin, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = await usersStore.findByEmail(email);
    if (!user || user.role !== "teacher") {
      return res.status(401).json({ error: "Invalid email or password" });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signAccessToken({ userId: user.id });
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, role: "teacher" } });
  });

  router.get("/me", requireAuth, async (req, res) => {
    const user = req.user;
    res.json({
      user: { id: user.id, name: user.name, email: user.email, role: user.role || "student" },
    });
  });

  router.post("/change-password", requireAuth, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || "");
    const newPassword = String(req.body?.newPassword || "");

    if (!currentPassword) {
      return res.status(400).json({ error: "Current password is required" });
    }
    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: "New password must be at least 8 characters" });
    }

    const user = req.user;
    if (!user) return res.status(401).json({ error: "Invalid access token" });

    const ok = await verifyPassword(currentPassword, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Current password is incorrect" });

    const passwordHash = await hashPassword(newPassword);
    await usersStore.updatePassword({ userId: user.id, passwordHash });
    res.json({ ok: true });
  });

  router.post("/forgot-password", rateLimitForgotPassword, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    if (!email) return res.status(400).json({ error: "Email is required" });

    // Intentionally do not reveal whether the email exists.
    const user = await usersStore.findByEmail(email);
    if (!user) {
      // eslint-disable-next-line no-console
      console.log(`[password-reset] No user for: ${email}`);
    } else {
      const token = signPasswordResetToken({ userId: user.id });
      try {
        await sendPasswordResetEmail({ to: email, token });
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`[password-reset] Failed to send to: ${email}`);
        // eslint-disable-next-line no-console
        console.error(err);
      }
    }

    res.json({ ok: true });
  });

  router.post("/reset-password", rateLimitResetPassword, async (req, res) => {
    const token = String(req.body?.token || "").trim();
    const password = String(req.body?.password || "");

    if (!token) return res.status(400).json({ error: "Token is required" });
    if (!password || password.length < 8) {
      return res.status(400).json({ error: "Password must be at least 8 characters" });
    }

    let userId;
    try {
      ({ userId } = verifyPasswordResetToken(token));
    } catch (err) {
      return res.status(401).json({ error: "Invalid or expired reset token" });
    }

    const user = await usersStore.findById(userId);
    if (!user) return res.status(401).json({ error: "Invalid or expired reset token" });

    const passwordHash = await hashPassword(password);
    await usersStore.updatePassword({ userId: user.id, passwordHash });

    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildAuthRouter };
