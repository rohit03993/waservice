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
    encryption_key: str = ""

    # Accept plain comma-separated string in .env:
    # CORS_ORIGINS=http://localhost:3000,http://127.0.0.1:3000
    # Also supports JSON array string:
    # CORS_ORIGINS=["http://localhost:3000"]
    cors_origins: str = "http://localhost:3000"

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


@lru_cache
def get_settings() -> Settings:
    return Settings()
