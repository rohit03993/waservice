"""Platform super-admin access (cross-tenant)."""

from app.core.config import get_settings


def super_admin_emails_list() -> list[str]:
    raw = (get_settings().super_admin_emails or "").strip()
    if not raw:
        return []
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def is_super_admin_email(email: str | None) -> bool:
    if not email:
        return False
    allowed = super_admin_emails_list()
    if not allowed:
        return False
    return email.strip().lower() in allowed
