# Safe live integration: other CRM → waservice (Wapaldigital / Meta Cloud API)

This guide explains how to let **another CRM** send WhatsApp messages through **this app** (like AiSensy did in the middle), **without breaking** your **already live** Wapaldigital CRM.

---

## 1. What you are building

```text
Other CRM (live)  ──HTTPS + API key──►  waservice API  ──Meta Cloud API──►  Customer WhatsApp
                                              ▲
Meta webhooks (inbound/status) ───────────────┘  (only ONE URL per Meta app)
```

| Piece | Already in this repo? |
|--------|----------------------|
| Send template from external app | Yes — `POST /api/v1/integrations/whatsapp/send-template` |
| Send session text (24h window) | Yes — `POST /api/v1/integrations/whatsapp/send-text` |
| AiSensy-style trigger | Yes — `POST /api/v1/integrations/campaigns/{id}/trigger` |
| Create integration API key | Yes — admin UI **Integrations** or `POST /api/v1/admin/integration-keys` |
| Meta webhook (inbound to waservice) | Yes — `GET/POST /api/v1/webhook/whatsapp` |
| Forward webhooks to other CRM | **Yes (optional)** — set `EXTERNAL_CRM_WEBHOOK_URL` on API server; test from **Integrations** tab |

**Template approval** is always **Meta’s** process. External CRM should only **send** templates that are already **APPROVED** in Meta (and synced in waservice).

---

## 2. Golden rule (do not break live)

### One WhatsApp phone number = one Meta webhook URL

Meta sends inbound messages and delivery status to **one callback URL** per app configuration.

| Situation | Safe approach |
|-----------|----------------|
| **Live Wapaldigital already runs this same codebase** on `https://api.yourdomain.com` | Do **not** change Meta webhook. Only add **integration API keys** and test **send** endpoints. Lowest risk. |
| **New waservice server** + **same** Meta app / **same** phone as live CRM | **Dangerous** if you change webhook URL in Meta Console — live inbox can stop updating. Plan a **maintenance window** or use a **test phone number** first. |
| **Pilot without touching live** | Use a **second phone number** (or second WABA) in Meta, connect only to waservice staging, leave live webhook unchanged. **Recommended for first test.** |

You **cannot** have two different backends receiving Meta webhooks for the **same** phone at the same time.

---

## 3. Recommended rollout (phased)

### Phase A — Send-only (safest; no Meta webhook change)

**Goal:** Other CRM sends messages; live Wapaldigital keeps handling inbox/webhooks as today.

Requirements:

- Live stack already has correct **Phone Number ID**, **WABA**, **token** in WhatsApp Settings.
- Other CRM calls **integration API** only (outbound).

Steps:

1. On **production** waservice (your live URL), log in as **admin**.
2. **Integrations** → create API key → store `wsk.<id>.<secret>` in the other CRM (secrets manager, not chat).
3. In other CRM, configure:
   - Base URL: `https://<your-live-api-host>/api/v1`
   - Header: `X-Integration-Key: wsk....`
4. Send a **test template** to your own phone:

   ```http
   POST /integrations/whatsapp/send-template
   Content-Type: application/json
   X-Integration-Key: wsk.<uuid>.<secret>

   {
     "to_phone_e164": "+91XXXXXXXXXX",
     "template_name": "your_approved_template",
     "language_code": "en_US",
     "body_parameters": [{ "type": "text", "text": "Test" }]
   }
   ```

5. Confirm message on WhatsApp and check **audit logs** in waservice (`GET /api/v1/admin/audit-logs`).

**Does not change:** Meta webhook URL, live inbox, existing campaigns, existing users.

---

### Phase B — API campaign (still outbound-only)

1. In waservice UI: create campaign type **API campaign** → choose approved template → **Go Live**.
2. Other CRM calls:

   ```http
   POST /integrations/campaigns/{campaign_id}/trigger
   X-Integration-Key: wsk....

   {
     "to_phone_e164": "+91XXXXXXXXXX",
     "name": "Optional Name",
     "body_parameters": [{ "type": "text", "text": "Value" }]
   }
   ```

3. Ensure **worker** container is running on production.

Still **no** Meta webhook change.

---

### Phase C — Staging with HTTPS (before any live webhook move)

1. Deploy a **staging** copy (separate subdomain, separate DB, separate `.env`).
2. Use **test WABA / test phone** in Meta (not the live production number).
3. Set Meta webhook to staging:

   `https://api-staging.yourdomain.com/api/v1/webhook/whatsapp`

4. Verify token = value in staging **WhatsApp Settings**.
5. Set **app secret** for signature verification.
6. Test inbound reply in waservice **Inbox**.

Only after staging is stable, plan production webhook (if you are migrating CRM servers).

---

### Phase D — Production webhooks (only if migrating backend)

Do this in a **planned window**:

1. Announce short maintenance (inbound may duplicate or gap if misconfigured).
2. Confirm `DEBUG=false`, strong `JWT_SECRET_KEY`, `ENCRYPTION_KEY` stable.
3. Update Meta callback to production API URL (if it changed).
4. Subscribe webhook fields: `messages`, `message_template_status_update` (as needed).
5. Send test inbound message → appears in **Inbox**.
6. Roll back Meta URL immediately if live traffic fails.

---

## 4. Production checklist (live mode)

