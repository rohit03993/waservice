from functools import lru_cache
import json

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=False)

    project_name: str = "WhatsApp SaaS"
    api_v1_prefix: str = "/api/v1"
    debug: bool = False
    # Set to false in production so only admins can create users (e.g. via a separate admin tool).
    allow_open_registration: bool = True

    database_url: str
    redis_url: str

    jwt_secret_key: str
    jwt_algorithm: str = "HS256"
    jwt_access_token_expire_minutes: int = 60
    # Optional. When set, new tokens include this `iss` claim; decode rejects mismatched iss.
    jwt_issuer: str = ""

    encryption_key: str = ""

    # Accept plain comma-separated string in .env:
    # CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
    # Also supports JSON array string:
    # CORS_ORIGINS=["http://localhost:3000"]
    cors_origins: str = "http://localhost:3000"

    # Comma-separated hostnames for TrustedHostMiddleware (e.g. wa.example.com,api.example.com).
    # Empty = disabled (typical for local dev). Enable behind a reverse proxy in production.
    trusted_hosts: str = ""

    # If > 0, send Strict-Transport-Security (enable only when the app is served only over HTTPS).
    hsts_max_age_seconds: int = 0

    # Use Redis fixed-window rate limits (shared across API workers). Falls back to in-process if Redis is down.
    rate_limit_use_redis: bool = False

    # When false (default), /docs, /redoc, and /openapi.json are disabled unless DEBUG=true.
    # Set true only on a trusted internal network if you need Swagger in production.
    expose_api_docs: bool = False

    @property
    def cors_origins_list(self) -> list[str]:
        value = (self.cors_origins or "").strip()
        if not value:
            return []
        if value.startswith("["):
            try:
                parsed = json.loads(value)
                if isinstance(parsed, list):
                    return [str(item).strip() for item in parsed if str(item).strip()]
            except json.JSONDecodeError:
                pass
        return [item.strip() for item in value.split(",") if item.strip()]

    @property
    def trusted_hosts_list(self) -> list[str]:
        v = (self.trusted_hosts or "").strip()
        if not v:
            return []
        return [item.strip() for item in v.split(",") if item.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
