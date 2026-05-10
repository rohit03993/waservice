# WhatsApp SaaS (MVP)

Implementation is tracked in `PLAN.md`.

## Current status

- Phase 0/1 bootstrap started
- Backend scaffold with auth + tenant bootstrap routes
- Docker compose with Postgres + Redis + backend
- Frontend Next.js skeleton added

## Run locally

1. Create `.env` from `.env.example`
2. Start backend stack:
   - `docker compose up --build`
3. API docs:
   - `http://localhost:8010/docs`
4. Start frontend (separate terminal):
   - `npm run install:frontend`
   - `npm run dev`
   - Open `http://localhost:3010`

## First API routes

- `GET /api/v1/health`
- `POST /api/v1/auth/register`
- `POST /api/v1/auth/login`
- `GET /api/v1/auth/me` (Bearer token)
