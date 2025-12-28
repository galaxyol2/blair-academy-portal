const path = require("path");
const crypto = require("crypto");

const { readJsonFile, writeJsonFileAtomic } = require("./jsonFile");

const defaultDb = { modules: [], assignments: [] };

function dataFilePath() {
  return (
    process.env.CLASSROOM_MODULES_FILE ||
    path.join(__dirname, "..", "..", "data", "classroom-modules.json")
  );
}

function normalizeLimit(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), 100);
}

function normalizeText(value, { max } = {}) {
  const v = String(value || "").trim();
  if (!v) return "";
  if (typeof max === "number" && max > 0 && v.length > max) return v.slice(0, max);
  return v;
}

function toNullableIsoDate(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function createJsonClassroomModulesStore() {
  async function readDb() {
    return readJsonFile(dataFilePath(), defaultDb);
  }

  async function writeDb(db) {
    return writeJsonFileAtomic(dataFilePath(), db);
  }

  function sortNewest(a, b) {
    return new Date(b.createdAt) - new Date(a.createdAt);
  }

  return {
    async listWithAssignments({ classroomId, teacherId, limit = 50 }) {
      const db = await readDb();
      const l = normalizeLimit(limit, 50);

      const modules = [...db.modules]
        .filter((m) => m.classroomId === classroomId && m.teacherId === teacherId)
        .sort(sortNewest)
        .slice(0, l);

      const assignments = [...db.assignments].filter(
        (a) => a.classroomId === classroomId && a.teacherId === teacherId
      );

      const byModule = new Map();
      for (const a of assignments) {
        const list = byModule.get(a.moduleId) || [];
        list.push(a);
        byModule.set(a.moduleId, list);
      }
      for (const list of byModule.values()) list.sort(sortNewest);

      return modules.map((m) => ({
        ...m,
        assignments: (byModule.get(m.id) || []).slice(0, 100),
      }));
    },

    async createModule({ classroomId, teacherId, title, description }) {
      const db = await readDb();
      const now = new Date().toISOString();
      const item = {
        id: crypto.randomUUID(),
        classroomId,
        teacherId,
        title: normalizeText(title, { max: 120 }),
        description: normalizeText(description, { max: 800 }),
        createdAt: now,
      };
      db.modules.push(item);
      await writeDb(db);
      return item;
    },

    async deleteModule({ classroomId, teacherId, moduleId }) {
      const db = await readDb();
      const idx = db.modules.findIndex(
        (m) => m.id === moduleId && m.classroomId === classroomId && m.teacherId === teacherId
      );
      if (idx === -1) return null;
      const [deleted] = db.modules.splice(idx, 1);

      const before = db.assignments.length;
      db.assignments = db.assignments.filter(
        (a) =>
          !(
            a.moduleId === moduleId &&
            a.classroomId === classroomId &&
            a.teacherId === teacherId
          )
      );
      const removedAssignments = before - db.assignments.length;

      await writeDb(db);
      return { module: deleted || null, removedAssignments };
    },

    async createAssignment({ classroomId, teacherId, moduleId, title, body, dueAt, points, category }) {
      const db = await readDb();
      const module = db.modules.find(
        (m) => m.id === moduleId && m.classroomId === classroomId && m.teacherId === teacherId
      );
      if (!module) return null;

      const now = new Date().toISOString();
      const item = {
        id: crypto.randomUUID(),
        classroomId,
        teacherId,
        moduleId,
        title: normalizeText(title, { max: 120 }),
        body: normalizeText(body, { max: 5000 }),
        dueAt: toNullableIsoDate(dueAt),
        points: Number.isFinite(Number(points)) ? Math.max(0, Math.floor(Number(points))) : null,
        category: normalizeText(category, { max: 40 }) || "Homework",
        createdAt: now,
      };
      db.assignments.push(item);
      await writeDb(db);
      return item;
    },

    async deleteAssignment({ classroomId, teacherId, moduleId, assignmentId }) {
      const db = await readDb();
      const idx = db.assignments.findIndex(
        (a) =>
          a.id === assignmentId &&
          a.moduleId === moduleId &&
          a.classroomId === classroomId &&
          a.teacherId === teacherId
      );
      if (idx === -1) return null;
      const [deleted] = db.assignments.splice(idx, 1);
      await writeDb(db);
      return deleted || null;
    },
  };
}

function createPgClassroomModulesStore() {
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
      CREATE TABLE IF NOT EXISTS classroom_modules (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS classroom_assignments (
        id TEXT PRIMARY KEY,
        classroom_id TEXT NOT NULL,
        teacher_id TEXT NOT NULL,
        module_id TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        body TEXT NOT NULL,
        due_at TIMESTAMPTZ,
        points INT,
        category TEXT NOT NULL DEFAULT 'Homework',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await pool.query(`ALTER TABLE classroom_assignments ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Homework';`);
    schemaReady = true;
  }

  return {
    async listWithAssignments({ classroomId, teacherId, limit = 50 }) {
      await ensureSchema();
      const l = normalizeLimit(limit, 50);

      const modulesRes = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                teacher_id AS "teacherId",
                title,
                description,
                created_at AS "createdAt"
           FROM classroom_modules
          WHERE classroom_id = $1 AND teacher_id = $2
          ORDER BY created_at DESC
          LIMIT $3`,
        [classroomId, teacherId, l]
      );

      const assignmentsRes = await pool.query(
        `SELECT id,
                classroom_id AS "classroomId",
                teacher_id AS "teacherId",
                module_id AS "moduleId",
                title,
                body,
                due_at AS "dueAt",
                points,
                category,
                created_at AS "createdAt"
           FROM classroom_assignments
          WHERE classroom_id = $1 AND teacher_id = $2
          ORDER BY created_at DESC`,
        [classroomId, teacherId]
      );

      const byModule = new Map();
      for (const a of assignmentsRes.rows) {
        const list = byModule.get(a.moduleId) || [];
        list.push(a);
        byModule.set(a.moduleId, list);
      }

      return modulesRes.rows.map((m) => ({
        ...m,
        assignments: byModule.get(m.id) || [],
      }));
    },

    async createModule({ classroomId, teacherId, title, description }) {
      await ensureSchema();
      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO classroom_modules (id, classroom_id, teacher_id, title, description)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id,
                   classroom_id AS "classroomId",
                   teacher_id AS "teacherId",
                   title,
                   description,
                   created_at AS "createdAt"`,
        [
          id,
          classroomId,
          teacherId,
          normalizeText(title, { max: 120 }),
          normalizeText(description, { max: 800 }),
        ]
      );
      return res.rows[0];
    },

    async deleteModule({ classroomId, teacherId, moduleId }) {
      await ensureSchema();
      const deletedModuleRes = await pool.query(
        `DELETE FROM classroom_modules
          WHERE id = $1 AND classroom_id = $2 AND teacher_id = $3
          RETURNING id,
                    classroom_id AS "classroomId",
                    teacher_id AS "teacherId",
                    title,
                    description,
                    created_at AS "createdAt"`,
        [moduleId, classroomId, teacherId]
      );
      const module = deletedModuleRes.rows[0] || null;
      if (!module) return null;

      const deletedAssignmentsRes = await pool.query(
        `DELETE FROM classroom_assignments
          WHERE module_id = $1 AND classroom_id = $2 AND teacher_id = $3`,
        [moduleId, classroomId, teacherId]
      );
      return { module, removedAssignments: deletedAssignmentsRes.rowCount || 0 };
    },

    async createAssignment({ classroomId, teacherId, moduleId, title, body, dueAt, points, category }) {
      await ensureSchema();
      const existsRes = await pool.query(
        `SELECT id FROM classroom_modules WHERE id = $1 AND classroom_id = $2 AND teacher_id = $3 LIMIT 1`,
        [moduleId, classroomId, teacherId]
      );
      if (!existsRes.rows[0]) return null;

      const id = crypto.randomUUID();
      const res = await pool.query(
        `INSERT INTO classroom_assignments (id, classroom_id, teacher_id, module_id, title, body, due_at, points, category)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id,
                   classroom_id AS "classroomId",
                   teacher_id AS "teacherId",
                   module_id AS "moduleId",
                   title,
                   body,
                   due_at AS "dueAt",
                   points,
                   category,
                   created_at AS "createdAt"`,
        [
          id,
          classroomId,
          teacherId,
          moduleId,
          normalizeText(title, { max: 120 }),
          normalizeText(body, { max: 5000 }),
          toNullableIsoDate(dueAt),
          Number.isFinite(Number(points)) ? Math.max(0, Math.floor(Number(points))) : null,
          normalizeText(category, { max: 40 }) || "Homework",
        ]
      );
      return res.rows[0];
    },

    async deleteAssignment({ classroomId, teacherId, moduleId, assignmentId }) {
      await ensureSchema();
      const res = await pool.query(
        `DELETE FROM classroom_assignments
          WHERE id = $1 AND module_id = $2 AND classroom_id = $3 AND teacher_id = $4
          RETURNING id,
                    classroom_id AS "classroomId",
                    teacher_id AS "teacherId",
                    module_id AS "moduleId",
                    title,
                    body,
                    due_at AS "dueAt",
                    points,
                    category,
                    created_at AS "createdAt"`,
        [assignmentId, moduleId, classroomId, teacherId]
      );
      return res.rows[0] || null;
    },
  };
}

const classroomModulesStore = process.env.DATABASE_URL
  ? createPgClassroomModulesStore()
  : createJsonClassroomModulesStore();

module.exports = { classroomModulesStore };
