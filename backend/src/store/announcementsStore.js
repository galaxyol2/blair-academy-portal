const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { announcements: [] };

function dataFilePath() {
  return (
    process.env.ANNOUNCEMENTS_FILE ||
    path.join(__dirname, "..", "..", "data", "announcements.json")
  );
}

function normalizeLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

function createJsonAnnouncementsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async list({ limit = 20 } = {}) {
      const db = await readDb();
      const l = normalizeLimit(limit, 20);
      return [...db.announcements]
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
        .slice(0, l);
    },

    async create({ title, body, source = "manual", createdBy = "" }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const announcement = {
        id: crypto.randomUUID(),
        title,
        body,
        source,
        createdBy,
        createdAt: now,
      };
      db.announcements.push(announcement);
      await writeDb(db);
      return announcement;
    },
  };
}

function createPgAnnouncementsStore() {
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
      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        body TEXT NOT NULL,
        source TEXT NOT NULL DEFAULT 'manual',
        created_by TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    schemaReady = true;
  }

  return {
    async list({ limit = 20 } = {}) {
      await ensureSchema();
      const l = normalizeLimit(limit, 20);
      const res = await pool.query(
        `SELECT id, title, body, source, created_by AS "createdBy", created_at AS "createdAt"
           FROM announcements
          ORDER BY created_at DESC
          LIMIT $1`,
        [l]
      );
      return res.rows;
    },

    async create({ title, body, source = "manual", createdBy = "" }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO announcements (id, title, body, source, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, title, body, source, created_by AS "createdBy", created_at AS "createdAt"`,
        [id, title, body, source, createdBy]
      );
      return res.rows[0];
    },
  };
}

const announcementsStore = process.env.DATABASE_URL
  ? createPgAnnouncementsStore()
  : createJsonAnnouncementsStore();

module.exports = { announcementsStore };

