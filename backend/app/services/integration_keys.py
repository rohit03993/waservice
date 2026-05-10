"""Create and verify integration API keys (format: wsk.<uuid>.<secret>)."""

from __future__ import annotations

import secrets
from uuid import UUID

from passlib.hash import argon2


def generate_integration_api_key(*, key_id: UUID) -> tuple[str, str]:
    """Return (full_key, raw_secret) where full_key is shown once to the admin."""
    raw_secret = secrets.token_urlsafe(32)
    full_key = f"wsk.{key_id}.{raw_secret}"
    return full_key, raw_secret


def hash_integration_secret(raw_secret: str) -> str:
    return argon2.hash(raw_secret)


def verify_integration_secret(raw_secret: str, key_hash: str) -> bool:
    try:
        return argon2.verify(raw_secret, key_hash)
    except ValueError:
        return False


def parse_integration_api_key(header_value: str) -> tuple[UUID, str] | None:
    """Parse X-Integration-Key value into key id and secret."""
    raw = (header_value or "").strip()
    parts = raw.split(".")
    if len(parts) != 3 or parts[0] != "wsk":
        return None
    try:
        return UUID(parts[1]), parts[2]
    except ValueError:
        return None
