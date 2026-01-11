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

function normalizeCredits(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 3;
  const rounded = Math.round(n);
  if (rounded < 1 || rounded > 6) return 3;
  return rounded;
}

function withCredits(classroom) {
  if (!classroom) return classroom;
  return { ...classroom, credits: normalizeCredits(classroom.credits) };
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
    async getById(id) {
      const db = await readDb();
      return withCredits(db.classrooms.find((c) => c.id === id) || null);
    },

    async findByJoinCode(joinCode) {
      const code = String(joinCode || "").trim().toUpperCase();
      if (!code) return null;
      const db = await readDb();
      return withCredits(
        db.classrooms.find((c) => String(c.joinCode || "").toUpperCase() === code) || null
      );
    },

    async getByIdForTeacher({ teacherId, id }) {
      const db = await readDb();
      return withCredits(
        db.classrooms.find((c) => c.id === id && c.teacherId === teacherId) || null
      );
    },

    async listByTeacher({ teacherId }) {
      const db = await readDb();
      return [...db.classrooms]
        .filter((c) => c.teacherId === teacherId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .map(withCredits);
    },

    async create({ teacherId, name, section, credits }) {
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
        credits: normalizeCredits(credits),
        joinCode,
        createdAt: now,
      };
      db.classrooms.push(classroom);
      await writeDb(db);
      return classroom;
    },

    async deleteForTeacher({ teacherId, id }) {
      const db = await readDb();
      const idx = db.classrooms.findIndex((c) => c.id === id && c.teacherId === teacherId);
      if (idx === -1) return null;
      const [deleted] = db.classrooms.splice(idx, 1);
      await writeDb(db);
      return withCredits(deleted) || null;
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
        credits INT NOT NULL DEFAULT 3,
        join_code TEXT NOT NULL UNIQUE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE classrooms ADD COLUMN IF NOT EXISTS credits INT NOT NULL DEFAULT 3;`);
    schemaReady = true;
  }

  return {
    async getById(id) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                teacher_id AS "teacherId",
                name,
                section,
                credits,
                join_code AS "joinCode",
                created_at AS "createdAt"
           FROM classrooms
          WHERE id = $1
          LIMIT 1`,
        [id]
      );
      return res.rows[0] ? withCredits(res.rows[0]) : null;
    },

    async findByJoinCode(joinCode) {
      await ensureSchema();
      const code = String(joinCode || "").trim().toUpperCase();
      if (!code) return null;
      const res = await pool.query(
        `SELECT id,
                teacher_id AS "teacherId",
                name,
                section,
                credits,
                join_code AS "joinCode",
                created_at AS "createdAt"
           FROM classrooms
          WHERE UPPER(join_code) = $1
          LIMIT 1`,
        [code]
      );
      return res.rows[0] ? withCredits(res.rows[0]) : null;
    },

    async getByIdForTeacher({ teacherId, id }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                teacher_id AS "teacherId",
                name,
                section,
                credits,
                join_code AS "joinCode",
                created_at AS "createdAt"
           FROM classrooms
          WHERE id = $1 AND teacher_id = $2
          LIMIT 1`,
        [id, teacherId]
      );
      return res.rows[0] ? withCredits(res.rows[0]) : null;
    },

    async listByTeacher({ teacherId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                teacher_id AS "teacherId",
                name,
                section,
                credits,
                join_code AS "joinCode",
                created_at AS "createdAt"
           FROM classrooms
          WHERE teacher_id = $1
          ORDER BY created_at DESC`,
        [teacherId]
      );
      return res.rows.map(withCredits);
    },

    async create({ teacherId, name, section, credits }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const cleanedName = normalizeString(name, { max: 120 });
      const cleanedSection = normalizeString(section, { max: 60 });
      const cleanedCredits = normalizeCredits(credits);

      for (let i = 0; i < 6; i += 1) {
        const joinCode = generateJoinCode();
        try {
          const res = await pool.query(
            `INSERT INTO classrooms (id, teacher_id, name, section, credits, join_code)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id,
                       teacher_id AS "teacherId",
                       name,
                       section,
                       credits,
                       join_code AS "joinCode",
                       created_at AS "createdAt"`,
            [id, teacherId, cleanedName, cleanedSection, cleanedCredits, joinCode]
          );
          return withCredits(res.rows[0]);
        } catch (err) {
          if (err && err.code === "23505") continue; // unique violation (join code)
          throw err;
        }
      }

      throw new Error("Unable to create classroom (join code collision)");
    },

    async deleteForTeacher({ teacherId, id }) {
      await ensureSchema();
      const res = await pool.query(
        `DELETE FROM classrooms
          WHERE id = $1 AND teacher_id = $2
          RETURNING id,
                    teacher_id AS "teacherId",
                    name,
                    section,
                    credits,
                    join_code AS "joinCode",
                    created_at AS "createdAt"`,
        [id, teacherId]
      );
      return res.rows[0] ? withCredits(res.rows[0]) : null;
    },
  };
}

const classroomsStore = process.env.DATABASE_URL
  ? createPgClassroomsStore()
  : createJsonClassroomsStore();

module.exports = { classroomsStore };
