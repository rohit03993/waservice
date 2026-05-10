# Security checklist and review

This document complements [LOCAL_AND_VPS.md](./LOCAL_AND_VPS.md). It is a **code-aligned security review** of this repository—not a substitute for a professional penetration test or threat model workshop.

---

## 1. Environment variables (production)

| Variable | Purpose |
|----------|---------|
| `DEBUG` | Set to `false`. Weak JWT secrets fail startup; clients never receive stack traces for unhandled errors. |
| `JWT_SECRET_KEY` | At least 32 characters; not a placeholder. Required when `DEBUG=false`. |
| `JWT_ISSUER` | Optional. If set, new access tokens include `iss`; tokens with a different `iss` are rejected. |
| `ENCRYPTION_KEY` | Fernet key for stored secrets (e.g. WhatsApp tokens). Stable across deploys unless you re-encrypt. |
| `ALLOW_OPEN_REGISTRATION` | Set `false` if you do not want public tenant signup. |
| `CORS_ORIGINS` | Comma-separated **exact** browser origins (e.g. `https://wa.example.com`). Empty in production logs a warning and blocks cross-origin browser calls. |
| `TRUSTED_HOSTS` | Comma-separated `Host` values the API accepts. Reduces Host-header abuse behind a reverse proxy. |
| `HSTS_MAX_AGE_SECONDS` | If set to a positive number, sends `Strict-Transport-Security`. Use only when the API is **always** served over HTTPS. |
| `RATE_LIMIT_USE_REDIS` | `true` in production to share rate limits across API worker processes (uses `REDIS_URL`). Falls back to in-process limits if Redis is unreachable. |
| `EXPOSE_API_DOCS` | Default `false`. When `DEBUG=false`, `/docs`, `/redoc`, and `/openapi.json` stay **disabled** unless this is `true` (use only on a trusted network). |

Never commit a real `.env`. See root `.env.example` for all variables.

---

## 2. HTTP hardening (built in)

- **CORS**: Restricted methods and headers (not `*`).
- **Headers**: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`; optional HSTS; `Cache-Control: no-store` on API and webhook paths.
- **Errors**: Unhandled exceptions are **logged server-side** with full trace. Clients always get a **generic** JSON body; in `DEBUG=true` only an `error_type` field (exception class name) is added—**not** the raw exception message, to reduce accidental leakage.
- **OpenAPI / Swagger**: Disabled in production by default (see `EXPOSE_API_DOCS`).

---

## 3. Authentication and tenancy

- Dashboard APIs use **Bearer JWT** with **HS256**, **mandatory `exp` and `sub`** on every accepted token.
- **Login** uses the same password-verification path whether the email exists (Argon2 cost similar), reducing basic **user-enumeration via timing** on password check alone. Always return **“Invalid credentials”** for wrong email/password.
- **Passwords**: Argon2; minimum length enforced in schemas (register/login).
- **Tenant isolation**: CRM, campaigns, WhatsApp, admin, and media routes scope queries by **`membership.tenant_id`** (review any new route the same way).
- **Roles**: `admin` vs `agent` via dependencies; integration keys are **admin-only** to create.
- **Integration API**: `X-Integration-Key` (`wsk.<id>.<secret>`); secret stored as **Argon2 hash**; verify uses constant-time compare from passlib.

---

## 4. Webhooks (WhatsApp)

- **GET** verification: `hub.verify_token` compared with **`secrets.compare_digest`** against stored verify tokens.
- **POST**: **`X-Hub-Signature-256`** validated with **HMAC-SHA256** and **`hmac.compare_digest`** against configured app secrets; rejects if no secret is configured for the phone number ID.
- **Rate limited** per IP.

---

## 5. File uploads

- **Inbox reply media**: size caps, allowlisted MIME types, **magic-byte** checks (reduces spoofed `Content-Type`).
- **Campaign CSV import**: **6 MB** max file size to limit memory abuse.
- **Filenames**: sanitized / ASCII-safe where response headers require latin-1.

---

## 6. Data and injection

- **SQL**: SQLAlchemy ORM with bound parameters; no string-concatenated SQL observed in app code.
- **Stored secrets**: WhatsApp tokens and similar use **Fernet** (`enc::` prefix) when `ENCRYPTION_KEY` is set; legacy plaintext reads still supported for migration—re-save connections to encrypt.
- **XSS (dashboard)**: Inbox rich text uses **React children** (escaped)—no `dangerouslySetInnerHTML` in the CRM client for message bodies.

---

## 7. Frontend token storage (known trade-off)

- The SPA stores the JWT in **`localStorage`** (`auth_token`). Any **XSS** in the origin could exfiltrate it. Mitigations: strict CSP on the Next.js app (configure at the reverse proxy or `next.config`), dependency hygiene, and avoiding `eval` / unsafe HTML.
- **Stronger pattern** (future): **httpOnly**, **Secure**, **SameSite** cookies + CSRF strategy for same-site or double-submit cookie—requires API and proxy changes.

---

## 8. Residual risks and hardening backlog

| Area | Notes |
|------|--------|
| **Brute force** | Login/register are rate-limited per IP; no account lockout or CAPTCHA—consider for public internet. |
| **JWT lifetime** | Long-lived access tokens only; no refresh rotation—shorten `JWT_ACCESS_TOKEN_EXPIRE_MINUTES` in production if needed. |
| **Inactive user** | Correct password + inactive account returns **403** (distinct from wrong password)—minor enumeration channel; acceptable for many B2B setups. |
| **Rate limits** | In-process limits are per **API process** unless `RATE_LIMIT_USE_REDIS=true`. |
| **Dependency CVEs** | Run `pip audit` / `npm audit` regularly; pin and upgrade. |
| **DDoS** | Application rate limits only; use CDN / WAF / provider limits at the edge. |

---

## 9. Operations (your responsibility)

- **TLS** at the reverse proxy; redirect HTTP → HTTPS.
- **Firewall**: expose only 80/443 publicly; not Postgres/Redis.
- **Backups**: Postgres; test restores.
- **Secrets rotation**: Meta tokens, JWT secret, integration keys.
- **Logs**: Restrict access; do not log tokens, integration keys, or full message bodies in production.

---

## 10. Pre-go-live quick check

- [ ] `DEBUG=false`, strong `JWT_SECRET_KEY`, `ENCRYPTION_KEY` set  
- [ ] `CORS_ORIGINS` matches the live dashboard URL(s)  
- [ ] `TRUSTED_HOSTS` matches public hostnames (if using that middleware)  
- [ ] `ALLOW_OPEN_REGISTRATION` intentional  
- [ ] `EXPOSE_API_DOCS=false` unless Swagger is intentionally internal-only  
- [ ] `RATE_LIMIT_USE_REDIS=true` if you run multiple API workers  
- [ ] HSTS only if HTTPS is guaranteed end-to-end  
- [ ] Webhook URL + verify token + app secret correct in Meta  
- [ ] `.env` not in git; backups configured  

---

*Review scope: backend (`app/`), frontend inbox rendering (`AppClient.tsx`), and deployment docs. Re-run this mindset review when adding new routes, parsers, or auth methods.*
