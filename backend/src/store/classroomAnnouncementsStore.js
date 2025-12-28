const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { announcements: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_ANNOUNCEMENTS_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-announcements.json")
  );
}

function normalizeLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

function createJsonClassroomAnnouncementsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async listByClassroom({ classroomId, limit = 50 }) {
      const db = await readDb();
      const l = normalizeLimit(limit, 50);
      return [...db.announcements]
        .filter((a) => a.classroomId === classroomId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, l);
    },

    async create({ classroomId, teacherId, title, body }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const item = {
        id: crypto.randomUUID(),
        classroomId,
        teacherId,
        title,
        body,
        createdAt: now,
      };
      db.announcements.push(item);
      await writeDb(db);
      return item;
    },

    async deleteById({ id, teacherId, classroomId }) {
      const db = await readDb();
      const idx = db.announcements.findIndex(
        (a) => a.id === id && a.teacherId === teacherId && a.classroomId === classroomId
      );
      if (idx === -1) return null;
      const [deleted] = db.announcements.splice(idx, 1);
      await writeDb(db);
      return deleted || null;
    },
  };
}

function createPgClassroomAnnouncementsStore() {
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
      CREATE TABLE IF NOT EXISTS classroom_announcements (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    schemaReady = true;
  }

  return {
    async listByClassroom({ classroomId, limit = 50 }) {
      await ensureSchema();
      const l = normalizeLimit(limit, 50);
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                teacher_id AS "teacherId",
                title,
                body,
                created_at AS "createdAt"
           FROM classroom_announcements
          WHERE classroom_id = $1
          ORDER BY created_at DESC
          LIMIT $2`,
        [classroomId, l]
      );
      return res.rows;
    },

    async create({ classroomId, teacherId, title, body }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO classroom_announcements (id, classroom_id, teacher_id, title, body)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id,
                   classroom_id AS "classroomId",
                   teacher_id AS "teacherId",
                   title,
                   body,
                   created_at AS "createdAt"`,
        [id, classroomId, teacherId, title, body]
      );
      return res.rows[0];
    },

    async deleteById({ id, teacherId, classroomId }) {
      await ensureSchema();
      const res = await pool.query(
        `DELETE FROM classroom_announcements
          WHERE id = $1 AND teacher_id = $2 AND classroom_id = $3
          RETURNING id,
                    classroom_id AS "classroomId",
                    teacher_id AS "teacherId",
                    title,
                    body,
                    created_at AS "createdAt"`,
        [id, teacherId, classroomId]
      );
      return res.rows[0] || null;
    },
  };
}

const classroomAnnouncementsStore = process.env.DATABASE_URL
  ? createPgClassroomAnnouncementsStore()
  : createJsonClassroomAnnouncementsStore();

module.exports = { classroomAnnouncementsStore };
