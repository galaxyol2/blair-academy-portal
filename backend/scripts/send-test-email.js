const path = require("path");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const { sendPasswordResetEmail } = require("../src/services/mailer");

async function main() {
  const to = process.argv[2];
  if (!to) {
    throw new Error("Usage: node scripts/send-test-email.js you@example.com");
  }

  const fakeToken = "dev-token";
  await sendPasswordResetEmail({ to, token: fakeToken });
  // eslint-disable-next-line no-console
  console.log("Sent (or printed) password reset email.");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

