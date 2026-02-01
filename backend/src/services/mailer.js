const nodemailer = require("nodemailer");
const dns = require("dns");

function buildResetLink({ token }) {
  const rawBase = String(process.env.FRONTEND_BASE_URL || "http://localhost:8000").trim();
  const base = rawBase.startsWith("http://") || rawBase.startsWith("https://")
    ? rawBase
    : `https://${rawBase}`;
  const url = new URL("reset-password", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

function hasSmtpConfig() {
  return !!process.env.SMTP_HOST;
}

function hasSendgridApiConfig() {
  return !!process.env.SENDGRID_API_KEY;
}

function buildTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    lookup(hostname, options, callback) {
      // Prefer IPv4 in serverless/container environments where IPv6 may be flaky.
      return dns.lookup(hostname, { ...options, family: 4 }, callback);
    },
    connectionTimeout: Number(process.env.SMTP_CONNECTION_TIMEOUT_MS || 20000),
    greetingTimeout: Number(process.env.SMTP_GREETING_TIMEOUT_MS || 20000),
    socketTimeout: Number(process.env.SMTP_SOCKET_TIMEOUT_MS || 20000),
    requireTLS: port === 587 && !secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
}

async function sendViaSendgridApi({ from, to, subject, text, html }) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const res = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      personalizations: [{ to: [{ email: to }] }],
      from: typeof from === "string" ? { email: from } : from,
      subject,
      content: [
        { type: "text/plain", value: text },
        { type: "text/html", value: html },
      ],
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const err = new Error(`SendGrid API failed (${res.status}): ${body}`);
    err.status = res.status;
    throw err;
  }
}

async function sendPasswordResetEmail({ to, token }) {
  const resetLink = buildResetLink({ token });

  const from = process.env.SMTP_FROM || "no-reply@example.com";
  const subject = "Reset your password";
  const text = `Reset your password:\n\n${resetLink}\n\nThis link expires in 15 minutes.`;
  const html = `<p>Reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in 15 minutes.</p>`;

  if (hasSendgridApiConfig()) {
    await sendViaSendgridApi({ from, to, subject, text, html });
    console.log(`[password-reset] Sent to: ${to} (via SendGrid API)`);
    return { ok: true, provider: "sendgrid_api" };
  }

  if (hasSmtpConfig()) {
    const transport = buildTransport();
    await transport.sendMail({ from, to, subject, text, html });
    console.log(`[password-reset] Sent to: ${to} (via SMTP)`);
    return { ok: true, provider: "smtp" };
  }

  // Dev/default behavior: print the link so you can click it.
  console.log(`[password-reset] To: ${to}`);
  console.log(`[password-reset] Link: ${resetLink}`);

  return { ok: true, resetLink };
}

module.exports = { sendPasswordResetEmail, buildResetLink };
