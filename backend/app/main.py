import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.trustedhost import TrustedHostMiddleware

from app.api.v1 import api_router
from app.api.v1.whatsapp import webhook_router
from app.core.config import get_settings
from app.core.secrets import ensure_encryption_key_configured

_WEAK_JWT_SECRETS = frozenset(
    {
        "",
        "changeme",
        "change-this-super-secret-key",
        "secret",
        "jwt-secret",
        "your-secret-key",
        "supersecret",
    }
)
from app.models import (
    AuditLog,
    Campaign,
    CampaignRecipient,
    Contact,
    ContactTag,
    Conversation,
    IntegrationApiKey,
    MessageTemplate,
    Membership,
    Message,
    Tag,
    Tenant,
    User,
    WhatsAppConnection,
)  # noqa: F401

settings = get_settings()
_logger = logging.getLogger("uvicorn.error")

_show_api_docs = settings.debug or settings.expose_api_docs
app = FastAPI(
    title=settings.project_name,
    debug=settings.debug,
    docs_url="/docs" if _show_api_docs else None,
    redoc_url="/redoc" if _show_api_docs else None,
    openapi_url="/openapi.json" if _show_api_docs else None,
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    response.headers.setdefault(
        "Permissions-Policy",
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    )
    if settings.hsts_max_age_seconds > 0:
        response.headers.setdefault(
            "Strict-Transport-Security",
            f"max-age={settings.hsts_max_age_seconds}; includeSubDomains",
        )
    path = request.url.path
    api_prefix = settings.api_v1_prefix
    if path.startswith(api_prefix) or path.startswith("/api/v1/webhook"):
        response.headers.setdefault("Cache-Control", "no-store")
    return response


_cors_origins = list(settings.cors_origins_list)
if not _cors_origins:
    if settings.debug:
        _cors_origins = [
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:3010",
            "http://127.0.0.1:3010",
        ]
    else:
        _logger.warning(
            "CORS_ORIGINS is empty. Browser access to the API will be blocked until you set it to your dashboard HTTPS origin(s)."
        )

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "X-Tenant-Slug",
        "Accept",
        "X-Integration-Key",
    ],
    expose_headers=[],
    max_age=600,
)

if settings.trusted_hosts_list:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts_list)

app.include_router(api_router, prefix=settings.api_v1_prefix)
app.include_router(webhook_router)
# AiSensy paths live under api_router: POST /api/v1 and POST /api/v1/campaign/t1/api/v2


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    _logger.exception("Unhandled exception", exc_info=exc)
    body: dict = {"detail": "An unexpected error occurred"}
    if settings.debug:
        body["error_type"] = type(exc).__name__
    return JSONResponse(status_code=500, content=body)


@app.on_event("startup")
def validate_security_configuration() -> None:
    ensure_encryption_key_configured()
    startup_settings = get_settings()
    jwt_key = (startup_settings.jwt_secret_key or "").strip()
    if len(jwt_key) < 32 or jwt_key.lower() in _WEAK_JWT_SECRETS:
        if startup_settings.debug:
            _logger.warning(
                "JWT_SECRET_KEY is weak or too short. Use at least 32 random characters before running in production (set DEBUG=false)."
            )
        else:
            raise RuntimeError(
                "JWT_SECRET_KEY must be at least 32 characters and not a default placeholder when DEBUG=false. "
                'Generate one with: python -c "import secrets; print(secrets.token_urlsafe(48))"'
            )
    if not startup_settings.debug:
        if startup_settings.allow_open_registration:
            _logger.warning(
                "allow_open_registration is True while DEBUG=false. Consider setting ALLOW_OPEN_REGISTRATION=false in production."
            )
        if startup_settings.hsts_max_age_seconds > 0 and not startup_settings.trusted_hosts_list:
            _logger.warning(
                "HSTS is enabled but TRUSTED_HOSTS is empty. Ensure the app is only reachable over HTTPS behind your reverse proxy."
            )
