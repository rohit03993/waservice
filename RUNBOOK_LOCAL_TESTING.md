# CRM Local Testing Runbook (Admin Controlled)

This runbook explains what is already working in this CRM, what you need from Meta/WhatsApp, and how to test end-to-end on local.

## 1) What works right now

- Admin auth (register/login) with tenant setup.
- Contacts CRM (create/list/update/delete, tags, filtering).
- WhatsApp connection management from admin settings UI.
- Template sync from Meta (when WABA and token are correct).
- Template test send from UI.
- Campaign create/start + worker queue and retries.
- Inbox conversation list and message thread (webhook-driven).
- Reply from inbox to a selected conversation.
- Admin audit logs endpoint for important control actions.

## 2) What this means for your question

- Yes, you can send messages from this CRM now:
  - Template test send from Settings.
  - Campaign sends to selected contacts.
  - Inbox reply to existing conversation.
- Yes, you can see messages in this CRM now:
  - Inbound and status updates appear via webhook processing.
- Admin controls the important actions now:
  - WhatsApp connection settings are admin-only.
  - Campaign creation/start and CSV import are admin-only.

## 3) What you must provide from Meta/WhatsApp

Keep these ready:

- Meta App:
  - App ID
  - App Secret
- WhatsApp:
  - WABA ID
  - Phone Number ID
  - Access token (long-lived/system user preferred)
- Webhook values:
  - Verify token (your own secret string)
  - Callback URL (public URL to your local backend webhook path)
- Template:
  - At least one approved template name and language.
- Test recipient:
  - Valid E.164 phone number for testing.

## 4) Local prerequisites

- Docker Desktop running.
- Ports free: 3010 (frontend), 8010 (backend), 5432 (postgres), 6379 (redis).
- `.env` created from `.env.example`.
- Add `ENCRYPTION_KEY` in `.env` (for encrypted WhatsApp secrets at rest).

## 5) Start local stack

From project root:

1. `docker compose up --build`
2. In second terminal:
   - `npm run install:frontend`
   - `npm run dev`

Open:

- Frontend: `http://localhost:3010`
- API docs: `http://localhost:8010/docs`

## 6) Why public tunnel is required for webhook testing

Meta cannot call `localhost` directly.
For inbound message visibility and delivery/read statuses, expose your local backend with a public tunnel.

Expected callback path in Meta:

- `https://<your-public-url>/api/v1/webhook/whatsapp`

Without this tunnel:

- Outbound sends can still work.
- Inbound/status updates will not arrive in your local DB/UI.

## 7) End-to-end admin test flow

1. Register admin user in UI.
2. Open `WhatsApp Settings`:
   - Fill label, phone number id, waba id, access token, verify token, app secret.
   - Save connection.
3. Open `Templates`:
   - Sync from Meta.
4. Open `Settings`:
   - Send template test to your test number.
5. Open `Contacts`:
   - Create a few contacts.
6. Open `Campaigns`:
   - Create campaign + choose contacts.
   - Start campaign.
7. Open `Inbox`:
   - Verify conversations/messages once webhooks are configured.
   - Send reply from thread.

## 8) Common local issues

- 401/403 from Meta: invalid token, missing permissions, or wrong phone number id.
- Template send fail: template not approved or language mismatch.
- No inbound/status updates: webhook URL not public/reachable or signature mismatch.
- Empty templates list: wrong `waba_id` or token missing template permissions.
- Worker not sending: worker container not running or redis unavailable.

## 9) Security baseline already applied

- WhatsApp access token and app secret are stored encrypted (when `ENCRYPTION_KEY` is set).
- Webhook signature verification checks `X-Hub-Signature-256` when app secret is configured.
- JWT auth + role gates are in place for admin-controlled actions.

## 10) Next upgrades before production

- Add API rate limits (auth + tenant endpoints).
- Enforce stricter WhatsApp policy checks (template/session rules).
- Add integration tests for auth, webhooks, campaigns, retries.

## 11) Admin audit log API

Use this route with admin bearer token:

- `GET /api/v1/admin/audit-logs?limit=100`

Returns recent admin actions like:

- WhatsApp connection upsert/delete
- Template sync and test sends
- Campaign create/start/import
