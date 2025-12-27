require("dotenv").config();

const { REST, Routes, SlashCommandBuilder } = require("discord.js");

const token = process.env.DISCORD_BOT_TOKEN;
const appId = process.env.DISCORD_APPLICATION_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !appId || !guildId) {
  // eslint-disable-next-line no-console
  console.error("Missing env: DISCORD_BOT_TOKEN, DISCORD_APPLICATION_ID, DISCORD_GUILD_ID");
  process.exit(1);
}

const announce = new SlashCommandBuilder()
  .setName("announce")
  .setDescription("Post an announcement to the Blair portal.")
  .addStringOption((opt) =>
    opt.setName("title").setDescription("Announcement title").setRequired(true)
  )
  .addStringOption((opt) =>
    opt.setName("message").setDescription("Announcement message").setRequired(true)
  );

async function main() {
  const rest = new REST({ version: "10" }).setToken(token);
  await rest.put(Routes.applicationGuildCommands(appId, guildId), {
    body: [announce.toJSON()],
  });
  // eslint-disable-next-line no-console
  console.log("Registered /announce");
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});

