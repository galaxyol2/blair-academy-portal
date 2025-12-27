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
