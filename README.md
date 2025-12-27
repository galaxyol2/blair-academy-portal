# Blair Academy Portal

Static portal frontend (Vercel) + Node/Express backend (Railway) with Postgres.

## Discord announcements bot

This repo includes a Discord bot in `bot/` that can post announcements to the website.

**Backend (Railway)**
- Set `ADMIN_API_KEY` (a long random secret) in your Railway backend variables.

**Bot**
- Copy `bot/.env.example` → `bot/.env`
- Fill in:
  - `DISCORD_BOT_TOKEN`
  - `DISCORD_APPLICATION_ID`
  - `DISCORD_GUILD_ID`
  - `ANNOUNCE_API_URL` (your Railway URL + `/api/admin/announcements`)
  - `ADMIN_API_KEY` (same value as Railway)
- Install + register commands:
  - `cd bot`
  - `npm install`
  - `npm run register`
- Run the bot:
  - `npm start`

In Discord, use `/announce` with a title + message. The portal will pull announcements from `GET /api/announcements`.

To clear announcements, use `/clear-announcements confirm:true`.

## Discord signup logs (via bot)

To log new signups in a Discord channel:

**Bot**
- Set `SIGNUP_LOG_CHANNEL_ID` in `bot/.env` (the channel to post into).
- Deploy/run the bot somewhere reachable by your backend (Railway works).

**Backend**
- Set `SIGNUP_LOG_URL` to your bot endpoint: `https://<bot-host>/internal/log-signup`
- Set `SIGNUP_LOG_KEY` to the same value as the bot `ADMIN_API_KEY` (header: `x-admin-key`).
