const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  ActionRowBuilder,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  MessageFlags,
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
const DEBUG_REGISTRATION = /^(1|true|yes)$/i.test(
  String(process.env.REGISTRATION_DEBUG || "").trim()
);

const classesCatalog = [
  { label: "Nutrition & Healthy Living", value: "Nutrition & Healthy Living" },
  { label: "Introduction to Psychology", value: "Introduction to Psychology" },
  { label: "Literature & Film", value: "Literature & Film" },
  { label: "Family Law", value: "Family Law" },
  { label: "News Writing & Reporting", value: "News Writing & Reporting" },
];

function canUse(interaction) {
  if (ALLOWED_CHANNEL_ID && interaction.channelId !== ALLOWED_CHANNEL_ID) return false;
  if (ALLOWED_ROLE_ID) {
    return Boolean(interaction.member?.roles?.cache?.has(ALLOWED_ROLE_ID));
  }
  return true;
}

function ephemeralReply(content) {
  return { content, flags: MessageFlags.Ephemeral };
}

function debugLog(message, details) {
  if (!DEBUG_REGISTRATION) return;
  if (details !== undefined) {
    // eslint-disable-next-line no-console
    console.log(`[debug] ${message}`, details);
    return;
  }
  // eslint-disable-next-line no-console
  console.log(`[debug] ${message}`);
}

async function updateSchedule({ discordId, classes }) {
  debugLog("schedule:update:start", { discordId, classesCount: classes.length });
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

  debugLog("schedule:update:response", { status: res.status, ok: res.ok });
  if (!res.ok) {
    const msg = (json && (json.error || json.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.DirectMessages],
});

function startHealthServer() {
  const rawPort = String(process.env.PORT || "").trim();
  if (!rawPort) return;

  const port = Number(rawPort);
  if (!Number.isFinite(port)) return;

  const server = http.createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("ok");
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`Health server listening on ${port}`);
  });
}

client.once(Events.ClientReady, () => {
  // eslint-disable-next-line no-console
  console.log(`Registration bot ready as ${client.user.tag}`);
});

process.on("unhandledRejection", (err) => {
  // eslint-disable-next-line no-console
  console.error("Unhandled rejection", err);
});

process.on("uncaughtException", (err) => {
  // eslint-disable-next-line no-console
  console.error("Uncaught exception", err);
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    debugLog("interaction:received", {
      type: interaction.type,
      command: interaction.commandName || null,
      customId: interaction.customId || null,
      userId: interaction.user?.id || null,
      guildId: interaction.guildId || null,
      channelId: interaction.channelId || null,
    });
    if (interaction.isChatInputCommand()) {
      if (interaction.commandName !== "registration") return;

      if (DISCORD_GUILD_ID && interaction.guildId && interaction.guildId !== DISCORD_GUILD_ID) {
        debugLog("interaction:registration:blocked", { reason: "guild-mismatch" });
        await interaction.reply(ephemeralReply("This command isn't available here."));
        return;
      }

      if (!canUse(interaction)) {
        debugLog("interaction:registration:blocked", { reason: "permission" });
        await interaction.reply(ephemeralReply("You don't have permission to use this command."));
        return;
      }

      await interaction.reply(ephemeralReply("Check your DMs to complete registration."));
      debugLog("interaction:registration:dm-prompted");

      const menu = new StringSelectMenuBuilder()
        .setCustomId("registration_classes")
        .setPlaceholder("Select your classes")
        .setMinValues(1)
        .setMaxValues(Math.min(4, classesCatalog.length))
        .addOptions(classesCatalog);

      const row = new ActionRowBuilder().addComponents(menu);
      const embed = new EmbedBuilder()
        .setTitle("Student Registration")
        .setDescription("Select your classes below. We will sync them to your portal schedule.")
        .setColor(0xd4a017);

      try {
        await interaction.user.send({ embeds: [embed], components: [row] });
        debugLog("interaction:registration:dm-sent");
      } catch (err) {
        debugLog("interaction:registration:dm-failed", { message: err?.message || String(err) });
        await interaction.followUp(
          ephemeralReply("I couldn't DM you. Please enable DMs and try again.")
        );
      }
      return;
    }

    if (interaction.isAnySelectMenu()) {
      if (interaction.customId !== "registration_classes") return;
      const selected = interaction.values || [];
      debugLog("interaction:registration:selected", { count: selected.length });
      if (selected.length === 0) {
        await interaction.reply(ephemeralReply("Please choose at least one class."));
        return;
      }

      try {
        await interaction.deferUpdate();
        debugLog("interaction:registration:ack");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to acknowledge registration select menu", err);
        return;
      }

      try {
        await updateSchedule({ discordId: interaction.user.id, classes: selected });
        await interaction.user.send("Schedule saved to your portal.");
      } catch (err) {
        const msg = String(err?.message || "Unable to save schedule.");
        if (/user not found/i.test(msg)) {
          await interaction.user.send(
            "Please connect Discord in your portal Settings first so we can sync your schedule."
          );
        } else {
          await interaction.user.send(`Failed to save schedule: ${msg}`);
        }
      } finally {
        if (interaction.message?.components?.length) {
          try {
            await interaction.message.edit({ components: [] });
          } catch (_err) {
            // ignore
          }
        }
      }
    }
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error("Interaction handler failed", err);
  }
});

startHealthServer();
client.login(DISCORD_BOT_TOKEN);
