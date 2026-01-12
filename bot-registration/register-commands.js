const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !appId || !guildId) {
  if (require.main === module) {
    // eslint-disable-next-line no-console
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

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: [registration.toJSON(), purgeDm.toJSON(), syncRoles.toJSON()],
  });
  // eslint-disable-next-line no-console
  console.log("Registered /registration, /purge_dm, and /sync_schedule_roles");
}

if (require.main === module) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
