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

module.exports = { signAccessToken };

