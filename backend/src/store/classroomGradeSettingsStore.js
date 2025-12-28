const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { settings: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_GRADE_SETTINGS_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-grade-settings.json")
  );
}

function defaultSettings({ classroomId, teacherId }) {
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    classroomId,
    teacherId,
    categories: [
      { id: crypto.randomUUID(), name: "Homework", weightPct: 30 },
      { id: crypto.randomUUID(), name: "Quizzes", weightPct: 20 },
      { id: crypto.randomUUID(), name: "Tests", weightPct: 40 },
      { id: crypto.randomUUID(), name: "Projects", weightPct: 10 },
    ],
    latePenaltyPerDayPct: 10,
    maxLatePenaltyPct: 50,
    createdAt: now,
    updatedAt: now,
  };
}

function normalizeCategories(categories) {
  const out = [];
  const seenNames = new Set();
  for (const c of Array.isArray(categories) ? categories : []) {
    const name = String(c?.name || "").trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seenNames.has(key)) continue;
    seenNames.add(key);
    const weightPct = Number(c?.weightPct);
    if (!Number.isFinite(weightPct) || weightPct < 0 || weightPct > 100) continue;
    out.push({ id: String(c?.id || crypto.randomUUID()), name, weightPct: Math.round(weightPct) });
  }
  return out.slice(0, 12);
}

function normalizePct(value, fallback, { min = 0, max = 100 } = {}) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  const clamped = Math.min(max, Math.max(min, n));
  return Math.round(clamped);
}

function createJsonClassroomGradeSettingsStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  return {
    async getOrCreate({ classroomId, teacherId }) {
      const db = await readDb();
      const found = db.settings.find(
        (s) => s.classroomId === classroomId && s.teacherId === teacherId
      );
      if (found) return found;
      const created = defaultSettings({ classroomId, teacherId });
      db.settings.push(created);
      await writeDb(db);
      return created;
    },

    async upsert({ classroomId, teacherId, categories, latePenaltyPerDayPct, maxLatePenaltyPct }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const normalizedCategories = normalizeCategories(categories);
      const updated = {
        ...(db.settings.find((s) => s.classroomId === classroomId && s.teacherId === teacherId) ||
          defaultSettings({ classroomId, teacherId })),
        categories: normalizedCategories.length ? normalizedCategories : defaultSettings({ classroomId, teacherId }).categories,
        latePenaltyPerDayPct: normalizePct(latePenaltyPerDayPct, 10, { min: 0, max: 100 }),
        maxLatePenaltyPct: normalizePct(maxLatePenaltyPct, 50, { min: 0, max: 100 }),
        updatedAt: now,
      };

      const idx = db.settings.findIndex((s) => s.classroomId === classroomId && s.teacherId === teacherId);
      if (idx === -1) db.settings.push(updated);
      else db.settings[idx] = updated;
      await writeDb(db);
      return updated;
    },
  };
}

function createPgClassroomGradeSettingsStore() {
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
      CREATE TABLE IF NOT EXISTS classroom_grade_settings (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        categories JSONB NOT NULL,
        late_penalty_per_day_pct INT NOT NULL DEFAULT 10,
        max_late_penalty_pct INT NOT NULL DEFAULT 50,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (classroom_id, teacher_id)
      );
    `);
    schemaReady = true;
  }

  async function rowToSettings(row) {
    return {
      id: row.id,
      classroomId: row.classroomId,
      teacherId: row.teacherId,
      categories: Array.isArray(row.categories) ? row.categories : [],
      latePenaltyPerDayPct: Number(row.latePenaltyPerDayPct) || 0,
      maxLatePenaltyPct: Number(row.maxLatePenaltyPct) || 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  return {
    async getOrCreate({ classroomId, teacherId }) {
      await ensureSchema();
      const res = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                teacher_id AS "teacherId",
                categories,
                late_penalty_per_day_pct AS "latePenaltyPerDayPct",
                max_late_penalty_pct AS "maxLatePenaltyPct",
                created_at AS "createdAt",
                updated_at AS "updatedAt"
           FROM classroom_grade_settings
          WHERE classroom_id = $1 AND teacher_id = $2
          LIMIT 1`,
        [classroomId, teacherId]
      );
      if (res.rows[0]) return rowToSettings(res.rows[0]);

      const created = defaultSettings({ classroomId, teacherId });
      const insert = await pool.query(
        `INSERT INTO classroom_grade_settings (id, classroom_id, teacher_id, categories, late_penalty_per_day_pct, max_late_penalty_pct)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id,
                   classroom_id AS "classroomId",
                   teacher_id AS "teacherId",
                   categories,
                   late_penalty_per_day_pct AS "latePenaltyPerDayPct",
                   max_late_penalty_pct AS "maxLatePenaltyPct",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          created.id,
          classroomId,
          teacherId,
          created.categories,
          created.latePenaltyPerDayPct,
          created.maxLatePenaltyPct,
        ]
      );
      return rowToSettings(insert.rows[0]);
    },

    async upsert({ classroomId, teacherId, categories, latePenaltyPerDayPct, maxLatePenaltyPct }) {
      await ensureSchema();

      const base = await this.getOrCreate({ classroomId, teacherId });
      const normalizedCategories = normalizeCategories(categories);
      const updated = {
        ...base,
        categories: normalizedCategories.length ? normalizedCategories : base.categories,
        latePenaltyPerDayPct: normalizePct(latePenaltyPerDayPct, base.latePenaltyPerDayPct, { min: 0, max: 100 }),
        maxLatePenaltyPct: normalizePct(maxLatePenaltyPct, base.maxLatePenaltyPct, { min: 0, max: 100 }),
      };

      const res = await pool.query(
        `UPDATE classroom_grade_settings
            SET categories = $3,
                late_penalty_per_day_pct = $4,
                max_late_penalty_pct = $5,
                updated_at = NOW()
          WHERE classroom_id = $1 AND teacher_id = $2
          RETURNING id,
                   classroom_id AS "classroomId",
                   teacher_id AS "teacherId",
                   categories,
                   late_penalty_per_day_pct AS "latePenaltyPerDayPct",
                   max_late_penalty_pct AS "maxLatePenaltyPct",
                   created_at AS "createdAt",
                   updated_at AS "updatedAt"`,
        [
          classroomId,
          teacherId,
          updated.categories,
          updated.latePenaltyPerDayPct,
          updated.maxLatePenaltyPct,
        ]
      );
      return rowToSettings(res.rows[0]);
    },
  };
}

const classroomGradeSettingsStore = process.env.DATABASE_URL
  ? createPgClassroomGradeSettingsStore()
  : createJsonClassroomGradeSettingsStore();

module.exports = { classroomGradeSettingsStore };

