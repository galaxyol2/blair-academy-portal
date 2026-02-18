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
const DISCORD_GUILD_ID = String(process.env.DISCORD_GUILD_ID || "").trim();

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

function backendOrigin() {
  const u = new URL(ANNOUNCE_API_URL);
  return u.origin;
}

async function deleteUserByEmail(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("Missing email.");

  const url = `${backendOrigin()}/api/admin/users?email=${encodeURIComponent(e)}`;
  const res = await fetch(url, {
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

  return json?.deleted || null;
}

async function updateUserName({ email, firstName, lastName }) {
  const e = String(email || "").trim().toLowerCase();
  if (!e) throw new Error("Missing email.");
  if (!firstName && !lastName) throw new Error("Provide first and/or last name.");

  const url = `${backendOrigin()}/api/admin/users/name`;
  const res = await fetch(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      email: e,
      firstName: firstName ? String(firstName).trim() : undefined,
      lastName: lastName ? String(lastName).trim() : undefined,
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

  return json?.user || null;
}

async function resetUserPassword({ email, newPassword }) {
  const e = String(email || "").trim().toLowerCase();
  const password = String(newPassword || "");
  if (!e) throw new Error("Missing email.");
  if (!password || password.length < 8) {
    throw new Error("New password must be at least 8 characters.");
  }

  const url = `${backendOrigin()}/api/admin/users/reset-password`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-admin-key": ADMIN_API_KEY,
    },
    body: JSON.stringify({
      email: e,
      newPassword: password,
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

  return json?.user || null;
}

const client = new Client({
  intents: [GatewayIntentBits.Guilds],
});

function createCooldown({ windowMs, maxUses }) {
  const uses = new Map(); // key -> number[] (timestamps)

  return function hit(key) {
    const now = Date.now();
    const list = uses.get(key) || [];
    const filtered = list.filter((t) => now - t < windowMs);
    filtered.push(now);
    uses.set(key, filtered);

    const allowed = filtered.length <= maxUses;
    const retryAfterMs = allowed ? 0 : Math.max(1, windowMs - (now - filtered[0]));
    return { allowed, retryAfterMs };
  };
}

// Per Discord user, per command.
const commandCooldown = createCooldown({ windowMs: 60_000, maxUses: 5 });

let clientReady = false;
client.once(Events.ClientReady, () => {
  clientReady = true;
  console.log(`Bot ready as ${client.user.tag}`);

  if (SIGNUP_LOG_CHANNEL_ID && DISCORD_GUILD_ID && SIGNUP_LOG_CHANNEL_ID === DISCORD_GUILD_ID) {
    console.warn(
      "SIGNUP_LOG_CHANNEL_ID matches DISCORD_GUILD_ID; you likely pasted the server ID instead of the channel ID."
    );
  }

  if (SIGNUP_LOG_CHANNEL_ID) {
    client.channels
      .fetch(SIGNUP_LOG_CHANNEL_ID)
      .then((ch) => {
        if (!ch || !ch.isTextBased()) {
          console.warn("SIGNUP_LOG_CHANNEL_ID is not a text channel.");
        }
      })
      .catch((err) => {
        console.warn(`SIGNUP_LOG_CHANNEL_ID is invalid or not accessible: ${err.message}`);
      });
  }
});

function normalizeRoleLabel(role) {
  const r = String(role || "").trim().toLowerCase();
  if (r === "teacher") return "teacher";
  if (r === "student") return "student";
  return "signup";
}

async function sendSignupLog({ name, email, userId, role, createdAt }) {
  if (!SIGNUP_LOG_CHANNEL_ID) throw new Error("Missing env: SIGNUP_LOG_CHANNEL_ID");

  const channel = await client.channels.fetch(SIGNUP_LOG_CHANNEL_ID);
  if (!channel || !channel.isTextBased()) {
    throw new Error("SIGNUP_LOG_CHANNEL_ID is not a text channel");
  }

  const roleLabel = normalizeRoleLabel(role);
  const prefix = roleLabel === "signup" ? "New signup" : `New ${roleLabel} signup`;
  const parts = [
    `${prefix}: ${name || "(no name)"} <${email || "no-email"}>`,
    userId ? `id: ${userId}` : null,
    createdAt ? `createdAt: ${createdAt}` : null,
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
        role: String(body?.role || "").trim(),
        createdAt: String(body?.createdAt || "").trim(),
      });

      console.log(
        `[signup-log] Posted signup for ${String(body?.email || "").trim() || "(no email)"}`
      );

      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    } catch (err) {
      console.error(`[signup-log] Error: ${err.message || err}`);
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: err.message || "Bad request" }));
    }
  });

  server.listen(LOG_SERVER_PORT, () => {
    console.log(
      `Log server listening on http://localhost:${LOG_SERVER_PORT} (signup channel set: ${Boolean(
        SIGNUP_LOG_CHANNEL_ID
      )})`
    );
  });

  server.on("error", (err) => {
    console.error(
      err && err.code === "EADDRINUSE"
        ? `Log server port ${LOG_SERVER_PORT} is already in use. Change BOT_PORT in bot/.env.`
        : `[log-server] Error: ${err.message || err}`
    );
  });
}

