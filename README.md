# WhatsApp SaaS (MVP)

WhatsApp CRM on **Meta Cloud API** (direct; no AiSensy BSP). Comparable to WATI/AiSensy-style sends, with your own backend and optional **external CRM** integration.

Implementation history: `PLAN.md`. Roadmap: **[docs/WHATS_NEXT.md](docs/WHATS_NEXT.md)**.

## Current status

- Auth, tenants, contacts, tags, campaigns (CSV + API), inbox, templates
- WhatsApp settings, webhooks, worker queue, audit logs
- **Integrations** tab: API keys + optional outbound webhooks to other CRMs
- **Docker Compose**: Postgres, Redis, API, worker, frontend (port 3010)
- **Migrations run automatically** when the backend container starts

## Run locally (one terminal)

1. Copy `.env` from `.env.example` — set `ENCRYPTION_KEY` and `JWT_SECRET_KEY`.
2. Start everything:

   ```bash
   docker compose up --build
   ```

3. Open **http://localhost:3010** → **Register** (there is no default login).
4. Follow the **Get started** banner → **WhatsApp Settings**.
5. API docs: **http://localhost:8010/docs**

Migrations run on backend startup. Optional: `docker compose exec backend alembic current`.

## Login

- **No preset username/password.** Use the email + password you chose at registration.
- Minimum password length: **8 characters**.

## External CRM (live, safe)

**[docs/EXTERNAL_CRM_INTEGRATION_SAFE.md](docs/EXTERNAL_CRM_INTEGRATION_SAFE.md)** — send from another app via `X-Integration-Key` without breaking live Meta webhooks.

## Key API routes

| Route | Purpose |
|-------|---------|
| `GET /api/v1/health` | Health + DB check |
| `POST /api/v1/auth/register` | First-time signup |
| `POST /api/v1/auth/login` | Login |
| `POST /api/v1/integrations/whatsapp/send-template` | External CRM send |
| `GET/POST /api/v1/webhook/whatsapp` | Meta webhooks |

## Docs

- [Local & VPS](docs/LOCAL_AND_VPS.md)
- [Local testing runbook](RUNBOOK_LOCAL_TESTING.md)
- [Security](docs/SECURITY.md)
