const nodemailer = require("nodemailer");

function buildResetLink({ token }) {
  const base =
    process.env.FRONTEND_BASE_URL ||
    "http://localhost:8000";
  const url = new URL("reset-password.html", base.endsWith("/") ? base : `${base}/`);
  url.searchParams.set("token", token);
  return url.toString();
}

function hasSmtpConfig() {
  return !!process.env.SMTP_HOST;
}

function buildTransport() {
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || "false").toLowerCase() === "true";

  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure,
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS || "" }
      : undefined,
  });
}

async function sendPasswordResetEmail({ to, token }) {
  const resetLink = buildResetLink({ token });

  if (hasSmtpConfig()) {
    const from = process.env.SMTP_FROM || "no-reply@example.com";
    const transport = buildTransport();
    await transport.sendMail({
      from,
      to,
      subject: "Reset your password",
      text: `Reset your password:\n\n${resetLink}\n\nThis link expires in 15 minutes.`,
      html: `<p>Reset your password:</p><p><a href="${resetLink}">${resetLink}</a></p><p>This link expires in 15 minutes.</p>`,
    });
    // eslint-disable-next-line no-console
    console.log(`[password-reset] Sent to: ${to} (via SMTP)`);
    return { ok: true };
  }

  // Dev/default behavior: print the link so you can click it.
  // eslint-disable-next-line no-console
  console.log(`[password-reset] To: ${to}`);
  // eslint-disable-next-line no-console
  console.log(`[password-reset] Link: ${resetLink}`);

  return { ok: true, resetLink };
}

module.exports = { sendPasswordResetEmail, buildResetLink };
