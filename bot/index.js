const path = require("path");
const http = require("http");
require("dotenv").config({ path: path.join(__dirname, ".env") });

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

function requiredEnvAny(names) {
  for (const name of names) {
    const v = String(process.env[name] || "").trim();
    if (v) return v;
  }

  const presence = Object.fromEntries(
    names.map((n) => [n, Boolean(String(process.env[n] || "").trim())])
  );
  throw new Error(
    `Missing env: ${names[0]} (also checked: ${names.slice(1).join(", ")}) | cwd=${process.cwd()} | present=${JSON.stringify(
      presence
    )}`
  );
}

const ANNOUNCE_API_URL = requiredEnvAny([
  "ANNOUNCE_API_URL",
  "ANNOUNCE_URL",
  "ANNOUNCEMENTS_API_URL",
]);
const ADMIN_API_KEY = requiredEnvAny(["ADMIN_API_KEY", "ADMIN_KEY"]);
const DISCORD_BOT_TOKEN = requiredEnv("DISCORD_BOT_TOKEN");

const ALLOWED_ROLE_ID = String(process.env.ALLOWED_ROLE_ID || "").trim();
const ALLOWED_CHANNEL_ID = String(process.env.ALLOWED_CHANNEL_ID || "").trim();
const SIGNUP_LOG_CHANNEL_ID = String(process.env.SIGNUP_LOG_CHANNEL_ID || "").trim();

const LOG_SERVER_DISABLED = ["1", "true", "yes"].includes(
  String(process.env.DISABLE_LOG_SERVER || "").trim().toLowerCase()
);
const LOG_SERVER_PORT = Number(process.env.BOT_PORT || process.env.PORT || 3002);

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

async function clearAllAnnouncements() {
  const res = await fetch(ANNOUNCE_API_URL, {
    method: "DELETE",
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
    const msg =
      (json && (json.error || json.message)) || `Request failed (${res.status})`;
    throw new Error(msg);
  }

  return Number(json?.deleted || 0);
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

let clientReady = false;
client.once(Events.ClientReady, () => {
  clientReady = true;
  // eslint-disable-next-line no-console
  console.log(`Bot ready as ${client.user.tag}`);
});

async function sendSignupLog({ name, email, userId, createdAt, sourceIp }) {
  if (!SIGNUP_LOG_CHANNEL_ID) throw new Error("Missing env: SIGNUP_LOG_CHANNEL_ID");

  const channel = await client.channels.fetch(SIGNUP_LOG_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error("SIGNUP_LOG_CHANNEL_ID is not a text channel");
  }

  const parts = [
    `New signup: ${name || "(no name)"} <${email || "no-email"}>`,
    userId ? `id: ${userId}` : null,
    createdAt ? `createdAt: ${createdAt}` : null,
    sourceIp ? `ip: ${sourceIp}` : null,
  ].filter(Boolean);

  await channel.send(parts.join(" | "));
}

function readJsonBody(req, { limitBytes = 20_000 } = {}) {
  return new Promise((resolve, reject) => {
    let total = 0;
    const chunks = [];

    req.on("data", (chunk) => {
      total += chunk.length;
      if (total > limitBytes) {
        reject(new Error("Body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8").trim();
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (_err) {
        reject(new Error("Invalid JSON"));
      }
    });

    req.on("error", reject);
  });
}

function startLogServer() {
  if (LOG_SERVER_DISABLED) return;

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);

      if (req.method === "GET" && url.pathname === "/health") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            ok: true,
            discordReady: clientReady,
            signupLogChannelConfigured: Boolean(SIGNUP_LOG_CHANNEL_ID),
          })
        );
        return;
      }

      if (req.method !== "POST" || url.pathname !== "/internal/log-signup") {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Not found" }));
        return;
      }

      const adminKey = String(req.headers["x-admin-key"] || "").trim();
      if (!adminKey || adminKey !== ADMIN_API_KEY) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }

      if (!clientReady) {
        res.writeHead(503, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Discord client not ready" }));
        return;
      }

      const body = await readJsonBody(req);
      await sendSignupLog({
        name: String(body?.name || "").trim(),
        email: String(body?.email || "").trim(),
        userId: String(body?.userId || "").trim(),
        createdAt: String(body?.createdAt || "").trim(),
        sourceIp: String(body?.sourceIp || "").trim(),
      });

      // eslint-disable-next-line no-console
      console.log(
        `[signup-log] Posted signup for ${String(body?.email || "").trim() || "(no email)"}`
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[signup-log] Error: ${err.message || err}`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Bad request" }));
    }
  });

  server.listen(LOG_SERVER_PORT, () => {
    // eslint-disable-next-line no-console
    console.log(
      `Log server listening on http://localhost:${LOG_SERVER_PORT} (signup channel set: ${Boolean(
        SIGNUP_LOG_CHANNEL_ID
      )})`
    );
  });
}

startLogServer();

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== "announce" && interaction.commandName !== "clear-announcements") {
    return;
  }

  if (!canUse(interaction)) {
    await interaction.reply({
      content: "You don't have permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "clear-announcements") {
    const confirm = Boolean(interaction.options.getBoolean("confirm"));
    if (!confirm) {
      await interaction.reply({
        content: "Not cleared. Set `confirm: true` to proceed.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const deleted = await clearAllAnnouncements();
      await interaction.editReply(`Cleared ${deleted} announcement(s).`);
    } catch (err) {
      await interaction.editReply(`Failed to clear: ${err.message}`);
    }
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
