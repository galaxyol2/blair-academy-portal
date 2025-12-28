const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { submissions: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_SUBMISSIONS_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-submissions.json")
  );
}

function normalizeLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

function createJsonClassroomSubmissionsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async listByAssignment({ classroomId, assignmentId, limit = 100 }) {
      const db = await readDb();
      const l = normalizeLimit(limit, 100);
      return [...db.submissions]
        .filter((s) => s.classroomId === classroomId && s.assignmentId === assignmentId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, l);
    },

    async listByStudentInClassroom({ classroomId, studentId, limit = 300 }) {
      const db = await readDb();
      const l = normalizeLimit(limit, 300);
      return [...db.submissions]
        .filter((s) => s.classroomId === classroomId && s.studentId === studentId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, l);
    },

    async listSubmittedAssignmentIdsInClassroom({ classroomId, studentId }) {
      const db = await readDb();
      const ids = new Set();
      for (const s of db.submissions) {
        if (s.classroomId !== classroomId) continue;
        if (s.studentId !== studentId) continue;
        if (s.assignmentId) ids.add(String(s.assignmentId));
      }
      return [...ids];
    },

    async listSubmittedAssignmentIdsByStudentInClassroom({ classroomId }) {
      const db = await readDb();
      const out = new Map();
      for (const s of db.submissions) {
        if (s.classroomId !== classroomId) continue;
        const sid = String(s.studentId || "").trim();
        if (!sid) continue;
        const aid = String(s.assignmentId || "").trim();
        if (!aid) continue;
        if (!out.has(sid)) out.set(sid, new Set());
        out.get(sid).add(aid);
      }
      const obj = {};
      for (const [sid, set] of out.entries()) obj[sid] = [...set];
      return obj;
    },

    async listByStudent({ classroomId, assignmentId, studentId, limit = 10 }) {
      const db = await readDb();
      const l = normalizeLimit(limit, 10);
      return [...db.submissions]
        .filter(
          (s) =>
            s.classroomId === classroomId &&
            s.assignmentId === assignmentId &&
            s.studentId === studentId
        )
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, l);
    },

    async create({ classroomId, assignmentId, studentId, type, payload }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const item = {
        id: crypto.randomUUID(),
        classroomId,
        assignmentId,
        studentId,
        type,
        payload,
        createdAt: now,
      };
      db.submissions.push(item);
      await writeDb(db);
      return item;
    },
  };
}

function createPgClassroomSubmissionsStore() {
  const { Pool } = require("pg");

  const connectionString = process.env.DATABASE_URL;
  const disableSsl =
    String(process.env.PGSSLMODE || "").toLowerCase() === "disable";

  const pool = new Pool({
    connectionString,
    ssl: disableSsl ? false : { rejectUnauthorized: false },
  });

  let schemaReady = false;
  async function ensureSchema() {
    if (schemaReady) return;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_submissions (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        type TEXT NOT NULL,
        payload JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    schemaReady = true;
  }

  return {
    async listByAssignment({ classroomId, assignmentId, limit = 100 }) {
      await ensureSchema();
      const l = normalizeLimit(limit, 100);
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                assignment_id AS "assignmentId",
                student_id AS "studentId",
                type,
                payload,
                created_at AS "createdAt"
           FROM classroom_submissions
          WHERE classroom_id = $1 AND assignment_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [classroomId, assignmentId, l]
      );
      return res.rows;
    },

    async listByStudentInClassroom({ classroomId, studentId, limit = 300 }) {
      await ensureSchema();
      const l = normalizeLimit(limit, 300);
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                assignment_id AS "assignmentId",
                student_id AS "studentId",
                type,
                payload,
                created_at AS "createdAt"
           FROM classroom_submissions
          WHERE classroom_id = $1 AND student_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [classroomId, studentId, l]
      );
      return res.rows;
    },

    async listSubmittedAssignmentIdsInClassroom({ classroomId, studentId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT DISTINCT assignment_id AS "assignmentId"
           FROM classroom_submissions
          WHERE classroom_id = $1 AND student_id = $2`,
        [classroomId, studentId]
      );
      return res.rows.map((r) => String(r.assignmentId));
    },

    async listSubmittedAssignmentIdsByStudentInClassroom({ classroomId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT student_id AS "studentId",
                array_agg(DISTINCT assignment_id) AS "assignmentIds"
           FROM classroom_submissions
          WHERE classroom_id = $1
          GROUP BY student_id`,
        [classroomId]
      );
      const obj = {};
      for (const row of res.rows) {
        obj[String(row.studentId)] = Array.isArray(row.assignmentIds)
          ? row.assignmentIds.map((id) => String(id))
          : [];
      }
      return obj;
    },

    async listByStudent({ classroomId, assignmentId, studentId, limit = 10 }) {
      await ensureSchema();
      const l = normalizeLimit(limit, 10);
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                assignment_id AS "assignmentId",
                student_id AS "studentId",
                type,
                payload,
                created_at AS "createdAt"
           FROM classroom_submissions
          WHERE classroom_id = $1 AND assignment_id = $2 AND student_id = $3
          ORDER BY created_at DESC
          LIMIT $4`,
        [classroomId, assignmentId, studentId, l]
      );
      return res.rows;
    },

    async create({ classroomId, assignmentId, studentId, type, payload }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO classroom_submissions (id, classroom_id, assignment_id, student_id, type, payload)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id,
                   classroom_id AS "classroomId",
                   assignment_id AS "assignmentId",
                   student_id AS "studentId",
                   type,
                   payload,
                   created_at AS "createdAt"`,
        [id, classroomId, assignmentId, studentId, type, payload]
      );
      return res.rows[0];
    },
  };
}

const classroomSubmissionsStore = process.env.DATABASE_URL
  ? createPgClassroomSubmissionsStore()
  : createJsonClassroomSubmissionsStore();

module.exports = { classroomSubmissionsStore };
