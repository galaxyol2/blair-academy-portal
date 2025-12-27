const jwt = require("jsonwebtoken");

function requireJwtSecret() {
  const secret = process.env.JWT_SECRET;
  if (!secret) {
    throw new Error("Missing JWT_SECRET in backend/.env");
  }
  return secret;
}

function signAccessToken({ userId }) {
  const secret = requireJwtSecret();
  return jwt.sign({ sub: userId }, secret, { expiresIn: "7d" });
}

function signPasswordResetToken({ userId }) {
  const secret = requireJwtSecret();
  return jwt.sign({ sub: userId, purpose: "password_reset" }, secret, {
    expiresIn: "15m",
  });
}

function verifyPasswordResetToken(token) {
  const secret = requireJwtSecret();
  const payload = jwt.verify(token, secret);
  if (!payload || payload.purpose !== "password_reset" || !payload.sub) {
    const err = new Error("Invalid reset token");
    err.status = 401;
    throw err;
  }
  return { userId: payload.sub };
}

module.exports = { signAccessToken, signPasswordResetToken, verifyPasswordResetToken };
