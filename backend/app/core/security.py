from datetime import datetime, timedelta, timezone
from typing import Any

from jose import JWTError, jwt
from passlib.context import CryptContext

from app.core.config import get_settings

pwd_context = CryptContext(schemes=["argon2"], deprecated="auto")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain_password: str, hashed_password: str) -> bool:
    return pwd_context.verify(plain_password, hashed_password)


def create_access_token(subject: str, expires_delta_minutes: int | None = None, extra: dict[str, Any] | None = None) -> str:
    settings = get_settings()
    expire_minutes = expires_delta_minutes or settings.jwt_access_token_expire_minutes
    expire = datetime.now(timezone.utc) + timedelta(minutes=expire_minutes)

    payload: dict[str, Any] = {"sub": subject, "exp": expire}
    if extra:
        payload.update(extra)
    issuer = (settings.jwt_issuer or "").strip()
    if issuer:
        payload["iss"] = issuer

    return jwt.encode(payload, settings.jwt_secret_key, algorithm=settings.jwt_algorithm)


def decode_token(token: str) -> dict[str, Any] | None:
    settings = get_settings()
    try:
        payload = jwt.decode(
            token,
            settings.jwt_secret_key,
            algorithms=[settings.jwt_algorithm],
            options={
                "verify_aud": False,
                "require": ["exp", "sub"],
            },
        )
    except JWTError:
        return None
    issuer = (settings.jwt_issuer or "").strip()
    if issuer:
        tok_iss = payload.get("iss")
        if tok_iss is not None and tok_iss != issuer:
            return None
    return payload
