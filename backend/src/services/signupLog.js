function isEnabled() {
  return Boolean(String(process.env.SIGNUP_LOG_URL || "").trim());
}

function buildPayload({ user }) {
  return {
    userId: user?.id || "",
    name: user?.name || "",
    email: user?.email || "",
    createdAt: user?.createdAt || "",
  };
}

async function postSignupLog({ user }) {
  const url = String(process.env.SIGNUP_LOG_URL || "").trim();
  if (!url) return;

  const key = String(process.env.SIGNUP_LOG_KEY || process.env.ADMIN_API_KEY || "").trim();
  if (!key) return;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2000);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-admin-key": key,
      },
      body: JSON.stringify(buildPayload({ user })),
      signal: controller.signal,
    });
    if (!res.ok) {
      let detail = "";
      try {
        detail = String(await res.text()).trim();
      } catch {
        // ignore
      }
      throw new Error(
        `Signup log request failed (${res.status})${detail ? `: ${detail}` : ""}`
      );
    }
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { isEnabled, postSignupLog };
