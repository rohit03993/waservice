# WhatsApp Authentication Template Fix — Code Change Summary

**Date:** 2026-06-16  
**Context:** MMHC CRM OTP via Pal Digital (`wa.paldigital.in`)  
**Symptom:** Meta error **#131008** — *"Template parameter mismatch. Required parameter is missing"* when sending Authentication templates such as `mmhc_verification_code2` / `mmhc_verification_code3` (Copy code).

---

## Why this change was made

### Problem

Meta **Authentication** templates with **Copy code** delivery require **two** parameters when sending via Cloud API:

| Component | What Meta expects |
|-----------|-------------------|
| **Body** | `{{1}}` = the OTP (e.g. `123456`) |
| **Button** (copy code, index `0`) | **Same OTP** again |

Before this fix, `waservice` only built a **body** component:

```python
[{"type": "body", "parameters": [{"type": "text", "text": "123456"}]}]
```

It never sent the **button** component. Meta rejected the message with **#131008**.

This affected:

- **Inbox** → Send template (only one variable field `{{1}}` in UI)
- **API campaigns** → `POST /api/v1/integrations/campaigns/{id}/trigger` (returns `queued: true`, then fails at Meta)
- **Integration** → `POST /api/v1/integrations/whatsapp/send-template`

External CRMs (e.g. MMHC Laravel) sending `button_parameters` in JSON had **no effect** — that field was not in the Pal API schema and was ignored.

### Root cause location

`template_body_parameters_to_meta_components()` in `backend/app/schemas/whatsapp.py` only mapped `body_parameters` → Meta `body` component. No authentication-button logic existed anywhere in the send path.

---

## What was changed

### 1. New file (core logic)

**`backend/app/services/template_meta_components.py`** *(NEW)*

| Function | Purpose |
|----------|---------|
| `authentication_template_needs_copy_code_button()` | Returns `true` if template `category == AUTHENTICATION`, or stored Meta components include OTP/COPY_CODE/ONE_TAP/ZERO_TAP buttons |
| `build_copy_code_button_component(otp_text)` | Builds Meta button payload: `type: button`, `sub_type: url`, `index: 0`, `parameters: [{type: text, text: otp}]` |
| `build_meta_template_components(...)` | Wraps existing body builder + appends copy-code button when needed; OTP text = first `body_parameters[0].text` (or optional `button_otp_text`) |

**Behaviour:**

- **UTILITY / MARKETING** templates → unchanged (body only, same as before)
- **AUTHENTICATION** templates → body + button with same OTP
- If template row is missing from DB → falls back to body-only (same as old behaviour)

---

### 2. Modified files

#### `backend/app/workers/worker.py`

**Before:** `components = template_body_parameters_to_meta_components(body_parameters)`

**After:** `components = build_meta_template_components(body_parameters, category=tmpl_row.category, components_wrapped=tmpl_row.components)`

**Why:** Campaign worker (broadcast + **API campaign** queue) is what actually calls Meta after `trigger` returns `queued: true`. This is the main fix for external CRM OTP triggers.

---

#### `backend/app/api/v1/whatsapp.py`

**Endpoint:** `POST /whatsapp/send-template-test` (used by Inbox “Send template” and settings test send)

**Before:** `comps = template_body_parameters_to_meta_components(payload.body_parameters)`

**After:**

1. Load `MessageTemplate` row by `template_name` + `language_code` for the tenant
2. `comps = build_meta_template_components(payload.body_parameters, category=..., components_wrapped=...)`

**Why:** Inbox manual template send was failing with #131008 for the same reason.

**Note:** Removed unused import of `template_body_parameters_to_meta_components` from this file (logic now in `template_meta_components.py`).

---

#### `backend/app/api/v1/integrations.py`

**Endpoint:** `POST /integrations/whatsapp/send-template`

**Before:** `comps = template_body_parameters_to_meta_components(payload.body_parameters)`

**After:** Same pattern as `whatsapp.py` — load template row, then `build_meta_template_components(...)`.

**Why:** Direct integration template send (without campaign queue) must also include the auth button.