| Item | Action |
|------|--------|
| `DEBUG` | `false` |
| `JWT_SECRET_KEY` | 32+ random chars |
| `ENCRYPTION_KEY` | Stable; do not rotate without plan |
| `CORS_ORIGINS` | Only your real dashboard origins |
| `ALLOW_OPEN_REGISTRATION` | `false` if you do not want public signup |
| TLS | `https://api...` and `https://app...` |
| Integration keys | One key per external system; **revoke** old keys |
| Rate limits | Already per key + IP on integration routes |
| Worker | Must run for API campaigns |
| Migrations | `docker compose exec backend alembic upgrade head` after deploy |

---

## 5. Other CRM configuration (copy-paste template)

Give your CRM team:

| Setting | Value |
|---------|--------|
| Method | `POST` |
| Base URL | `https://<API_HOST>/api/v1` |
| Auth header | `X-Integration-Key` |
| Auth value | `wsk.<uuid>.<secret>` |
| Send template path | `/integrations/whatsapp/send-template` |
| Send text path | `/integrations/whatsapp/send-text` |
| Trigger campaign path | `/integrations/campaigns/{campaign_id}/trigger` |
| Phone format | E.164 e.g. `+919876543210` |
| Template name | Exact Meta name (lowercase, underscores) after sync |

**Idempotency:** If the other CRM retries POSTs, you may send duplicate WhatsApp messages unless **they** dedupe (e.g. by order id). Consider adding your own idempotency key in a future release.

---

## 6. What stays isolated (won’t “break” live data)

| Isolated by | Effect |
|-------------|--------|
| **Tenant** | Each workspace has its own contacts, campaigns, connections. |
| **Integration API key** | Tied to one tenant; cannot access another tenant’s data. |
| **Audit logs** | Every integration send is logged. |
| **Admin vs integration auth** | External CRM cannot create users or change WhatsApp tokens without admin JWT. |

Integration sends use the tenant’s **default WhatsApp connection** (same as live UI sends).

---

## 7. Risks to avoid

| Mistake | Impact |
|---------|--------|
| Change Meta webhook URL without planning | Live inbox stops updating |
| Share integration key in email/chat | Anyone can send on your number |
| Send non-approved template names | Meta API errors; no message |
| `send-text` outside 24h window | Meta rejects (use template instead) |
| No worker on production | API campaign triggers queue but do not send |
| Point other CRM at `localhost` | Will not work from their server |

---

## 8. Webhooks **to** other CRM (optional)

On the **API server** `.env` (then restart backend):

```env
EXTERNAL_CRM_WEBHOOK_URL=https://your-other-crm.com/webhooks/waservice
EXTERNAL_CRM_WEBHOOK_SECRET=long-random-string
```

After each Meta webhook is processed, waservice POSTs (in the background):

```json
{
  "source": "waservice",
  "event_type": "meta.whatsapp.webhook",
  "received_at": "2026-06-03T12:00:00+00:00",
  "phone_number_ids": ["..."],
  "payload": { }
}
```

(`payload` is the original Meta body.)

Verify signature on the other CRM (optional):

- Header: `X-Waservice-Signature: sha256=<hex>`
- HMAC-SHA256 of raw body with `EXTERNAL_CRM_WEBHOOK_SECRET`

Test from dashboard: **Integrations** → **Send test event**, or:

`POST /api/v1/admin/external-crm-webhook/test` (admin JWT).

**Meta callback URL is unchanged** — live inbox in waservice still works; this only **copies** events outbound.

---

## 9. Quick test commands (production)

Replace host and key:

```bash
curl -sS -X POST "https://API_HOST/api/v1/integrations/whatsapp/send-template" \
  -H "Content-Type: application/json" \
  -H "X-Integration-Key: wsk.UUID.SECRET" \
  -d '{"to_phone_e164":"+91XXXXXXXXXX","template_name":"hello_world","language_code":"en_US"}'
```

Health check (no auth):

```bash
curl -sS "https://API_HOST/api/v1/health"
```

---

## 10. Decision tree

```text
Is live Wapaldigital already THIS waservice API on production?
├─ YES → Phase A only (integration key + send API). Do not touch Meta webhook.
└─ NO  → Is other CRM only sending outbound?
         ├─ YES → Phase A on production (same Meta token/phone in waservice settings).
         └─ NO (needs inbound in waservice too) → Phase C staging phone first,
              then Phase D migration with maintenance window.
```

---

## 11. Do this now (live rollout checklist)

| Step | Action |
|------|--------|
| 1 | **Do not** change Meta webhook URL if live Wapaldigital inbox works |
| 2 | Production `.env`: `DEBUG=false`, strong secrets |
| 3 | **Integrations** → **Create key** → give `wsk...` to other CRM |
| 4 | Other CRM: `POST .../integrations/whatsapp/send-template` with `X-Integration-Key` |
| 5 | Test one message to your phone |
| 6 | (Optional) Set `EXTERNAL_CRM_WEBHOOK_URL` on server → restart API → **Send test event** in UI |
| 7 | (Optional) API campaign: create **API campaign** → Go Live → `POST .../trigger` |

---

*Aligned with `backend/app/api/v1/integrations.py`, `external_crm_webhook.py`, `RUNBOOK_LOCAL_TESTING.md`, and Meta Cloud API constraints.*
