require("dotenv").config();

const {
  Client,
  GatewayIntentBits,
  PermissionsBitField,
  Events,
} = require("discord.js");

function requiredEnv(name) {
  const v = String(process.env[name] || "").trim();
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

const ANNOUNCE_API_URL = requiredEnv("ANNOUNCE_API_URL");
const ADMIN_API_KEY = requiredEnv("ADMIN_API_KEY");
const DISCORD_BOT_TOKEN = requiredEnv("DISCORD_BOT_TOKEN");

const ALLOWED_ROLE_ID = String(process.env.ALLOWED_ROLE_ID || "").trim();
const ALLOWED_CHANNEL_ID = String(process.env.ALLOWED_CHANNEL_ID || "").trim();

function canUse(interaction) {
  if (ALLOWED_CHANNEL_ID && interaction.channelId !== ALLOWED_CHANNEL_ID) return false;

  if (ALLOWED_ROLE_ID) {
    return Boolean(interaction.member?.roles?.cache?.has(ALLOWED_ROLE_ID));
  }

  return interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild);
}

async function postAnnouncement({ title, body, createdBy }) {
  const res = await fetch(ANNOUNCE_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      title,
      body,
      source: "discord",
      createdBy,
    }),
  });

  let json = null;
  try {
    json = await res.json();
  } catch {
    // ignore
  }

  if (!res.ok) {
    const msg =
      (json && (json.error || json.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
  return json?.item || null;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

client.once(Events.ClientReady, () => {
  // eslint-disable-next-line no-console
  console.log(`Bot ready as ${client.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "announce") return;

  if (!canUse(interaction)) {
    await interaction.reply({
      content: "You don’t have permission to use /announce.",
      ephemeral: true,
    });
    return;
  }

  const title = String(interaction.options.getString("title") || "").trim();
  const message = String(interaction.options.getString("message") || "").trim();

  if (!title || !message) {
    await interaction.reply({ content: "Missing title or message.", ephemeral: true });
    return;
  }

  await interaction.deferReply({ ephemeral: true });
  try {
    await postAnnouncement({
      title,
      body: message,
      createdBy: `${interaction.user.tag} (${interaction.user.id})`,
    });
    await interaction.editReply("Posted announcement to the portal.");
  } catch (err) {
    await interaction.editReply(`Failed to post: ${err.message}`);
  }
});

client.login(DISCORD_BOT_TOKEN);

