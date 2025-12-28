const express = require("express");

const { requireAuth, requireTeacher } = require("../middleware/auth");
const { classroomsStore } = require("../store/classroomsStore");

function buildClassroomsRouter() {
  const router = express.Router();

  router.get("/", requireAuth, requireTeacher, async (req, res) => {
    const items = await classroomsStore.listByTeacher({ teacherId: req.userId });
    res.json({ items });
  });

  router.post("/", requireAuth, requireTeacher, async (req, res) => {
    const name = String(req.body?.name || "").trim();
    const section = String(req.body?.section || "").trim();
    if (!name) return res.status(400).json({ error: "Name is required" });
    if (name.length > 120) return res.status(400).json({ error: "Name is too long" });
    if (section.length > 60) return res.status(400).json({ error: "Section is too long" });

    const classroom = await classroomsStore.create({
      teacherId: req.userId,
      name,
      section,
    });
    res.status(201).json({ item: classroom });
  });

  return router;
}

module.exports = { buildClassroomsRouter };

