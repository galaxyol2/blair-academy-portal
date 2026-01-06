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

    async create({ name, email, passwordHash, role }) {
      const db = await readDb();
      const exists = db.users.some((u) => u.email === email);
      if (exists) return null;

      const user = {
        id: crypto.randomUUID(),
        name,
        email,
        passwordHash,
        role: String(role || "student").trim() || "student",
        createdAt: new Date().toISOString(),
        discordId: null,
        discordUsername: null,
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

    async deleteByEmail(email) {
      const db = await readDb();
      const idx = db.users.findIndex((u) => u.email === email);
      if (idx === -1) return null;
      const [deleted] = db.users.splice(idx, 1);
      await writeDb(db);
      return deleted || null;
    },

    async deleteById(id) {
      const db = await readDb();
      const idx = db.users.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      const [deleted] = db.users.splice(idx, 1);
      await writeDb(db);
      return deleted || null;
    },

    async findByDiscordId(discordId) {
      if (!discordId) return null;
      const db = await readDb();
      return db.users.find((u) => u.discordId === String(discordId)) || null;
    },

    async linkDiscord({ userId, discordId, discordUsername }) {
      const id = String(userId || "").trim();
      const discord = String(discordId || "").trim();
      if (!id || !discord) return null;
      const db = await readDb();
      const conflict = db.users.find((u) => u.discordId === discord && u.id !== id);
      if (conflict) {
        const err = new Error("That Discord account is already linked to another user");
        err.code = "discord_conflict";
        throw err;
      }
      const idx = db.users.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      db.users[idx] = {
        ...db.users[idx],
        discordId: discord,
        discordUsername: discordUsername ? String(discordUsername).trim() : null,
        updatedAt: new Date().toISOString(),
      };
      await writeDb(db);
      return db.users[idx];
    },

    async unlinkDiscord(userId) {
      const id = String(userId || "").trim();
      if (!id) return null;
      const db = await readDb();
      const idx = db.users.findIndex((u) => u.id === id);
      if (idx === -1) return null;
      db.users[idx] = {
        ...db.users[idx],
        discordId: null,
        discordUsername: null,
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
        role TEXT NOT NULL DEFAULT 'student',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ
      );
    `);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'student';`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_id TEXT UNIQUE;`);
    await pool.query(`ALTER TABLE users ADD COLUMN IF NOT EXISTS discord_username TEXT;`);
    schemaReady = true;
  }

  return {
    async findByEmail(email) {
      await ensureSchema();
      const res = await pool.query(
      `SELECT id, name, email, role, password_hash AS "passwordHash", discord_id AS "discordId", discord_username AS "discordUsername" FROM users WHERE email = $1 LIMIT 1`,
      [email]
    );
    return res.rows[0] || null;
  },

    async findById(id) {
      await ensureSchema();
      const res = await pool.query(
      `SELECT id, name, email, role, password_hash AS "passwordHash", discord_id AS "discordId", discord_username AS "discordUsername" FROM users WHERE id = $1 LIMIT 1`,
      [id]
    );
    return res.rows[0] || null;
  },

    async create({ name, email, passwordHash, role }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const r = String(role || "student").trim() || "student";
      try {
        const res = await pool.query(
        `INSERT INTO users (id, name, email, password_hash, role) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, name, email, role, password_hash AS "passwordHash", discord_id AS "discordId", discord_username AS "discordUsername"`,
        [id, name, email, passwordHash, r]
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
         RETURNING id, name, email, role, password_hash AS "passwordHash"`,
        [userId, passwordHash]
      );
      return res.rows[0] || null;
    },

    async deleteByEmail(email) {
      await ensureSchema();
      const res = await pool.query(
        `DELETE FROM users WHERE email = $1
         RETURNING id, name, email, role, password_hash AS "passwordHash"`,
        [email]
      );
      return res.rows[0] || null;
    },

    async deleteById(id) {
      await ensureSchema();
      const res = await pool.query(
        `DELETE FROM users WHERE id = $1
         RETURNING id, name, email, role, password_hash AS "passwordHash"`,
        [id]
      );
      return res.rows[0] || null;
    },

    async findByDiscordId(discordId) {
      if (!discordId) return null;
      await ensureSchema();
      const res = await pool.query(
        `SELECT id, name, email, role, password_hash AS "passwordHash", discord_id AS "discordId", discord_username AS "discordUsername"
         FROM users
         WHERE discord_id = $1
         LIMIT 1`,
        [String(discordId)]
      );
      return res.rows[0] || null;
    },

    async linkDiscord({ userId, discordId, discordUsername }) {
      await ensureSchema();
      const user = String(userId || "").trim();
      const discord = String(discordId || "").trim();
      if (!user || !discord) return null;
      const conflict = await pool.query(
        `SELECT id FROM users WHERE discord_id = $1 AND id != $2 LIMIT 1`,
        [discord, user]
      );
      if (conflict.rowCount > 0) {
        const err = new Error("That Discord account is already linked to another user");
        err.code = "discord_conflict";
        throw err;
      }
      const res = await pool.query(
        `UPDATE users
           SET discord_id = $2, discord_username = $3, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, email, role, password_hash AS "passwordHash", discord_id AS "discordId", discord_username AS "discordUsername"`,
        [user, discord, discordUsername ? String(discordUsername).trim() : null]
      );
      return res.rows[0] || null;
    },

    async unlinkDiscord(userId) {
      await ensureSchema();
      const res = await pool.query(
        `UPDATE users
           SET discord_id = NULL, discord_username = NULL, updated_at = NOW()
         WHERE id = $1
         RETURNING id, name, email, role, password_hash AS "passwordHash", discord_id AS "discordId", discord_username AS "discordUsername"`,
        [userId]
      );
      return res.rows[0] || null;
    },
  };
}

const usersStore = process.env.DATABASE_URL
  ? createPgUsersStore()
  : createJsonUsersStore();

module.exports = { usersStore };
