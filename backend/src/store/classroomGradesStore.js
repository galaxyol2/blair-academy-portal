const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { grades: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_GRADES_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-grades.json")
  );
}

function normalizePoints(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (n < 0) return null;
  return Math.round(n * 100) / 100;
}

function createJsonClassroomGradesStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async listByClassroom({ classroomId }) {
      const db = await readDb();
      return db.grades
        .filter((g) => g.classroomId === classroomId)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    },

    async listByStudent({ classroomId, studentId }) {
      const db = await readDb();
      return db.grades
        .filter((g) => g.classroomId === classroomId && g.studentId === studentId)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
    },

    async upsert({ classroomId, assignmentId, studentId, teacherId, pointsEarned, feedback }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const pe = normalizePoints(pointsEarned);
      const fb = String(feedback || "").trim();

      const idx = db.grades.findIndex(
        (g) =>
          g.classroomId === classroomId && g.assignmentId === assignmentId && g.studentId === studentId
      );

      if (idx !== -1) {
        const existing = db.grades[idx];
        const updated = {
          ...existing,
          teacherId,
          pointsEarned: pe,
          feedback: fb,
          updatedAt: now,
        };
        db.grades[idx] = updated;
        await writeDb(db);
        return updated;
      }

      const item = {
        id: crypto.randomUUID(),
        classroomId,
        assignmentId,
        studentId,
        teacherId,
        pointsEarned: pe,
        feedback: fb,
        createdAt: now,
        updatedAt: now,
      };
      db.grades.push(item);
      await writeDb(db);
      return item;
    },
  };
}

function createPgClassroomGradesStore() {
  const { Pool } = require("pg");

  const connectionString = process.env.DATABASE_URL;
  const disableSsl = String(process.env.PGSSLMODE || "").toLowerCase() === "disable";

  const pool = new Pool({
    connectionString,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  });

  let schemaReady = false;
  async function ensureSchema() {
    if (schemaReady) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_grades (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        points_earned NUMERIC,
        feedback TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (classroom_id, assignment_id, student_id)
      );
    `);
    schemaReady = true;
  }

  return {
    async listByClassroom({ classroomId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                assignment_id AS "assignmentId",
                student_id AS "studentId",
                teacher_id AS "teacherId",
                points_earned AS "pointsEarned",
                feedback,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
           FROM classroom_grades
          WHERE classroom_id = $1
          ORDER BY updated_at DESC`,
        [classroomId]
      );
      return res.rows;
    },

    async listByStudent({ classroomId, studentId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                assignment_id AS "assignmentId",
                student_id AS "studentId",
                teacher_id AS "teacherId",
                points_earned AS "pointsEarned",
                feedback,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
           FROM classroom_grades
          WHERE classroom_id = $1 AND student_id = $2
          ORDER BY updated_at DESC`,
        [classroomId, studentId]
      );
      return res.rows;
    },

    async upsert({ classroomId, assignmentId, studentId, teacherId, pointsEarned, feedback }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const pe = normalizePoints(pointsEarned);
      const fb = String(feedback || "").trim();

      const res = await pool.query(
        `INSERT INTO classroom_grades (id, classroom_id, assignment_id, student_id, teacher_id, points_earned, feedback)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (classroom_id, assignment_id, student_id)
         DO UPDATE SET teacher_id = EXCLUDED.teacher_id,
                       points_earned = EXCLUDED.points_earned,
                       feedback = EXCLUDED.feedback,
                       updated_at = NOW()
         RETURNING id,
                   classroom_id AS "classroomId",
                   assignment_id AS "assignmentId",
                   student_id AS "studentId",
                   teacher_id AS "teacherId",
                   points_earned AS "pointsEarned",
                   feedback,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [id, classroomId, assignmentId, studentId, teacherId, pe, fb]
      );
      return res.rows[0];
    },
  };
}

const classroomGradesStore = process.env.DATABASE_URL
  ? createPgClassroomGradesStore()
  : createJsonClassroomGradesStore();

module.exports = { classroomGradesStore };

