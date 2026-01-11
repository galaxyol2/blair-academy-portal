const express = require("express");

const { usersStore } = require("../store/usersStore");
const { hashPassword, verifyPassword } = require("../services/passwords");
const {
  signAccessToken,
  verifyAccessToken,
  signPasswordResetToken,
  verifyPasswordResetToken,
  signDiscordState,
  verifyDiscordState,
} = require("../services/tokens");
const { sendPasswordResetEmail } = require("../services/mailer");
const { postSignupLog } = require("../services/signupLog");
const { createFixedWindowRateLimiter, requestIp } = require("../middleware/rateLimit");

function normalizeEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function mapUserPayload(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role || "student",
    discordId: user.discordId || null,
    discordUsername: user.discordUsername || null,
    schedule: Array.isArray(user.schedule) ? user.schedule : [],
  };
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
  const rateLimitScheduleUpdate = createFixedWindowRateLimiter({
    windowMs: 60_000,
    max: 30,
    keyFn: (req) =>
      String(req.get("x-admin-key") || req.get("x-api-key") || "").trim() ||
      requestIp(req),
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

  function requireDiscordConfig() {
    const clientId = String(process.env.DISCORD_OAUTH_CLIENT_ID || "").trim();
    const clientSecret = String(process.env.DISCORD_OAUTH_CLIENT_SECRET || "").trim();
    const redirectUri = String(process.env.DISCORD_OAUTH_REDIRECT_URI || "").trim();
    if (!clientId || !clientSecret || !redirectUri) {
      const err = new Error("Discord OAuth is not configured");
      err.status = 501;
      throw err;
    }
    return { clientId, clientSecret, redirectUri };
  }

  function buildFrontendSettingsUrl(query = {}) {
    const baseRaw = String(process.env.FRONTEND_BASE_URL || "").trim();
    const base = baseRaw.replace(/\/+$/, "");
    const path = base ? `${base}/settings` : "/settings";
    const params = new URLSearchParams(query || {});
    return params.toString() ? `${path}?${params}` : path;
  }

  function buildDiscordAuthorizeUrl(userId) {
    const cfg = requireDiscordConfig();
    const state = signDiscordState({ userId });
    const url = new URL("https://discord.com/api/oauth2/authorize");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("client_id", cfg.clientId);
    url.searchParams.set("redirect_uri", cfg.redirectUri);
    url.searchParams.set("scope", "identify");
    url.searchParams.set("state", state);
    return url.toString();
  }

  function redirectToSettings(res, status) {
    const url = buildFrontendSettingsUrl({ discord: status });
    return res.redirect(url);
  }

  const scheduleCatalog = [
    { name: "Nutrition & Healthy Living", time: "Anyday after 5pm", instructor: "Professor Melly", category: "course" },
    { name: "Photography & Digital Imaging", time: "Tues 6-8pm, Thurs 10pm, Fri 7-11pm", instructor: "Professor Glo", category: "course" },
    { name: "Introduction to Journalism", time: "Anyday 6:30pm or 9pm CST", instructor: "Professor Twan", category: "course" },
    { name: "Introduction To Psychology", time: "Anyday after 8:30pm", instructor: "Professor Prices", category: "course" },
    { name: "Sexual & Reproductive Health", time: "Wed-Sat anytime after 6:30pm", instructor: "Professor Kim", category: "elective" },
    { name: "Literature & Film", time: "Mon & Thurs 8pm CST", instructor: "Professor Chosen", category: "course" },
    { name: "Influencer & Creator Marketing", time: "Anyday after 7pm EST", instructor: "Professor Tejada", category: "course" },
    { name: "Fitness & Strength Training", time: "Anyday after 6pm", instructor: "Professor Deuce Jackson", category: "elective" },
    { name: "Introduction of Art I", time: "Mon-Fri anytime between 3pm-11pm", instructor: "Professor Kyro", category: "elective" },
    { name: "Investigative Journalism", time: "Mon-Fri 2-10pm, weekends off", instructor: "Professor Ski Mask", category: "course" },
    { name: "Music Ensembles", time: "Any day and time", instructor: "Professor Yabitchoav aka Jordyn", category: "elective" },
    { name: "News Writing & Reporting", time: "Tues & Wed at 7:30pm EST", instructor: "Professor Gigi", category: "course" },
    { name: "Family Law", time: "Fri, Sat, Sun 7pm-12pm", instructor: "Professor Cobain", category: "course" },
  ];

  const catalogByName = new Map(
    scheduleCatalog.map((item) => [item.name.toLowerCase(), item])
  );

  function normalizeSchedule(input) {
    if (!Array.isArray(input)) return [];
    const items = [];
    const seen = new Set();
    for (const entry of input) {
      if (!entry) continue;
      if (typeof entry === "string") {
        const key = entry.trim().toLowerCase();
        if (!key || seen.has(key)) continue;
        const match = catalogByName.get(key);
        if (match) {
          items.push({ ...match });
          seen.add(key);
        }
        continue;
      }
      if (typeof entry === "object") {
        const name = String(entry.name || "").trim();
        const key = name.toLowerCase();
        if (!name || seen.has(key)) continue;
        const match = catalogByName.get(key);
        const time = String(entry.time || match?.time || "").trim();
        const instructor = String(entry.instructor || match?.instructor || "").trim();
        const category = String(entry.category || match?.category || "").trim().toLowerCase();
        items.push({ name, time, instructor, category: category || match?.category || "" });
        seen.add(key);
      }
    }
    return items;
  }

  function requireAdminKey(req, res, next) {
    const expected = String(process.env.ADMIN_API_KEY || "").trim();
    if (!expected) return res.status(501).json({ error: "Admin API not configured" });

    const got = String(req.get("x-admin-key") || req.get("x-api-key") || "").trim();
    if (!got || got !== expected) return res.status(401).json({ error: "Unauthorized" });

    return next();
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
      user: mapUserPayload(user),
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

    postSignupLog({ user }).catch((err) => {
      // eslint-disable-next-line no-console
      console.error(`[signup-log] Failed: ${err.message || err}`);
    });

    const token = signAccessToken({ userId: user.id });
    res.json({ token, user: mapUserPayload(user) });
  });

  router.post("/login", rateLimitLogin, async (req, res) => {
    const email = normalizeEmail(req.body?.email);
    const password = String(req.body?.password || "");

    if (!email) return res.status(400).json({ error: "Email is required" });
    if (!password) return res.status(400).json({ error: "Password is required" });

    const user = await usersStore.findByEmail(email);
    if (!user) return res.status(401).json({ error: "Invalid email or password" });
    if (String(user.role || "student").toLowerCase() === "teacher") {
      return res.status(403).json({ error: "Use teacher login" });
    }

    const ok = await verifyPassword(password, user.passwordHash);
    if (!ok) return res.status(401).json({ error: "Invalid email or password" });

    const token = signAccessToken({ userId: user.id });
    res.json({
      token,
      user: mapUserPayload(user),
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
    res.json({ token, user: mapUserPayload(user) });
  });

  router.get("/me", requireAuth, async (req, res) => {
    const user = req.user;
    res.json({
      user: mapUserPayload(user),
    });
  });

  router.get("/schedule", requireAuth, async (req, res) => {
    const user = req.user;
    res.json({
      schedule: Array.isArray(user?.schedule) ? user.schedule : [],
    });
  });

  router.post("/schedule", requireAdminKey, rateLimitScheduleUpdate, async (req, res) => {
    const discordId = String(req.body?.discordId || "").trim();
    const rawSchedule = Array.isArray(req.body?.schedule)
      ? req.body.schedule
      : Array.isArray(req.body?.classes)
        ? req.body.classes
        : [];
    if (!discordId) return res.status(400).json({ error: "discordId is required" });

    const user = await usersStore.findByDiscordId(discordId);
    if (!user) return res.status(404).json({ error: "User not found" });

    const schedule = normalizeSchedule(rawSchedule);
    const updated = await usersStore.updateSchedule({ userId: user.id, schedule });
    res.json({ ok: true, schedule: Array.isArray(updated?.schedule) ? updated.schedule : [] });
  });

  router.get("/discord/link", requireAuth, async (req, res) => {
    try {
      const url = buildDiscordAuthorizeUrl(req.user.id);
      res.json({ url });
    } catch (err) {
      const status = err?.status || 500;
      res.status(status).json({ error: err?.message || "Unable to build Discord link." });
    }
  });

  router.delete("/discord", requireAuth, async (req, res) => {
    await usersStore.unlinkDiscord(req.user.id);
    res.json({ ok: true });
  });

  router.get("/discord/callback", async (req, res) => {
    const code = String(req.query?.code || "").trim();
    const state = String(req.query?.state || "").trim();
    if (!code || !state) {
      return redirectToSettings(res, "error");
    }

    let payload;
    try {
      payload = verifyDiscordState(state);
    } catch (err) {
      return redirectToSettings(res, "error");
    }

    const user = await usersStore.findById(payload.userId);
    if (!user) return redirectToSettings(res, "error");

    const { clientId, clientSecret, redirectUri } = requireDiscordConfig();

    try {
      const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          client_id: clientId,
          client_secret: clientSecret,
          grant_type: "authorization_code",
          code,
          redirect_uri: redirectUri,
          scope: "identify",
        }),
      });

      if (!tokenRes.ok) {
        return redirectToSettings(res, "error");
      }

      const tokenData = await tokenRes.json().catch(() => null);
      if (!tokenData?.access_token) {
        return redirectToSettings(res, "error");
      }

      const discordRes = await fetch("https://discord.com/api/users/@me", {
        headers: { Authorization: `Bearer ${tokenData.access_token}` },
      });

      if (!discordRes.ok) {
        return redirectToSettings(res, "error");
      }

      const discordUser = await discordRes.json().catch(() => null);
      if (!discordUser?.id) {
        return redirectToSettings(res, "error");
      }

      const tag = `${discordUser.username || "someone"}#${discordUser.discriminator || "0000"}`;
      await usersStore.linkDiscord({
        userId: user.id,
        discordId: discordUser.id,
        discordUsername: tag,
      });
      return redirectToSettings(res, "linked");
    } catch (err) {
      if (err?.code === "discord_conflict") {
        return redirectToSettings(res, "conflict");
      }
      return redirectToSettings(res, "error");
    }
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
