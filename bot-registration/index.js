const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  PermissionsBitField,
  StringSelectMenuBuilder,
} = require("discord.js");

function requiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

function requiredEnvAny(names) {
  for (const name of names) {
    const v = String(process.env[name] || "").trim();
    if (v) return v;
  }
  throw new Error(`Missing env: ${names[0]} (also checked: ${names.slice(1).join(", ")})`);
}

const DISCORD_BOT_TOKEN = requiredEnv("DISCORD_BOT_TOKEN");
const DISCORD_GUILD_ID = String(process.env.DISCORD_GUILD_ID || "").trim();
const ADMIN_API_KEY = requiredEnvAny(["ADMIN_API_KEY", "ADMIN_KEY"]);
const SCHEDULE_UPDATE_URL = requiredEnvAny(["SCHEDULE_UPDATE_URL", "SCHEDULE_API_URL"]);

const ALLOWED_ROLE_ID = String(process.env.ALLOWED_ROLE_ID || "").trim();
const ALLOWED_CHANNEL_ID = String(process.env.ALLOWED_CHANNEL_ID || "").trim();

const semester1Classes = [
  { label: "Nutrition & Healthy Living", value: "Nutrition & Healthy Living" },
  { label: "Photography & Digital Imaging", value: "Photography & Digital Imaging" },
  { label: "Introduction to Journalism", value: "Introduction to Journalism" },
  { label: "Introduction to Psychology", value: "Introduction to Psychology" },
  { label: "Sexual & Reproductive Health", value: "Sexual & Reproductive Health" },
  { label: "Literature & Film", value: "Literature & Film" },
  { label: "Influencer & Creator Marketing", value: "Influencer & Creator Marketing" },
  { label: "Fitness & Strength Training", value: "Fitness & Strength Training" },
  { label: "Introduction Of Arts I", value: "Introduction Of Arts I" },
  { label: "Investigative Journalism", value: "Investigative Journalism" },
  { label: "Music Ensembles", value: "Music Ensembles" },
  { label: "News Writing & Reporting", value: "News Writing & Reporting" },
  { label: "Family Law", value: "Family Law" },
];

const allYearElectives = [];

const classesCatalog = [...semester1Classes, ...allYearElectives];

function canUse(interaction) {
  if (ALLOWED_CHANNEL_ID && interaction.channelId !== ALLOWED_CHANNEL_ID) return false;
  if (ALLOWED_ROLE_ID) {
    return Boolean(interaction.member?.roles?.cache?.has(ALLOWED_ROLE_ID));
  }
  return true;
}

async function updateSchedule({ discordId, classes }) {
  const res = await fetch(SCHEDULE_UPDATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
    },
    body: JSON.stringify({ discordId, classes }),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

client.once(Events.ClientReady, () => {
  // eslint-disable-next-line no-console
  console.log(`Registration bot ready as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName !== "registration") return;

    if (DISCORD_GUILD_ID && interaction.guildId && interaction.guildId !== DISCORD_GUILD_ID) {
      await interaction.reply({ content: "This command isn't available here.", ephemeral: true });
      return;
    }

    if (!canUse(interaction)) {
      await interaction.reply({
        content: "You don't have permission to use this command.",
        ephemeral: true,
      });
      return;
    }

    await interaction.reply({ content: "Check your DMs to complete registration.", ephemeral: true });

    const menu = new StringSelectMenuBuilder()
      .setCustomId("registration_classes")
      .setPlaceholder("Select your classes")
      .setMinValues(1)
      .setMaxValues(Math.min(8, classesCatalog.length))
      .addOptions(classesCatalog);

    const row = new ActionRowBuilder().addComponents(menu);
    const embed = new EmbedBuilder()
      .setTitle("Student Registration")
      .setDescription("Select your classes below. We will sync them to your portal schedule.")
      .setColor(0xd4a017);

    try {
      await interaction.user.send({ embeds: [embed], components: [row] });
    } catch (err) {
      await interaction.followUp({
        content: "I couldn't DM you. Please enable DMs and try again.",
        ephemeral: true,
      });
    }
    return;
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId !== "registration_classes") return;
    const selected = interaction.values || [];
    if (selected.length === 0) {
      await interaction.reply({ content: "Please choose at least one class.", ephemeral: true });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      await updateSchedule({ discordId: interaction.user.id, classes: selected });
      await interaction.editReply("Schedule saved to your portal.");
    } catch (err) {
      await interaction.editReply(`Failed to save schedule: ${err.message}`);
    }
  }
});

client.login(DISCORD_BOT_TOKEN);
