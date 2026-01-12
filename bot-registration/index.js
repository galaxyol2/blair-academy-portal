const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
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
const REGISTRATION_LOG_CHANNEL_ID = String(
  process.env.REGISTRATION_LOG_CHANNEL_ID || "1452214511854682223"
).trim();
const DEBUG_REGISTRATION = /^(1|true|yes)$/i.test(
  String(process.env.REGISTRATION_DEBUG || "").trim()
);

const coursesCatalog = [
  { label: "Nutrition & Healthy Living", value: "Nutrition & Healthy Living" },
  { label: "Introduction To Psychology", value: "Introduction To Psychology" },
  { label: "Literature & Film", value: "Literature & Film" },
  { label: "Family Law", value: "Family Law" },
  { label: "News Writing & Reporting", value: "News Writing & Reporting" },
];

const electivesCatalog = [
  { label: "Music Ensembles", value: "Music Ensembles" },
  { label: "Fitness & Strength Training", value: "Fitness & Strength Training" },
  { label: "Introduction of Art I", value: "Introduction of Art I" },
  { label: "Sexual & Reproductive Health", value: "Sexual & Reproductive Health" },
];

const registrationSelections = new Map();

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

async function logRegistrationAttempt(interaction, { status, reason } = {}) {
  if (!REGISTRATION_LOG_CHANNEL_ID) return;
  try {
    const channel = await client.channels.fetch(REGISTRATION_LOG_CHANNEL_ID);
    if (!channel || typeof channel.send !== "function") return;

    const member = interaction.member;
    const user = interaction.user;
    const guildName = interaction.guild?.name || "Unknown guild";
    const tag = user?.tag || user?.username || "Unknown user";
    const statusText = status ? String(status) : "attempted";
    const reasonText = reason ? String(reason) : "—";

    const embed = new EmbedBuilder()
      .setTitle("Registration command")
      .setColor(0xd4a017)
      .addFields(
        { name: "User", value: `${tag} (${user?.id || "unknown"})`, inline: true },
        { name: "Guild", value: `${guildName} (${interaction.guildId || "unknown"})`, inline: true },
        { name: "Status", value: statusText, inline: true },
        { name: "Reason", value: reasonText }
      )
      .setTimestamp(new Date());

    if (member?.roles?.cache?.size) {
      const roles = member.roles.cache
        .filter((r) => r?.name && r?.id !== interaction.guildId)
        .map((r) => r.name)
        .slice(0, 8);
      if (roles.length) embed.addFields({ name: "Roles", value: roles.join(", ") });
    }

    await channel.send({ embeds: [embed] });
  } catch (err) {
    debugLog("registration:log-failed", { message: err?.message || String(err) });
  }
}

function getSelections(userId) {
  const key = String(userId || "").trim();
  const fallback = { courses: [], electives: [] };
  if (!key) return fallback;
  const existing = registrationSelections.get(key);
  if (existing) return existing;
  registrationSelections.set(key, fallback);
  return fallback;
}

function formatSelectionList(items) {
  if (!items.length) return "None selected";
  return items.map((item) => `- ${item}`).join("\n");
}

function buildSelectionSummary(selections) {
  return [
    "Confirm your schedule selections:",
    "",
    "Courses (4 required):",
    formatSelectionList(selections.courses),
    "",
    "Electives (2 required):",
    formatSelectionList(selections.electives),
    "",
    "Lock your schedule to finalize for Semester 1.",
  ].join("\n");
}

async function purgeBotMessages(channel, { keepMessageId } = {}) {
  if (!channel || typeof channel.messages?.fetch !== "function") return 0;
  let deleted = 0;
  let beforeId = null;

  while (true) {
    const batch = await channel.messages.fetch({
      limit: 100,
      ...(beforeId ? { before: beforeId } : {}),
    });
    if (!batch.size) break;

    for (const msg of batch.values()) {
      if (msg?.author?.id !== client.user?.id) continue;
      if (keepMessageId && msg.id === keepMessageId) continue;
      try {
        await msg.delete();
        deleted += 1;
      } catch (err) {
        debugLog("dm:purge:delete-failed", { message: err?.message || String(err) });
      }
    }

    beforeId = batch.last()?.id;
    if (batch.size < 100) break;
  }

  debugLog("dm:purge:done", { deleted });
  return deleted;
}

