const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { rubrics: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_RUBRICS_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-rubrics.json")
  );
}

function normalizeRubric(rubric) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rubric) ? rubric : []) {
    const title = String(r?.title || "").trim();
    if (!title) continue;
    const key = title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const pointsMax = Number(r?.pointsMax);
    if (!Number.isFinite(pointsMax) || pointsMax <= 0 || pointsMax > 100) continue;
    out.push({
      id: String(r?.id || crypto.randomUUID()),
      title,
      pointsMax: Math.floor(pointsMax),
    });
  }
  return out.slice(0, 12);
}

function createJsonClassroomRubricsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async getByAssignment({ classroomId, assignmentId }) {
      const db = await readDb();
      return (
        db.rubrics.find((r) => r.classroomId === classroomId && r.assignmentId === assignmentId) ||
        null
      );
    },

    async upsert({ classroomId, assignmentId, teacherId, rubric }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const normalized = normalizeRubric(rubric);
      const idx = db.rubrics.findIndex((r) => r.classroomId === classroomId && r.assignmentId === assignmentId);
      const item = {
        id: idx !== -1 ? db.rubrics[idx].id : crypto.randomUUID(),
        classroomId,
        assignmentId,
        teacherId,
        rubric: normalized,
        updatedAt: now,
        createdAt: idx !== -1 ? db.rubrics[idx].createdAt : now,
      };
      if (idx === -1) db.rubrics.push(item);
      else db.rubrics[idx] = item;
      await writeDb(db);
      return item;
    },
  };
}

function createPgClassroomRubricsStore() {
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
      CREATE TABLE IF NOT EXISTS classroom_rubrics (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        assignment_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        rubric JSONB NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (classroom_id, assignment_id)
      );
    `);
    schemaReady = true;
  }

  return {
    async getByAssignment({ classroomId, assignmentId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                assignment_id AS "assignmentId",
                teacher_id AS "teacherId",
                rubric,
                created_at AS "createdAt",
                updated_at AS "updatedAt"
           FROM classroom_rubrics
          WHERE classroom_id = $1 AND assignment_id = $2
          LIMIT 1`,
        [classroomId, assignmentId]
      );
      return res.rows[0] || null;
    },

    async upsert({ classroomId, assignmentId, teacherId, rubric }) {
      await ensureSchema();
      const normalized = normalizeRubric(rubric);
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO classroom_rubrics (id, classroom_id, assignment_id, teacher_id, rubric)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (classroom_id, assignment_id)
         DO UPDATE SET teacher_id = EXCLUDED.teacher_id,
                       rubric = EXCLUDED.rubric,
                       updated_at = NOW()
         RETURNING id,
                   classroom_id AS "classroomId",
                   assignment_id AS "assignmentId",
                   teacher_id AS "teacherId",
                   rubric,
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [id, classroomId, assignmentId, teacherId, normalized]
      );
      return res.rows[0];
    },
  };
}

const classroomRubricsStore = process.env.DATABASE_URL
  ? createPgClassroomRubricsStore()
  : createJsonClassroomRubricsStore();

module.exports = { classroomRubricsStore };

