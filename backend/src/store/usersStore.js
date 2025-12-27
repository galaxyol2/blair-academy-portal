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

const usersStore = {
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
    db.users[idx] = { ...db.users[idx], passwordHash, updatedAt: new Date().toISOString() };
    await writeDb(db);
    return db.users[idx];
  },
};

module.exports = { usersStore };
