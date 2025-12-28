const express = require("express");

const { requireAuth, requireTeacher } = require("../middleware/auth");
const { classroomsStore } = require("../store/classroomsStore");
const { classroomAnnouncementsStore } = require("../store/classroomAnnouncementsStore");

function buildClassroomsRouter() {
  const router = express.Router();

  router.get("/", requireAuth, requireTeacher, async (req, res) => {
    const items = await classroomsStore.listByTeacher({ teacherId: req.userId });
    res.json({ items });
  });

  router.get("/:id", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const item = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!item) return res.status(404).json({ error: "Classroom not found" });
    res.json({ item });
  });

  router.get("/:id/announcements", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const limit = req.query?.limit;
    const items = await classroomAnnouncementsStore.listByClassroom({
      classroomId: classroom.id,
      limit,
    });
    res.json({ items });
  });

  router.post("/:id/announcements", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const title = String(req.body?.title || "").trim();
    const body = String(req.body?.body || "").trim();
    if (!body) return res.status(400).json({ error: "Message is required" });
    if (title.length > 120) return res.status(400).json({ error: "Title is too long" });
    if (body.length > 5000) return res.status(400).json({ error: "Message is too long" });

    const item = await classroomAnnouncementsStore.create({
      classroomId: classroom.id,
      teacherId: req.userId,
      title,
      body,
    });
    res.status(201).json({ item });
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
