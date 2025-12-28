const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { classrooms: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOMS_FILE ||
    path.join(__dirname, "..", "..", "data", "classrooms.json")
  );
}

function normalizeString(value, { max = 120 } = {}) {
  const v = String(value || "").trim();
  if (!v) return "";
  return v.length > max ? v.slice(0, max) : v;
}

function generateJoinCode() {
  // 8 chars, URL-safe-ish, uppercase for readability.
  return crypto
    .randomBytes(6)
    .toString("base64")
    .replace(/[^a-zA-Z0-9]/g, "")
    .slice(0, 8)
    .toUpperCase();
}

function createJsonClassroomsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async getByIdForTeacher({ teacherId, id }) {
      const db = await readDb();
      return (
        db.classrooms.find((c) => c.id === id && c.teacherId === teacherId) ||
        null
      );
    },

    async listByTeacher({ teacherId }) {
      const db = await readDb();
      return [...db.classrooms]
        .filter((c) => c.teacherId === teacherId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async create({ teacherId, name, section }) {
      const db = await readDb();
      const now = new Date().toISOString();

      let joinCode = generateJoinCode();
      for (let i = 0; i < 10; i += 1) {
        if (!db.classrooms.some((c) => c.joinCode === joinCode)) break;
        joinCode = generateJoinCode();
      }

      const classroom = {
        id: crypto.randomUUID(),
        teacherId,
        name: normalizeString(name, { max: 120 }),
        section: normalizeString(section, { max: 60 }),
        joinCode,
        createdAt: now,
      };
      db.classrooms.push(classroom);
      await writeDb(db);
      return classroom;
    },
  };
}

function createPgClassroomsStore() {
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
      CREATE TABLE IF NOT EXISTS classrooms (
        id TEXT PRIMARY KEY,
        teacher_id TEXT NOT NULL,
        name TEXT NOT NULL,
        section TEXT NOT NULL DEFAULT '',
        join_code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    schemaReady = true;
  }

  return {
    async getByIdForTeacher({ teacherId, id }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                teacher_id AS "teacherId",
                name,
                section,
                join_code AS "joinCode",
                created_at AS "createdAt"
           FROM classrooms
          WHERE id = $1 AND teacher_id = $2
          LIMIT 1`,
        [id, teacherId]
      );
      return res.rows[0] || null;
    },

    async listByTeacher({ teacherId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                teacher_id AS "teacherId",
                name,
                section,
                join_code AS "joinCode",
                created_at AS "createdAt"
           FROM classrooms
          WHERE teacher_id = $1
          ORDER BY created_at DESC`,
        [teacherId]
      );
      return res.rows;
    },

    async create({ teacherId, name, section }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const cleanedName = normalizeString(name, { max: 120 });
      const cleanedSection = normalizeString(section, { max: 60 });

      for (let i = 0; i < 6; i += 1) {
        const joinCode = generateJoinCode();
        try {
          const res = await pool.query(
            `INSERT INTO classrooms (id, teacher_id, name, section, join_code)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id,
                       teacher_id AS "teacherId",
                       name,
                       section,
                       join_code AS "joinCode",
                       created_at AS "createdAt"`,
            [id, teacherId, cleanedName, cleanedSection, joinCode]
          );
          return res.rows[0];
        } catch (err) {
          if (err && err.code === "23505") continue; // unique violation (join code)
          throw err;
        }
      }

      throw new Error("Unable to create classroom (join code collision)");
    },
  };
}

const classroomsStore = process.env.DATABASE_URL
  ? createPgClassroomsStore()
  : createJsonClassroomsStore();

module.exports = { classroomsStore };
