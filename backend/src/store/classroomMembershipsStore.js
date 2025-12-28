const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { memberships: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_MEMBERSHIPS_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-memberships.json")
  );
}

function createJsonClassroomMembershipsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async isMember({ classroomId, studentId }) {
      const db = await readDb();
      return db.memberships.some((m) => m.classroomId === classroomId && m.studentId === studentId);
    },

    async listByStudent({ studentId }) {
      const db = await readDb();
      return db.memberships
        .filter((m) => m.studentId === studentId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    },

    async join({ classroomId, studentId }) {
      const db = await readDb();
      const exists = db.memberships.some((m) => m.classroomId === classroomId && m.studentId === studentId);
      if (exists) return { classroomId, studentId, existed: true };

      const item = {
        id: crypto.randomUUID(),
        classroomId,
        studentId,
        createdAt: new Date().toISOString(),
      };
      db.memberships.push(item);
      await writeDb(db);
      return { ...item, existed: false };
    },
  };
}

function createPgClassroomMembershipsStore() {
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
      CREATE TABLE IF NOT EXISTS classroom_memberships (
        classroom_id TEXT NOT NULL,
        student_id TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        PRIMARY KEY (classroom_id, student_id)
      );
    `);
    schemaReady = true;
  }

  return {
    async isMember({ classroomId, studentId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT 1 FROM classroom_memberships WHERE classroom_id = $1 AND student_id = $2 LIMIT 1`,
        [classroomId, studentId]
      );
      return Boolean(res.rows[0]);
    },

    async listByStudent({ studentId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT classroom_id AS "classroomId", student_id AS "studentId", created_at AS "createdAt"
           FROM classroom_memberships
          WHERE student_id = $1
          ORDER BY created_at DESC`,
        [studentId]
      );
      return res.rows;
    },

    async join({ classroomId, studentId }) {
      await ensureSchema();
      try {
        await pool.query(
          `INSERT INTO classroom_memberships (classroom_id, student_id) VALUES ($1, $2)`,
          [classroomId, studentId]
        );
        return { classroomId, studentId, existed: false };
      } catch (err) {
        if (err && err.code === "23505") return { classroomId, studentId, existed: true };
        throw err;
      }
    },
  };
}

const classroomMembershipsStore = process.env.DATABASE_URL
  ? createPgClassroomMembershipsStore()
  : createJsonClassroomMembershipsStore();

module.exports = { classroomMembershipsStore };

