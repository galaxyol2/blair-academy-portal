const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { users: [] };

function dataFilePath() {
  // Keep it outside git by default (see .gitignore suggestion)
  return (
    process.env.DATA_FILE ||
    path.join(__dirname, "..", "..", "data", "dev.json")
  );
}

async function readDb() {
  return readJsonFile(dataFilePath(), defaultDb);
}

async function writeDb(db) {
  return writeJsonFileAtomic(dataFilePath(), db);
}

function createJsonUsersStore() {
  return {
    async findByEmail(email) {
      const db = await readDb();
      return db.users.find((u) => u.email === email) || null;
    },

    async findById(id) {
      const db = await readDb();
      return db.users.find((u) => u.id === id) || null;
    },

    async create({ name, email, passwordHash }) {
      const db = await readDb();
      const exists = db.users.some((u) => u.email === email);
      if (exists) return null;

      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash,
        createdAt: new Date().toISOString(),
      };
      db.users.push(user);
      await writeDb(db);
      return user;
    },

    async updatePassword({ userId, passwordHash }) {
      const db = await readDb();
      const idx = db.users.findIndex((u) => u.id === userId);
      if (idx === -1) return null;
      db.users[idx] = {
        ...db.users[idx],
        passwordHash,
        updatedAt: new Date().toISOString(),
      };
      await writeDb(db);
      return db.users[idx];
    },
  };
}

function createPgUsersStore() {
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
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT NOT NULL UNIQUE,
        password_hash TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      );
    `);
    schemaReady = true;
  }

  return {
    async findByEmail(email) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE email = $1 LIMIT 1`,
        [email]
      );
      return res.rows[0] || null;
    },

    async findById(id) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id, name, email, password_hash AS "passwordHash" FROM users WHERE id = $1 LIMIT 1`,
        [id]
      );
      return res.rows[0] || null;
    },

    async create({ name, email, passwordHash }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      try {
        const res = await pool.query(
          `INSERT INTO users (id, name, email, password_hash) VALUES ($1, $2, $3, $4)
           RETURNING id, name, email, password_hash AS "passwordHash"`,
          [id, name, email, passwordHash]
        );
        return res.rows[0] || null;
      } catch (err) {
        if (err && err.code === "23505") return null; // unique violation
        throw err;
      }
    },

    async updatePassword({ userId, passwordHash }) {
      await ensureSchema();
      const res = await pool.query(
        `UPDATE users
           SET password_hash = $2, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, email, password_hash AS "passwordHash"`,
        [userId, passwordHash]
      );
      return res.rows[0] || null;
    },
  };
}

const usersStore = process.env.DATABASE_URL
  ? createPgUsersStore()
  : createJsonUsersStore();

module.exports = { usersStore };
