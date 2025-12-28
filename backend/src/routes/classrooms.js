const express = require("express");

const { requireAuth, requireTeacher } = require("../middleware/auth");
const { classroomsStore } = require("../store/classroomsStore");
const { classroomAnnouncementsStore } = require("../store/classroomAnnouncementsStore");
const { classroomModulesStore } = require("../store/classroomModulesStore");
const { classroomSubmissionsStore } = require("../store/classroomSubmissionsStore");
const { classroomMembershipsStore } = require("../store/classroomMembershipsStore");
const { classroomGradesStore } = require("../store/classroomGradesStore");
const { usersStore } = require("../store/usersStore");

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

  router.get("/:id/modules", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const items = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: req.userId,
      limit: req.query?.limit,
    });
    res.json({ items });
  });

  router.post("/:id/modules", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const title = String(req.body?.title || "").trim();
    const description = String(req.body?.description || "").trim();
    if (!title) return res.status(400).json({ error: "Module title is required" });
    if (title.length > 120) return res.status(400).json({ error: "Title is too long" });
    if (description.length > 800) return res.status(400).json({ error: "Description is too long" });

    const item = await classroomModulesStore.createModule({
      classroomId: classroom.id,
      teacherId: req.userId,
      title,
      description,
    });
    res.status(201).json({ item });
  });

  router.delete("/:id/modules/:moduleId", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    const moduleId = String(req.params?.moduleId || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });
    if (!moduleId) return res.status(400).json({ error: "Missing module id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const deleted = await classroomModulesStore.deleteModule({
      classroomId: classroom.id,
      teacherId: req.userId,
      moduleId,
    });
    if (!deleted) return res.status(404).json({ error: "Module not found" });
    res.json({ ok: true, deleted });
  });

  router.post(
    "/:id/modules/:moduleId/assignments",
    requireAuth,
    requireTeacher,
    async (req, res) => {
      const id = String(req.params?.id || "").trim();
      const moduleId = String(req.params?.moduleId || "").trim();
      if (!id) return res.status(400).json({ error: "Missing classroom id" });
      if (!moduleId) return res.status(400).json({ error: "Missing module id" });

      const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const title = String(req.body?.title || "").trim();
      const body = String(req.body?.body || "").trim();
      const dueAt = String(req.body?.dueAt || "").trim();
      const pointsRaw = req.body?.points;

      if (!body) return res.status(400).json({ error: "Instructions are required" });
      if (title.length > 120) return res.status(400).json({ error: "Title is too long" });
      if (body.length > 5000) return res.status(400).json({ error: "Instructions are too long" });

      let points = 100;
      if (pointsRaw !== "" && pointsRaw !== null && pointsRaw !== undefined) {
        const p = Number(pointsRaw);
        if (!Number.isFinite(p) || !Number.isInteger(p) || p <= 0) {
          return res.status(400).json({ error: "Points must be a whole number" });
        }
        if (p > 500) return res.status(400).json({ error: "Points is too high" });
        points = p;
      }

      const item = await classroomModulesStore.createAssignment({
        classroomId: classroom.id,
        teacherId: req.userId,
        moduleId,
        title,
        body,
        dueAt,
        points,
      });
      if (!item) return res.status(404).json({ error: "Module not found" });
      res.status(201).json({ item });
    }
  );

  router.delete(
    "/:id/modules/:moduleId/assignments/:assignmentId",
    requireAuth,
    requireTeacher,
    async (req, res) => {
      const id = String(req.params?.id || "").trim();
      const moduleId = String(req.params?.moduleId || "").trim();
      const assignmentId = String(req.params?.assignmentId || "").trim();
      if (!id) return res.status(400).json({ error: "Missing classroom id" });
      if (!moduleId) return res.status(400).json({ error: "Missing module id" });
      if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

      const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const deleted = await classroomModulesStore.deleteAssignment({
        classroomId: classroom.id,
        teacherId: req.userId,
        moduleId,
        assignmentId,
      });
      if (!deleted) return res.status(404).json({ error: "Assignment not found" });
      res.json({ ok: true, deleted });
    }
  );

  router.delete(
    "/:id/announcements/:announcementId",
    requireAuth,
    requireTeacher,
    async (req, res) => {
      const id = String(req.params?.id || "").trim();
      const announcementId = String(req.params?.announcementId || "").trim();
      if (!id) return res.status(400).json({ error: "Missing classroom id" });
      if (!announcementId) return res.status(400).json({ error: "Missing announcement id" });

      const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const deleted = await classroomAnnouncementsStore.deleteById({
        id: announcementId,
        teacherId: req.userId,
        classroomId: classroom.id,
      });
      if (!deleted) return res.status(404).json({ error: "Announcement not found" });

      res.json({ ok: true, deleted });
    }
  );

  router.get(
    "/:id/assignments/:assignmentId/submissions",
    requireAuth,
    requireTeacher,
    async (req, res) => {
      const id = String(req.params?.id || "").trim();
      const assignmentId = String(req.params?.assignmentId || "").trim();
      if (!id) return res.status(400).json({ error: "Missing classroom id" });
      if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

      const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const modules = await classroomModulesStore.listWithAssignments({
        classroomId: classroom.id,
        teacherId: req.userId,
        limit: 100,
      });
      const assignmentExists = modules.some(
        (m) => Array.isArray(m.assignments) && m.assignments.some((a) => a.id === assignmentId)
      );
      if (!assignmentExists) return res.status(404).json({ error: "Assignment not found" });

      const items = await classroomSubmissionsStore.listByAssignment({
        classroomId: classroom.id,
        assignmentId,
        limit: req.query?.limit,
      });

      const uniqueStudentIds = [...new Set(items.map((s) => s.studentId).filter(Boolean))];
      const students = new Map();
      for (const sid of uniqueStudentIds) {
        // eslint-disable-next-line no-await-in-loop
        const u = await usersStore.findById(sid);
        if (u) students.set(sid, { id: u.id, name: u.name, email: u.email });
      }

      res.json({
        items: items.map((s) => ({
          id: s.id,
          assignmentId: s.assignmentId,
          classroomId: s.classroomId,
          student: students.get(s.studentId) || { id: s.studentId, name: "Student", email: "" },
          type: s.type,
          payload: s.payload,
          createdAt: s.createdAt,
        })),
      });
    }
  );

  router.get("/:id/people", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const memberships = await classroomMembershipsStore.listByClassroom({ classroomId: classroom.id });
    const uniqueStudentIds = [...new Set(memberships.map((m) => m.studentId).filter(Boolean))];

    const students = new Map();
    for (const sid of uniqueStudentIds) {
      // eslint-disable-next-line no-await-in-loop
      const u = await usersStore.findById(sid);
      if (u) students.set(sid, { id: u.id, name: u.name, email: u.email, role: u.role });
    }

    res.json({
      items: memberships.map((m) => ({
        classroomId: m.classroomId,
        student: students.get(m.studentId) || { id: m.studentId, name: "Student", email: "", role: "" },
        joinedAt: m.createdAt,
      })),
    });
  });

  router.delete("/:id/people/:studentId", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    const studentId = String(req.params?.studentId || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });
    if (!studentId) return res.status(400).json({ error: "Missing student id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const deleted = await classroomMembershipsStore.remove({
      classroomId: classroom.id,
      studentId,
    });
    if (!deleted) return res.status(404).json({ error: "Student not found in this classroom" });
    res.json({ ok: true });
  });

  router.get("/:id/gradebook", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const modules = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: req.userId,
      limit: 200,
    });
    const assignments = [];
    for (const m of modules) {
      for (const a of Array.isArray(m.assignments) ? m.assignments : []) {
        assignments.push({
          id: a.id,
          title: a.title || "Assignment",
          body: a.body || "",
          dueAt: a.dueAt || "",
          points: a.points || "",
          moduleId: m.id,
          moduleTitle: m.title || "",
        });
      }
    }

    const memberships = await classroomMembershipsStore.listByClassroom({ classroomId: classroom.id });
    const uniqueStudentIds = [...new Set(memberships.map((m) => m.studentId).filter(Boolean))];

    const students = new Map();
    for (const sid of uniqueStudentIds) {
      // eslint-disable-next-line no-await-in-loop
      const u = await usersStore.findById(sid);
      if (u) students.set(sid, { id: u.id, name: u.name, email: u.email });
    }

    const people = memberships.map((m) => ({
      id: m.studentId,
      name: students.get(m.studentId)?.name || "Student",
      email: students.get(m.studentId)?.email || "",
      joinedAt: m.createdAt,
    }));

    const grades = await classroomGradesStore.listByClassroom({ classroomId: classroom.id });

    res.json({ classroom: { id: classroom.id, name: classroom.name }, assignments, people, grades });
  });

  router.put("/:id/grades", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const assignmentId = String(req.body?.assignmentId || "").trim();
    const studentId = String(req.body?.studentId || "").trim();
    const pointsEarned = req.body?.pointsEarned;
    const feedback = String(req.body?.feedback || "").trim();

    if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });
    if (!studentId) return res.status(400).json({ error: "Missing student id" });
    if (feedback.length > 5000) return res.status(400).json({ error: "Feedback is too long" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const membershipOk = await classroomMembershipsStore.isMember({
      classroomId: classroom.id,
      studentId,
    });
    if (!membershipOk) return res.status(404).json({ error: "Student not found in this classroom" });

    const modules = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: req.userId,
      limit: 200,
    });
    const assignment = modules
      .flatMap((m) => (Array.isArray(m.assignments) ? m.assignments : []))
      .find((a) => a.id === assignmentId);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    const maxPoints = Number(assignment.points);
    if (!Number.isFinite(maxPoints) || !Number.isInteger(maxPoints) || maxPoints <= 0) {
      return res.status(400).json({ error: "Assignment points not set" });
    }

    const peNum =
      pointsEarned === "" || pointsEarned === null || pointsEarned === undefined ? null : Number(pointsEarned);
    if (peNum !== null) {
      if (!Number.isFinite(peNum) || peNum < 0 || !Number.isInteger(peNum)) {
        return res.status(400).json({ error: "Points must be a whole number" });
      }
      if (peNum > maxPoints) return res.status(400).json({ error: `Points cannot exceed ${maxPoints}` });
    }

    const item = await classroomGradesStore.upsert({
      classroomId: classroom.id,
      assignmentId,
      studentId,
      teacherId: req.userId,
      pointsEarned: peNum,
      feedback,
    });
    res.json({ item });
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
