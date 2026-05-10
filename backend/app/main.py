from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

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

app = FastAPI(title=settings.project_name, debug=settings.debug)


@app.middleware("http")
async def add_security_headers(request, call_next):
    response = await call_next(request)
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "strict-origin-when-cross-origin")
    return response


app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


app.include_router(api_router, prefix=settings.api_v1_prefix)
app.include_router(webhook_router)


@app.on_event("startup")
def validate_security_configuration() -> None:
    ensure_encryption_key_configured()
    settings = get_settings()
    jwt_key = (settings.jwt_secret_key or "").strip()
    if len(jwt_key) < 32 or jwt_key.lower() in _WEAK_JWT_SECRETS:
        if settings.debug:
            import logging

            logging.getLogger("uvicorn.error").warning(
                "JWT_SECRET_KEY is weak or too short. Use at least 32 random characters before running in production (set DEBUG=false)."
            )
        else:
            raise RuntimeError(
                "JWT_SECRET_KEY must be at least 32 characters and not a default placeholder when DEBUG=false. "
                "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(48))\""
            )
