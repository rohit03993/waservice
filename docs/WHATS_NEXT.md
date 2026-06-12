# What’s done vs what’s next

## Already working (MVP)

| Area | Status |
|------|--------|
| Auth (register / login / admin role) | Done |
| Contacts, tags, filters | Done |
| WhatsApp connections (encrypted tokens) | Done |
| Template sync + create (Meta) + test send | Done |
| Campaigns (contacts, CSV, API trigger) | Done |
| Inbox + replies (webhook-driven) | Done |
| Worker queue + retries | Done |
| Integration API (`X-Integration-Key`) | Done |
| Optional forward webhooks to other CRM | Done |
| Docker: DB, Redis, API, worker, frontend | Done |
| Auto DB migrations on backend start | Done |

## Do these on your machine / live server (ops)

1. `docker compose up --build` (one terminal).
2. Register at `http://localhost:3010` (no default login).
3. **WhatsApp Settings** → save Meta credentials.
4. **Templates** → sync from Meta.
5. Test send → your phone.
6. (Live) Meta webhook URL → your public API; app secret set.
7. (Other CRM) **Integrations** → API key → see [EXTERNAL_CRM_INTEGRATION_SAFE.md](./EXTERNAL_CRM_INTEGRATION_SAFE.md).

## Recommended next product work (priority)

| Priority | Item | Why |
|----------|------|-----|
| P1 | Production deploy (HTTPS, `DEBUG=false`, backups) | Real customers |
| P1 | Meta token expiry monitoring / admin alert | Avoid silent send failures |
| P2 | Password reset (email) | Support users who forget login |
| P2 | Per-tenant outbound webhook URL (UI, not only `.env`) | Easier multi-tenant SaaS |
| P2 | Integration API OpenAPI examples in `/docs` | Faster partner onboarding |
| P3 | Chatbot / flow builder | Out of MVP scope in `PLAN.md` |
| P3 | Multi-agent live chat | Out of MVP scope |
| P3 | Embedded Meta signup (OAuth) | Self-serve onboarding |

## Production checklist (short)

- [ ] `DEBUG=false`, strong `JWT_SECRET_KEY`, stable `ENCRYPTION_KEY`
- [ ] `ALLOW_OPEN_REGISTRATION=false` if invite-only
- [ ] `CORS_ORIGINS` = real dashboard URL
- [ ] Meta webhook + verify token + app secret
- [ ] Worker container running
- [ ] Postgres backups
- [ ] Do not expose ports 5432/6379 publicly

---

*Update this file when you close a phase or ship a feature.*
