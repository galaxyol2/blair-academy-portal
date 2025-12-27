function isEnabled() {
  return Boolean(String(process.env.SIGNUP_LOG_URL || "").trim());
}

function buildPayload({ user, sourceIp }) {
  return {
    userId: user?.id || "",
    name: user?.name || "",
    email: user?.email || "",
    createdAt: user?.createdAt || "",
    sourceIp: sourceIp || "",
  };
}

async function postSignupLog({ user, sourceIp }) {
  const url = String(process.env.SIGNUP_LOG_URL || "").trim();
  if (!url) return;

  const key = String(process.env.SIGNUP_LOG_KEY || process.env.ADMIN_API_KEY || "").trim();
  if (!key) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": key,
      },
      body: JSON.stringify(buildPayload({ user, sourceIp })),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { isEnabled, postSignupLog };