**Not changed:** `POST /integrations/campaigns/{campaign_id}/trigger` — still accepts only `body_parameters`; worker applies the fix when processing the job.

---

## Files NOT changed

| Area | Notes |
|------|--------|
| `backend/app/schemas/whatsapp.py` | `template_body_parameters_to_meta_components()` kept as-is; still used internally |
| `backend/app/schemas/integrations.py` | No new `button_parameters` field on API (button OTP auto-derived from body) |
| Frontend `AppClient.tsx` | No UI change; one variable `{{1}}` is still enough |
| Database / migrations | None |
| Meta template sync | None |

---

## Expected Meta payload after fix

For Authentication template `mmhc_verification_code3` with OTP `123456`:

```json
{
  "template": {
    "name": "mmhc_verification_code3",
    "language": { "code": "en_US" },
    "components": [
      {
        "type": "body",
        "parameters": [{ "type": "text", "text": "123456" }]
      },
      {
        "type": "button",
        "sub_type": "url",
        "index": "0",
        "parameters": [{ "type": "text", "text": "123456" }]
      }
    ]
  }
}
```

---

## Deployment checklist

1. Deploy updated backend code to `wa.paldigital.in`
2. **Restart API process** (FastAPI / uvicorn)
3. **Restart campaign worker** (`worker.py` — processes queued API campaign sends)
4. Ensure templates are **synced from Meta** (`POST /whatsapp/templates/sync`) so `category` and `components` are in DB
5. Test:
   - Inbox → send `mmhc_verification_code3` with `{{1}}` = 6-digit code
   - curl → `POST /integrations/campaigns/{id}/trigger` with `body_parameters` only
   - MMHC CRM phone login OTP

---

## Regression / review points for the reviewing agent

### Should still work (no behaviour change)

- **Marketing / Utility templates** (e.g. `test1`) — category is not `AUTHENTICATION`; no button component added
- Templates with **no body variables** — no button added (no OTP text available)
- **Broadcast campaigns** using non-auth templates — unchanged
- **Session text messages** — untouched

### Possible edge cases to verify

| Scenario | Risk | Suggestion |
|----------|------|------------|
| AUTHENTICATION template with **zero-tap / one-tap** (not copy code) | We always send `sub_type: url` copy-code button | Confirm with Meta docs if one-tap templates need different `sub_type` / `otp` parameter shape |
| Template row **missing** in DB (not synced) | Falls back to body-only → #131008 may persist | Ensure sync runs after new template approval |
| AUTHENTICATION template with **multiple body variables** | Button uses **first** body parameter text only | OK for OTP templates (single `{{1}}`); verify if multi-var auth templates exist |
| Duplicate button if caller already passed full components | N/A — callers still only pass `body_parameters`; we build components centrally | Low risk |

### Suggested tests

1. Send **Marketing** template `test1` — must still deliver (no regression)
2. Send **Authentication** `mmhc_verification_code3` from Inbox — must deliver, no #131008
3. Trigger **API campaign** for auth template — recipient state should become `sent`, not `failed`
4. Check campaign worker logs after deploy — confirm worker restarted with new code

---

## Related external system (MMHC CRM)

Laravel app at `mmhc-crm` uses `PalDigitalWhatsAppService` → same Pal trigger API. No waservice changes required on Laravel side after this fix. Laravel may send `button_parameters` in JSON; Pal ignores extra fields — button is now built server-side from `body_parameters[0]`.

---

## Summary for handoff

| Item | Detail |
|------|--------|
| **Bug** | Auth Copy-code templates missing Meta button component → #131008 |
| **Fix** | New `template_meta_components.py`; three call sites use `build_meta_template_components()` |
| **Scope** | Backend only; 1 new file, 3 modified files |
| **Breaking change** | None intended for non-Authentication templates |
| **Critical deploy step** | Restart **worker** + API |

---

*Document prepared for agent/developer review. Questions: compare `git diff` against `backend/app/services/template_meta_components.py`, `worker.py`, `api/v1/whatsapp.py`, `api/v1/integrations.py`.*
