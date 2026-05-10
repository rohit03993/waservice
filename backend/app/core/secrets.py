import base64

from cryptography.fernet import Fernet, InvalidToken

from app.core.config import get_settings

_PREFIX = "enc::"


def _build_fernet() -> Fernet | None:
    settings = get_settings()
    raw = (settings.encryption_key or "").strip()
    if not raw:
        return None
    key = raw.encode("utf-8")
    try:
        return Fernet(key)
    except ValueError:
        normalized = base64.urlsafe_b64encode(key.ljust(32, b"0")[:32])
        return Fernet(normalized)


def ensure_encryption_key_configured() -> None:
    settings = get_settings()
    raw = (settings.encryption_key or "").strip()
    if not raw:
        raise RuntimeError("ENCRYPTION_KEY is required and cannot be empty")
    _build_fernet()


def encrypt_secret(value: str) -> str:
    if not value:
        return value
    fernet = _build_fernet()
    if not fernet:
        return value
    encrypted = fernet.encrypt(value.encode("utf-8")).decode("utf-8")
    return f"{_PREFIX}{encrypted}"


def decrypt_secret(value: str | None) -> str | None:
    if value is None or not value:
        return value
    if not value.startswith(_PREFIX):
        return value
    fernet = _build_fernet()
    if not fernet:
        return None
    try:
        token = value[len(_PREFIX) :]
        return fernet.decrypt(token.encode("utf-8")).decode("utf-8")
    except (InvalidToken, ValueError):
        return None
