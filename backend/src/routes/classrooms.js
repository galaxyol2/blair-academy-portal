const express = require("express");

const { requireAuth, requireTeacher } = require("../middleware/auth");
const { classroomsStore } = require("../store/classroomsStore");
const { classroomAnnouncementsStore } = require("../store/classroomAnnouncementsStore");
const { classroomModulesStore } = require("../store/classroomModulesStore");
const { classroomSubmissionsStore } = require("../store/classroomSubmissionsStore");
const { classroomMembershipsStore } = require("../store/classroomMembershipsStore");
const { classroomGradesStore } = require("../store/classroomGradesStore");
const { classroomGradeSettingsStore } = require("../store/classroomGradeSettingsStore");
const { classroomRubricsStore } = require("../store/classroomRubricsStore");
const { usersStore } = require("../store/usersStore");
const { computeStudentCurrentGradePercent, letterFromPercent } = require("../services/gradeSummary");

function buildClassroomsRouter() {
  const router = express.Router();

  function flattenAssignments(modules) {
    const out = [];
    for (const m of Array.isArray(modules) ? modules : []) {
      for (const a of Array.isArray(m.assignments) ? m.assignments : []) {
        out.push({ module: m, assignment: a });
      }
    }
    return out;
  }

  function findAssignmentOrNull(modules, assignmentId) {
    return (
      flattenAssignments(modules)
        .map(({ assignment }) => assignment)
        .find((a) => a.id === assignmentId) || null
    );
  }

  function weightSum(categories) {
    return (Array.isArray(categories) ? categories : []).reduce(
      (sum, c) => sum + (Number(c?.weightPct) || 0),
      0
    );
  }

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
      const category = String(req.body?.category || "").trim();

      if (!body) return res.status(400).json({ error: "Instructions are required" });
      if (title.length > 120) return res.status(400).json({ error: "Title is too long" });
      if (body.length > 5000) return res.status(400).json({ error: "Instructions are too long" });

      let points = 100;
      if (pointsRaw !== "" && pointsRaw !== null && pointsRaw !== undefined) {
        const p = Number(pointsRaw);
        if (!Number.isFinite(p) || !Number.isInteger(p) || p <= 0) {
          return res.status(400).json({ error: "Points must be a whole number" });
        }
        if (p > 100) return res.status(400).json({ error: "Points must be between 1 and 100" });
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
        category,
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
    for (const mod of modules) {
      for (const a of Array.isArray(mod.assignments) ? mod.assignments : []) {
        assignments.push({
          id: a.id,
          points: a.points || "",
          dueAt: a.dueAt || "",
          category: a.category || "Homework",
        });
      }
    }

    const allGrades = await classroomGradesStore.listByClassroom({ classroomId: classroom.id });
    const gradesByStudentId = new Map();
    for (const g of Array.isArray(allGrades) ? allGrades : []) {
      const sid = String(g.studentId || "").trim();
      if (!sid) continue;
      if (!gradesByStudentId.has(sid)) gradesByStudentId.set(sid, []);
      gradesByStudentId.get(sid).push(g);
    }

    const submittedByStudentId = await classroomSubmissionsStore.listSubmittedAssignmentIdsByStudentInClassroom({
      classroomId: classroom.id,
    });

    res.json({
      items: memberships.map((m) => ({
        classroomId: m.classroomId,
        student: students.get(m.studentId) || { id: m.studentId, name: "Student", email: "", role: "" },
        grade:
          m.studentId && students.get(m.studentId)?.role === "student"
            ? (() => {
                const percent = computeStudentCurrentGradePercent({
                  settings,
                  assignments,
                  grades: gradesByStudentId.get(String(m.studentId)) || [],
                  submittedAssignmentIds: submittedByStudentId[String(m.studentId)] || [],
                });
                return {
                  percent: percent == null ? null : Math.round(percent),
                  letter: percent == null ? "N/A" : letterFromPercent(percent),
                };
              })()
            : { percent: null, letter: "N/A" },
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

  router.get("/:id/grade-settings", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const item = await classroomGradeSettingsStore.getOrCreate({
      classroomId: classroom.id,
      teacherId: req.userId,
    });
    res.json({ item });
  });

  router.put("/:id/grade-settings", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const categories = req.body?.categories;
    const sum = weightSum(categories);
    if (Math.round(sum) !== 100) {
      return res.status(400).json({ error: "Category weights must add up to 100" });
    }

    const item = await classroomGradeSettingsStore.upsert({
      classroomId: classroom.id,
      teacherId: req.userId,
      categories,
      latePenaltyPerDayPct: req.body?.latePenaltyPerDayPct,
      maxLatePenaltyPct: req.body?.maxLatePenaltyPct,
    });
    res.json({ item });
  });

  router.get("/:id/assignments/:assignmentId/rubric", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    const assignmentId = String(req.params?.assignmentId || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });
    if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const modules = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: req.userId,
      limit: 200,
    });
    const assignment = findAssignmentOrNull(modules, assignmentId);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    const rubric = await classroomRubricsStore.getByAssignment({ classroomId: classroom.id, assignmentId });
    res.json({ item: rubric || { classroomId: classroom.id, assignmentId, rubric: [] } });
  });

  router.put("/:id/assignments/:assignmentId/rubric", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    const assignmentId = String(req.params?.assignmentId || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });
    if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const modules = await classroomModulesStore.listWithAssignments({
      classroomId: classroom.id,
      teacherId: req.userId,
      limit: 200,
    });
    const assignment = findAssignmentOrNull(modules, assignmentId);
    if (!assignment) return res.status(404).json({ error: "Assignment not found" });

    const maxPoints = Number(assignment.points);
    if (!Number.isFinite(maxPoints) || !Number.isInteger(maxPoints) || maxPoints <= 0) {
      return res.status(400).json({ error: "Assignment points not set" });
    }

    const rubric = req.body?.rubric;
    const sum = (Array.isArray(rubric) ? rubric : []).reduce(
      (total, r) => total + (Number(r?.pointsMax) || 0),
      0
    );
    if (Math.floor(sum) !== maxPoints) {
      return res.status(400).json({ error: `Rubric points must add up to ${maxPoints}` });
    }

    const item = await classroomRubricsStore.upsert({
      classroomId: classroom.id,
      assignmentId,
      teacherId: req.userId,
      rubric,
    });
    res.json({ item });
  });

  router.get("/:id/gradebook", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
    if (!classroom) return res.status(404).json({ error: "Classroom not found" });

    const settings = await classroomGradeSettingsStore.getOrCreate({
      classroomId: classroom.id,
      teacherId: req.userId,
    });

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
          category: a.category || "Homework",
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

    res.json({ classroom: { id: classroom.id, name: classroom.name }, settings, assignments, people });
  });

  router.get(
    "/:id/gradebook/assignment/:assignmentId",
    requireAuth,
    requireTeacher,
    async (req, res) => {
      const id = String(req.params?.id || "").trim();
      const assignmentId = String(req.params?.assignmentId || "").trim();
      if (!id) return res.status(400).json({ error: "Missing classroom id" });
      if (!assignmentId) return res.status(400).json({ error: "Missing assignment id" });

      const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const settings = await classroomGradeSettingsStore.getOrCreate({
        classroomId: classroom.id,
        teacherId: req.userId,
      });

      const modules = await classroomModulesStore.listWithAssignments({
        classroomId: classroom.id,
        teacherId: req.userId,
        limit: 200,
      });
      const assignment = findAssignmentOrNull(modules, assignmentId);
      if (!assignment) return res.status(404).json({ error: "Assignment not found" });

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

      const allGrades = await classroomGradesStore.listByClassroom({ classroomId: classroom.id });
      const grades = allGrades.filter((g) => g.assignmentId === assignmentId);

      const submissions = await classroomSubmissionsStore.listByAssignment({
        classroomId: classroom.id,
        assignmentId,
        limit: 800,
      });
      const latestByStudent = new Map();
      for (const s of submissions) {
        if (!s.studentId) continue;
        if (!latestByStudent.has(s.studentId)) latestByStudent.set(s.studentId, s);
      }

      const rubric = await classroomRubricsStore.getByAssignment({ classroomId: classroom.id, assignmentId });

      res.json({
        classroom: { id: classroom.id, name: classroom.name },
        settings,
        assignment: {
          id: assignment.id,
          title: assignment.title || "Assignment",
          dueAt: assignment.dueAt || "",
          points: assignment.points || "",
          category: assignment.category || "Homework",
        },
        rubric: rubric ? rubric.rubric : [],
        people,
        grades,
        submissions: [...latestByStudent.values()].map((s) => ({
          studentId: s.studentId,
          type: s.type,
          payload: s.payload,
          createdAt: s.createdAt,
        })),
      });
    }
  );

  router.get(
    "/:id/gradebook/student/:studentId",
    requireAuth,
    requireTeacher,
    async (req, res) => {
      const id = String(req.params?.id || "").trim();
      const studentId = String(req.params?.studentId || "").trim();
      if (!id) return res.status(400).json({ error: "Missing classroom id" });
      if (!studentId) return res.status(400).json({ error: "Missing student id" });

      const classroom = await classroomsStore.getByIdForTeacher({ teacherId: req.userId, id });
      if (!classroom) return res.status(404).json({ error: "Classroom not found" });

      const membershipOk = await classroomMembershipsStore.isMember({
        classroomId: classroom.id,
        studentId,
      });
      if (!membershipOk) return res.status(404).json({ error: "Student not found in this classroom" });

      const settings = await classroomGradeSettingsStore.getOrCreate({
        classroomId: classroom.id,
        teacherId: req.userId,
      });

      const modules = await classroomModulesStore.listWithAssignments({
        classroomId: classroom.id,
        teacherId: req.userId,
        limit: 200,
      });
      const assignments = flattenAssignments(modules).map(({ module, assignment }) => ({
        id: assignment.id,
        title: assignment.title || "Assignment",
        dueAt: assignment.dueAt || "",
        points: assignment.points || "",
        category: assignment.category || "Homework",
        moduleTitle: module.title || "",
      }));

      const allGrades = await classroomGradesStore.listByClassroom({ classroomId: classroom.id });
      const grades = allGrades.filter((g) => g.studentId === studentId);

      const submissions = await classroomSubmissionsStore.listByStudentInClassroom({
        classroomId: classroom.id,
        studentId,
        limit: 500,
      });

      const user = await usersStore.findById(studentId);
      const student = user ? { id: user.id, name: user.name, email: user.email } : { id: studentId, name: "Student", email: "" };

      res.json({ classroom: { id: classroom.id, name: classroom.name }, settings, student, assignments, grades, submissions });
    }
  );

  router.put("/:id/grades", requireAuth, requireTeacher, async (req, res) => {
    const id = String(req.params?.id || "").trim();
    if (!id) return res.status(400).json({ error: "Missing classroom id" });

    const assignmentId = String(req.body?.assignmentId || "").trim();
    const studentId = String(req.body?.studentId || "").trim();
    const pointsEarned = req.body?.pointsEarned;
    const feedback = String(req.body?.feedback || "").trim();
    const status = String(req.body?.status || "graded").trim().toLowerCase();
    const rubricScores = req.body?.rubricScores;
    const lateDaysOverride = req.body?.lateDaysOverride;

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

    const allowedStatus = new Set(["graded", "late", "missing", "excused"]);
    if (!allowedStatus.has(status)) return res.status(400).json({ error: "Invalid status" });

    const peNum =
      pointsEarned === "" || pointsEarned === null || pointsEarned === undefined ? null : Number(pointsEarned);
    if (status === "excused") {
      // Excused work is excluded from totals; store as null.
      // eslint-disable-next-line no-param-reassign
      // peNum is const; use a separate variable below.
    }

    let points = peNum;
    if (status === "missing") points = 0;
    if (status === "excused") points = null;

    if (points !== null) {
      if (!Number.isFinite(points) || points < 0 || !Number.isInteger(points)) {
        return res.status(400).json({ error: "Points must be a whole number" });
      }
      if (points > maxPoints) return res.status(400).json({ error: `Points cannot exceed ${maxPoints}` });
    }

    const item = await classroomGradesStore.upsert({
      classroomId: classroom.id,
      assignmentId,
      studentId,
      teacherId: req.userId,
      pointsEarned: points,
      feedback,
      status,
      rubricScores,
      lateDaysOverride,
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