startLogServer();

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (
    interaction.commandName !== "announce" &&
    interaction.commandName !== "clear-announcements" &&
    interaction.commandName !== "delete-user" &&
    interaction.commandName !== "rename-user" &&
    interaction.commandName !== "reset-password"
  ) {
    return;
  }

  const cooldownKey = `${interaction.user?.id || "unknown"}:${interaction.commandName}`;
  const cooldown = commandCooldown(cooldownKey);
  if (!cooldown.allowed) {
    const seconds = Math.ceil(cooldown.retryAfterMs / 1000);
    await interaction.reply({
      content: `Rate limited. Try again in ${seconds}s.`,
      ephemeral: true,
    });
    return;
  }

  if (!canUse(interaction)) {
    await interaction.reply({
      content: "You don't have permission to use this command.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.commandName === "delete-user") {
    const confirm = Boolean(interaction.options.getBoolean("confirm"));
    const email = String(interaction.options.getString("email") || "").trim();

    if (!confirm) {
      await interaction.reply({
        content: "Not deleted. Set `confirm: true` to proceed.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const deleted = await deleteUserByEmail(email);
      await interaction.editReply(
        deleted
          ? `Deleted user: ${deleted.email} (${deleted.name || "no name"})`
          : "Deleted."
      );
    } catch (err) {
      await interaction.editReply(`Failed to delete: ${err.message}`);
    }
    return;
  }

  if (interaction.commandName === "rename-user") {
    const email = String(interaction.options.getString("email") || "").trim();
    const first = String(interaction.options.getString("first") || "").trim();
    const last = String(interaction.options.getString("last") || "").trim();

    if (!first && !last) {
      await interaction.reply({
        content: "Provide `first` and/or `last`.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const user = await updateUserName({ email, firstName: first, lastName: last });
      await interaction.editReply(
        user
          ? `Updated name to "${user.name}" for ${user.email}.`
          : "Updated."
      );
    } catch (err) {
      await interaction.editReply(`Failed to update name: ${err.message}`);
    }
    return;
  }

  if (interaction.commandName === "reset-password") {
    const email = String(interaction.options.getString("email") || "").trim();
    const newPassword = String(interaction.options.getString("new_password") || "");

    if (!email) {
      await interaction.reply({
        content: "Provide `email`.",
        ephemeral: true,
      });
      return;
    }
    if (!newPassword || newPassword.length < 8) {
      await interaction.reply({
        content: "Provide `new_password` with at least 8 characters.",
        ephemeral: true,
      });
      return;
    }

    await interaction.deferReply({ ephemeral: true });
    try {
      const user = await resetUserPassword({ email, newPassword });
      await interaction.editReply(
        user
          ? `Password reset for ${user.email} (${user.name || "no name"}).`
          : `Password reset for ${email}.`
      );
    } catch (err) {
      await interaction.editReply(`Failed to reset password: ${err.message}`);
    }
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
