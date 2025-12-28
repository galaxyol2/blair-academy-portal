const express = require("express");

const { requireAuth, requireStudent } = require("../middleware/auth");
const { classroomsStore } = require("../store/classroomsStore");
const { classroomMembershipsStore } = require("../store/classroomMembershipsStore");
const { classroomAnnouncementsStore } = require("../store/classroomAnnouncementsStore");
const { classroomModulesStore } = require("../store/classroomModulesStore");
const { classroomSubmissionsStore } = require("../store/classroomSubmissionsStore");
const { classroomGradesStore } = require("../store/classroomGradesStore");
const { classroomGradeSettingsStore } = require("../store/classroomGradeSettingsStore");

function buildStudentClassroomsRouter() {
  const router = express.Router();

  async function requireMembership(req, res, next) {
    const classroomId = String(req.params?.id || "").trim();
    if (!classroomId) return res.status(400).json({ error: "Missing classroom id" });
    const ok = await classroomMembershipsStore.isMember({
      classroomId,
      studentId: req.userId,
    });
    if (!ok) return res.status(403).json({ error: "Forbidden" });
    req.classroomId = classroomId;
    return next();
  }

  router.post("/join", requireAuth, requireStudent, async (req, res) => {
    const joinCode = String(req.body?.joinCode || "").trim();
    if (!joinCode) return res.status(400).json({ error: "Join code is required" });

    const classroom = await classroomsStore.findByJoinCode(joinCode);
    if (!classroom) return res.status(404).json({ error: "Invalid join code" });

    await classroomMembershipsStore.join({
      classroomId: classroom.id,
      studentId: req.userId,
    });

    res.json({
      ok: true,
      classroom: {
        id: classroom.id,
        name: classroom.name,
        section: classroom.section,
      },
    });
  });

  router.get("/", requireAuth, requireStudent, async (req, res) => {
    const memberships = await classroomMembershipsStore.listByStudent({ studentId: req.userId });
    const classrooms = [];
    for (const m of memberships) {
      const c = await classroomsStore.getById(m.classroomId);
      if (!c) continue;
      classrooms.push({ id: c.id, name: c.name, section: c.section });
    }
    res.json({ items: classrooms });
  });

  router.get("/:id", requireAuth, requireStudent, requireMembership, async (req, res) => {
    const classroom = await classroomsStore.getById(req.classroomId);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });
    res.json({
      item: { id: classroom.id, name: classroom.name, section: classroom.section, joinCode: classroom.joinCode },
    });
  });

  router.get(
    "/:id/announcements",
    requireAuth,
    requireStudent,
    requireMembership,
    async (req, res) => {
      const classroom = await classroomsStore.getById(req.classroomId);
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const items = await classroomAnnouncementsStore.listByClassroom({
        classroomId: classroom.id,
        limit: req.query?.limit,
      });
      res.json({ items });
    }
  );

  router.get("/:id/modules", requireAuth, requireStudent, requireMembership, async (req, res) => {
    const classroom = await classroomsStore.getById(req.classroomId);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const items = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: classroom.teacherId,
      limit: req.query?.limit,
    });
    res.json({ items });
  });

  router.get("/:id/grades", requireAuth, requireStudent, requireMembership, async (req, res) => {
    const classroom = await classroomsStore.getById(req.classroomId);
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const settings = await classroomGradeSettingsStore.getOrCreate({
      classroomId: classroom.id,
      teacherId: classroom.teacherId,
    });

    const modules = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: classroom.teacherId,
      limit: 200,
    });
    const assignments = [];
    for (const m of modules) {
      for (const a of Array.isArray(m.assignments) ? m.assignments : []) {
        assignments.push({
          id: a.id,
          title: a.title || "Assignment",
          dueAt: a.dueAt || "",
          points: a.points || "",
          category: a.category || "Homework",
          moduleTitle: m.title || "",
        });
      }
    }

    const grades = await classroomGradesStore.listByStudent({
      classroomId: classroom.id,
      studentId: req.userId,
    });

    const submissions = await classroomSubmissionsStore.listByStudentInClassroom({
      classroomId: classroom.id,
      studentId: req.userId,
      limit: 500,
    });

    res.json({ settings, assignments, grades, submissions });
  });

  router.get(
    "/:id/assignments/:assignmentId/submissions",
    requireAuth,
    requireStudent,
    requireMembership,
    async (req, res) => {
      const assignmentId = String(req.params?.assignmentId || "").trim();
      if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

      const items = await classroomSubmissionsStore.listByStudent({
        classroomId: req.classroomId,
        assignmentId,
        studentId: req.userId,
        limit: req.query?.limit,
      });
      res.json({ items });
    }
  );

  router.post(
    "/:id/assignments/:assignmentId/submissions",
    requireAuth,
    requireStudent,
    requireMembership,
    async (req, res) => {
      const assignmentId = String(req.params?.assignmentId || "").trim();
      if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

      const classroom = await classroomsStore.getById(req.classroomId);
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const modules = await classroomModulesStore.listWithAssignments({
        classroomId: classroom.id,
        teacherId: classroom.teacherId,
        limit: 100,
      });
      const assignmentExists = modules.some(
        (m) => Array.isArray(m.assignments) && m.assignments.some((a) => a.id === assignmentId)
      );
      if (!assignmentExists) return res.status(404).json({ error: "Assignment not found" });

      const type = String(req.body?.type || "").trim().toLowerCase();
      const payload = req.body?.payload;

      const allowedTypes = new Set(["text", "url", "upload"]);
      if (!allowedTypes.has(type)) return res.status(400).json({ error: "Invalid submission type" });
      if (!payload || typeof payload !== "object") {
        return res.status(400).json({ error: "Invalid payload" });
      }

      if (type === "text") {
        const text = String(payload.text || "").trim();
        if (!text) return res.status(400).json({ error: "Text is required" });
        if (text.length > 10000) return res.status(400).json({ error: "Text is too long" });
      }

      if (type === "url") {
        const url = String(payload.url || "").trim();
        if (!url) return res.status(400).json({ error: "URL is required" });
        if (url.length > 2000) return res.status(400).json({ error: "URL is too long" });
      }

      if (type === "upload") {
        const fileName = String(payload.fileName || "").trim();
        const dataUrl = String(payload.dataUrl || "").trim();
        if (!fileName || !dataUrl) return res.status(400).json({ error: "File is required" });
        // Basic safety cap (~2MB base64)
        if (dataUrl.length > 3_000_000) return res.status(400).json({ error: "File is too large" });
      }

      const item = await classroomSubmissionsStore.create({
        classroomId: req.classroomId,
        assignmentId,
        studentId: req.userId,
        type,
        payload,
      });
      res.status(201).json({ item });
    }
  );

  return router;
}

module.exports = { buildStudentClassroomsRouter };
