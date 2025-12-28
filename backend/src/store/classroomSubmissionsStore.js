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

