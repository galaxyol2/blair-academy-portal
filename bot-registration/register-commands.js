const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !appId || !guildId) {
  if (require.main === module) {
    console.error(
      "Missing env: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID"
    );
    process.exit(1);
  }
}

const registration = new SlashCommandBuilder()
  .setName("registration")
  .setDescription("Start your student registration and pick classes.");

const purgeDm = new SlashCommandBuilder()
  .setName("purge_dm")
  .setDescription("Delete bot messages from your DMs.");

const syncRoles = new SlashCommandBuilder()
  .setName("sync_schedule_roles")
  .setDescription("Assign schedule-locked role to students who already locked.");

const resetPasswordByEmail = new SlashCommandBuilder()
  .setName("reset_password_by_email")
  .setDescription("Admin: reset a portal user's password by email.")
  .addStringOption((option) =>
    option.setName("email").setDescription("User email").setRequired(true)
  )
  .addStringOption((option) =>
    option
      .setName("new_password")
      .setDescription("New password (min 8 chars)")
      .setRequired(true)
      .setMinLength(8)
  );

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: [
      registration.toJSON(),
      purgeDm.toJSON(),
      syncRoles.toJSON(),
      resetPasswordByEmail.toJSON(),
    ],
  });
  console.log(
    "Registered /registration, /purge_dm, /sync_schedule_roles, and /reset_password_by_email"
  );
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