async function updateSchedule({ discordId, classes }) {
  debugLog("schedule:update:start", { discordId, classesCount: classes.length });
  const res = await fetch(SCHEDULE_UPDATE_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
    },
    body: JSON.stringify({ discordId, classes, lock: true }),
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

async function fetchScheduleStatus(discordId) {
  const url = new URL(`${SCHEDULE_UPDATE_URL.replace(/\/schedule$/i, "")}/schedule/status`);
  url.searchParams.set("discordId", discordId);
  const res = await fetch(url.toString(), {
    headers: {
      "x-admin-key": ADMIN_API_KEY,
    },
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

  return Boolean(json?.scheduleLocked);
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
      if (interaction.commandName !== "registration" && interaction.commandName !== "purge_dm") return;

      if (interaction.commandName === "purge_dm") {
        if (!canUse(interaction)) {
          await interaction.reply(ephemeralReply("You don't have permission to use this command."));
          return;
        }

        await interaction.reply(ephemeralReply("Cleaning your DMs..."));
        try {
          const dm = await interaction.user.createDM();
          const deleted = await purgeBotMessages(dm);
          await interaction.editReply(`Done. Deleted ${deleted} bot messages from your DMs.`);
        } catch (err) {
          await interaction.editReply(
            err?.message ? `Unable to clean DMs: ${err.message}` : "Unable to clean DMs."
          );
        }
        return;
      }

      await logRegistrationAttempt(interaction, { status: "attempted" });

      if (DISCORD_GUILD_ID && interaction.guildId && interaction.guildId !== DISCORD_GUILD_ID) {
        debugLog("interaction:registration:blocked", { reason: "guild-mismatch" });
        await logRegistrationAttempt(interaction, { status: "blocked", reason: "guild-mismatch" });
        await interaction.reply(ephemeralReply("This command isn't available here."));
        return;
      }

      if (!canUse(interaction)) {
        debugLog("interaction:registration:blocked", { reason: "permission" });
        await logRegistrationAttempt(interaction, { status: "blocked", reason: "permission" });
        await interaction.reply(ephemeralReply("You don't have permission to use this command."));
        return;
      }

      try {
        const locked = await fetchScheduleStatus(interaction.user.id);
        if (locked) {
          await logRegistrationAttempt(interaction, { status: "blocked", reason: "schedule-locked" });
          await interaction.reply(
            ephemeralReply("Your schedule is locked until Semester 2.")
          );
          return;
        }
      } catch (err) {
        const msg = String(err?.message || "");
        if (!/user not found/i.test(msg)) {
          debugLog("interaction:registration:status-failed", { message: msg });
          await logRegistrationAttempt(interaction, { status: "error", reason: msg });
        }
      }

      await interaction.reply(ephemeralReply("Check your DMs to complete registration."));
      debugLog("interaction:registration:dm-prompted");

      const coursesMenu = new StringSelectMenuBuilder()
        .setCustomId("registration_courses")
        .setPlaceholder("Select your courses")
        .setMinValues(Math.min(4, coursesCatalog.length))
        .setMaxValues(Math.min(4, coursesCatalog.length))
        .addOptions(coursesCatalog);

      const electivesMenu = new StringSelectMenuBuilder()
        .setCustomId("registration_electives")
        .setPlaceholder("Select up to 2 electives")
        .setMinValues(Math.min(2, electivesCatalog.length))
        .setMaxValues(Math.min(2, electivesCatalog.length))
        .addOptions(electivesCatalog);

      const rows = [
        new ActionRowBuilder().addComponents(coursesMenu),
        new ActionRowBuilder().addComponents(electivesMenu),
      ];
      const embed = new EmbedBuilder()
        .setTitle("Student Registration")
        .setDescription("Pick your courses and electives. We will sync them to your portal schedule.")
        .setColor(0xd4a017);

      try {
        await interaction.user.send({ embeds: [embed], components: rows });
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
      if (
        interaction.customId !== "registration_courses" &&
        interaction.customId !== "registration_electives"
      ) {
        return;
      }
      const selected = interaction.values || [];
      debugLog("interaction:registration:selected", {
        menu: interaction.customId,
        count: selected.length,
        values: selected,
      });

      try {
        await interaction.deferUpdate();
        debugLog("interaction:registration:ack");
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("Failed to acknowledge registration select menu", err);
        return;
      }

      const selections = getSelections(interaction.user.id);
      if (interaction.customId === "registration_courses") {
        selections.courses = selected;
      } else {
        selections.electives = selected;
      }
      registrationSelections.set(interaction.user.id, selections);

      const hasCourses = selections.courses.length > 0;
      const hasElectives = selections.electives.length > 0;
      if (!hasCourses) {
        await interaction.user.send(
          "Electives saved. Select exactly 4 courses to finish registration."
        );
        return;
      }
      if (!hasElectives) {
        await interaction.user.send(
          "Courses saved. Select exactly 2 electives to finish registration."
        );
        return;
      }

      const lockButton = new ButtonBuilder()
        .setCustomId("registration_lock")
        .setLabel("Lock schedule")
        .setStyle(ButtonStyle.Primary);
      const editButton = new ButtonBuilder()
        .setCustomId("registration_edit")
        .setLabel("Keep editing")
        .setStyle(ButtonStyle.Secondary);
      const row = new ActionRowBuilder().addComponents(lockButton, editButton);
      const summary = buildSelectionSummary(selections);
      await interaction.user.send({ content: summary, components: [row] });
    }

    if (interaction.isButton()) {
      if (interaction.customId !== "registration_lock" && interaction.customId !== "registration_edit") {
        return;
      }

      const selections = getSelections(interaction.user.id);
      if (interaction.customId === "registration_edit") {
        await interaction.update({
          content: "Okay! Update your selections and lock when you're ready.",
          components: [],
        });
        return;
      }

      if (!selections.courses.length) {
        await interaction.update({
          content: "Select exactly 4 courses before locking your schedule.",
          components: [],
        });
        return;
      }
      if (!selections.electives.length) {
        await interaction.update({
          content: "Select exactly 2 electives before locking your schedule.",
          components: [],
        });
        return;
      }
      if (selections.courses.length !== 4) {
        await interaction.update({
          content: "Please select exactly 4 courses before locking your schedule.",
          components: [],
        });
        return;
      }
      if (selections.electives.length !== 2) {
        await interaction.update({
          content: "Please select exactly 2 electives before locking your schedule.",
          components: [],
        });
        return;
      }

      const combined = [...selections.courses, ...selections.electives];
      try {
        await updateSchedule({ discordId: interaction.user.id, classes: combined });
        registrationSelections.delete(interaction.user.id);
        await interaction.update({
          content: "Finalizing your schedule...",
          components: [],
        });

        const dm = await interaction.user.createDM();
        await purgeBotMessages(dm);
        await dm.send(
          "Schedule locked for Semester 1. You cannot change it until Semester 2."
        );
      } catch (err) {
        const msg = String(err?.message || "Unable to save schedule.");
        if (/user not found/i.test(msg)) {
          await interaction.update({
            content:
              "Please connect Discord in your portal Settings first so we can sync your schedule.",
            components: [],
          });
        } else {
          await interaction.update({
            content: `Failed to save schedule: ${msg}`,
            components: [],
          });
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
