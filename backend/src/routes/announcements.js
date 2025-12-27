const express = require("express");

const { announcementsStore } = require("../store/announcementsStore");

function requireAdminKey(req, res, next) {
  const expected = String(process.env.ADMIN_API_KEY || "").trim();
  if (!expected) return res.status(501).json({ error: "Admin API not configured" });

  const got =
    String(req.get("x-admin-key") || req.get("x-api-key") || "").trim();
  if (!got || got !== expected) return res.status(401).json({ error: "Unauthorized" });

  return next();
}

function validateAnnouncementInput({ title, body }) {
  const t = String(title || "").trim();
  const b = String(body || "").trim();
  if (!t) return { ok: false, error: "Title is required" };
  if (!b) return { ok: false, error: "Body is required" };
  if (t.length > 120) return { ok: false, error: "Title is too long" };
  if (b.length > 5000) return { ok: false, error: "Body is too long" };
  return { ok: true, title: t, body: b };
}

function buildAnnouncementsRouter() {
  const router = express.Router();

  router.get("/", async (req, res) => {
    const limit = req.query?.limit;
    const items = await announcementsStore.list({ limit });
    res.json({ items });
  });

  return router;
}

function buildAdminAnnouncementsRouter() {
  const router = express.Router();

  router.post("/announcements", requireAdminKey, async (req, res) => {
    const input = validateAnnouncementInput({
      title: req.body?.title,
      body: req.body?.body,
    });
    if (!input.ok) return res.status(400).json({ error: input.error });

    const source = String(req.body?.source || "manual").trim() || "manual";
    const createdBy = String(req.body?.createdBy || "").trim();

    const announcement = await announcementsStore.create({
      title: input.title,
      body: input.body,
      source,
      createdBy,
    });
    res.status(201).json({ item: announcement });
  });

  return router;
}

module.exports = { buildAnnouncementsRouter, buildAdminAnnouncementsRouter };

