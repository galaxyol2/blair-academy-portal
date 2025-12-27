# Backend

Node/Express API for auth + portal services.

## Setup

1) Install dependencies:

`cd backend`
`npm install`

2) Create env:

Copy `backend/.env.example` to `backend/.env` and set `JWT_SECRET`.

3) Run:

`npm run dev`

API will be on `http://localhost:3001`.

## Endpoints (used by frontend)

- `POST /api/auth/signup` → `{ token, user }`
- `POST /api/auth/login` → `{ token, user }`
- `POST /api/auth/forgot-password` → `{ ok: true }`
- `POST /api/auth/reset-password` → `{ ok: true }`
- `GET /api/health` → `{ ok: true }`

## Notes

- User data is stored in a local JSON file (`backend/data/dev.json` by default) and is ignored by git.
- For production email sending, set either SMTP env vars or `SENDGRID_API_KEY` (preferred if SMTP ports are blocked).
