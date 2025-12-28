const { verifyAccessToken } = require("../services/tokens");
const { usersStore } = require("../store/usersStore");

function requireBearerToken(req) {
  const header = String(req.get("authorization") || "");
  const match = header.match(/^Bearer\s+(.+)$/i);
  const token = match ? match[1].trim() : "";
  if (!token) {
    const err = new Error("Missing access token");
    err.status = 401;
    throw err;
  }
  return token;
}

async function requireAuth(req, res, next) {
  try {
    const token = requireBearerToken(req);
    const { userId } = verifyAccessToken(token);
    const user = await usersStore.findById(userId);
    if (!user) return res.status(401).json({ error: "Invalid access token" });
    req.userId = userId;
    req.user = user;
    return next();
  } catch (_err) {
    return res.status(401).json({ error: "Invalid access token" });
  }
}

function requireTeacher(req, res, next) {
  const role = String(req.user?.role || "student").toLowerCase();
  if (role !== "teacher") return res.status(403).json({ error: "Forbidden" });
  return next();
}

module.exports = { requireAuth, requireTeacher };

