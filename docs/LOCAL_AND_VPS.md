# Local development and VPS deployment

This runbook describes what you need to run the **WhatsApp SaaS** stack on your machine, why **ngrok** (or similar) is used for Meta webhooks, and how a **VPS** setup differs.

---

## What the application consists of

| Piece | Role |
|--------|------|
| **Docker Compose** | **PostgreSQL**, **Redis**, **FastAPI backend** (port **8000** in container, mapped to **8010** on the host), **worker** (campaign queue consumer). |
| **Next.js frontend** | Dashboard UI; dev server on **3010** (default). |
| **Public HTTPS URL** (local only via tunnel) | Meta must call your **webhook** on the internet; `localhost` is not reachable, so you use **ngrok** (or Cloudflare Tunnel, etc.) pointing at the **backend** port. |

---

## Prerequisites (local)

- **Docker Desktop** (or Docker Engine + Compose v2) with enough RAM for Postgres + Redis + 2 Python containers.
- **Node.js 18+** and npm (for the frontend).
- A **Meta Developer** app with WhatsApp product (phone number ID, WABA ID, tokens) when testing real sends/webhooks.
- Optional but typical for webhooks: **[ngrok](https://ngrok.com/)** account (free tier is enough to try).

---

## One-time: environment file

1. Copy `.env.example` to `.env` in the **project root** (same folder as `docker-compose.yml`).
2. Set at least:
   - **`DATABASE_URL`** — for Compose, use the `db` hostname (see `.env.example`).
   - **`REDIS_URL`** — `redis://redis:6379/0` when using Compose.
   - **`JWT_SECRET_KEY`** — long random string (32+ characters; stricter when `DEBUG=false`).
   - **`ENCRYPTION_KEY`** — Fernet key for stored secrets (generate with  
     `python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"`).
3. **`CORS_ORIGINS`** — include your UI origin, e.g. `http://localhost:3010` (comma-separated if multiple).

---

## Run the backend stack (Docker)

From the project root:

```bash
docker compose up --build
```

This starts:

- **db** — Postgres (default DB `msg_service`).
- **redis** — queue for the worker.
- **backend** — API + webhook routes at **`http://localhost:8010`** (Swagger: **`http://localhost:8010/docs`**).
- **worker** — processes campaign send jobs.

### Database migrations

After the first start (or when new migrations appear), apply schema:

```bash
docker compose exec backend alembic upgrade head
```

Check current revision:

```bash
docker compose exec backend alembic current
```

---

## Run the frontend (local)

In a **second** terminal (project root):

```bash
npm run install:frontend
npm run dev
```

Open **`http://localhost:3010`**.

### How the UI talks to the API (local)

`frontend/next.config.js` rewrites **`/api/*`** → **`http://localhost:8010/api/*`**.  
The app uses **`NEXT_PUBLIC_API_BASE_URL`** defaulting to **`/api/v1`**, so the browser calls the Next dev server and requests are proxied to the backend.

---

## Meta webhooks: why ngrok (or similar)

Inbound WhatsApp events use:

| Method | Path |
|--------|------|
| **GET** | `/api/v1/webhook/whatsapp` — Meta **verification** (`hub.verify_token`, `hub.challenge`). |
| **POST** | `/api/v1/webhook/whatsapp` — **signed** delivery payloads (requires **app secret** for signature verification). |

Meta’s servers cannot reach `http://localhost:8010`. You need a **public HTTPS** URL that forwards to your backend.

### Using ngrok (typical local flow)

1. Start Docker Compose so the backend listens on **8010**.
2. In another terminal, expose that port, for example:

   ```bash
   ngrok http 8010
   ```

3. Note the **HTTPS** forwarding URL (e.g. `https://abcd-123.ngrok-free.app`).
4. In **Meta Developer Console** → your app → **WhatsApp** → **Configuration** (webhook):
   - **Callback URL**:  
     `https://<your-ngrok-host>/api/v1/webhook/whatsapp`
   - **Verify token**: must match the **verify token** you saved in **WhatsApp Settings** in this app (stored per connection).

5. Keep **ngrok** running while you test webhooks. If the ngrok URL changes, update the callback URL in Meta.

### Alternatives to ngrok

- **Cloudflare Tunnel** (`cloudflared`), **localtunnel**, or another HTTPS reverse tunnel to port **8010**.
- On a **VPS**, you normally use a **real domain + TLS** instead (see below).

### Webhook security (app secret)

Configure the **app secret** in the dashboard (WhatsApp connection) so **POST** webhooks are signature-verified. Without it, connection health checks will warn that webhooks are not fully secured.

---

## Quick reference: local URLs

| Service | URL |
|---------|-----|
| Frontend | `http://localhost:3010` |
| API / OpenAPI | `http://localhost:8010` / `http://localhost:8010/docs` |
| Webhook (browser/Meta) | `https://<tunnel-or-domain>/api/v1/webhook/whatsapp` |

---

## VPS / production — how it differs

On a server you usually **do not** use ngrok. You expose services via a **domain**, **HTTPS**, and a **reverse proxy**.

### Typical layout

- **Same Compose stack** (or managed Postgres/Redis with `DATABASE_URL` / `REDIS_URL` pointing to those services).
- **Reverse proxy** (Nginx, Caddy, Traefik):
  - Terminates TLS (e.g. Let’s Encrypt).
  - Routes **`https://api.yourdomain.com`** → backend **:8000** (or whatever port the API container publishes internally).
  - Optionally routes **`https://app.yourdomain.com`** → Next.js **:3010** (or static export / Node `next start`).
- **Meta webhook callback**:  
  `https://api.yourdomain.com/api/v1/webhook/whatsapp`  
  (must match the path the app actually serves; no tunnel needed if DNS + TLS are correct.)

### Environment differences (important)

- Set **`DEBUG=false`**.
- Use a **strong** `JWT_SECRET_KEY` (and non-default Postgres passwords).
- **`CORS_ORIGINS`**: list your **production** dashboard origin(s), e.g. `https://app.yourdomain.com`.
- **`ENCRYPTION_KEY`**: keep stable across deploys (rotating invalidates stored encrypted tokens unless you re-encrypt).

### Next.js API proxy in production

The dev **`rewrites()`** in `next.config.js` target **`http://localhost:8010`**, which is only valid on your laptop.

For production, pick **one** approach:

1. **Recommended:** Set **`NEXT_PUBLIC_API_BASE_URL`** at build time to your public API, e.g.  
   `https://api.yourdomain.com/api/v1`  
   so the browser calls the API directly (and CORS must allow the dashboard origin).

2. Or run Next behind the same proxy and change rewrites so **`/api`** forwards to the **internal** backend service name/port (not `localhost:8010`).

### Process manager / restarts

- Use **`docker compose up -d`**, or orchestration you prefer.
- Run **`alembic upgrade head`** on each deploy when migrations ship.
- Ensure the **worker** container is running whenever you rely on **campaign** dispatch.

### Firewall

- Open **80/443** for the proxy.
- Do **not** expose Postgres/Redis to the public internet unless you know what you’re doing.

### Backups

- Back up the **Postgres** volume or use managed DB snapshots.
- Store **`.env`** (or secrets manager) outside the image; never commit real secrets.

---

## Checklist summary

**Local**

- [ ] `.env` created and secrets set  
- [ ] `docker compose up --build`  
- [ ] `alembic upgrade head` in `backend` container  
- [ ] `npm run dev` for frontend  
- [ ] ngrok (or tunnel) → **8010**, Meta webhook URL + verify token aligned  
- [ ] App secret set for signed webhooks  

**VPS**

- [ ] Domain + HTTPS reverse proxy to API  
- [ ] `DEBUG=false`, strong JWT, `CORS_ORIGINS` for real UI origin  
- [ ] Webhook URL uses **public** `https://.../api/v1/webhook/whatsapp`  
- [ ] Production API base URL configured for frontend (`NEXT_PUBLIC_API_BASE_URL` or proxy rewrites)  
- [ ] Worker + Redis running; migrations applied  
- [ ] Security env + checklist: [SECURITY.md](./SECURITY.md)  

---

*Last aligned with this repo’s `docker-compose.yml`, `frontend/next.config.js`, and webhook routes under `/api/v1/webhook/whatsapp`.*
