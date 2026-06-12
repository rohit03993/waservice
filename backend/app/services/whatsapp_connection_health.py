"""Evaluate WhatsApp connection health (shared by tenant admin UI and platform super-admin)."""

from __future__ import annotations

from app.core.secrets import decrypt_secret
from app.models.whatsapp_connection import WhatsAppConnection
from app.services.meta_client import MetaClient
from app.services.meta_errors import format_meta_error


def classify_token_alert(token_ok: bool, token_error: str | None) -> tuple[str | None, str | None]:
    """Return (alert_kind, operator_message) for UI banners. kind: missing | expired | invalid."""
    if token_ok:
        return None, None
    if not token_error or "missing" in token_error.lower():
        return "missing", "Access token is not set. Add a Meta token in WhatsApp Settings."
    err_l = token_error.lower()
    if "expired" in err_l or "session has expired" in err_l or "error validating access token" in err_l:
        msg = format_meta_error(RuntimeError(token_error))
        return "expired", msg
    if "190" in token_error:
        return "expired", format_meta_error(RuntimeError(token_error))
    return "invalid", format_meta_error(RuntimeError(token_error))


def plain_verify_token(value: str | None) -> str:
    if not value:
        return ""
    plain = decrypt_secret(value)
    return (plain or "").strip()


async def evaluate_whatsapp_connection(connection: WhatsAppConnection | None) -> dict:
    if not connection:
        return {
            "overall": "disconnected",
            "connection_configured": False,
            "waba_configured": False,
            "verify_token_configured": False,
            "app_secret_configured": False,
            "token_valid": False,
            "token_error": None,
            "token_alert": "missing",
            "token_alert_message": "Save a WhatsApp connection in Settings.",
            "webhook_ready": False,
            "connection_active": False,
            "hints": ["Save a WhatsApp connection in Settings."],
        }

    waba_ok = bool(connection.waba_id and str(connection.waba_id).strip())
    verify_ok = bool(plain_verify_token(connection.verify_token))
    secret_ok = bool(connection.app_secret)
    token_plain = decrypt_secret(connection.access_token) or ""

    token_ok = False
    token_error: str | None = None
    phone_profile: dict[str, str | None] | None = None
    if token_plain:
        token_ok, token_error, phone_profile = await MetaClient.verify_phone_number_access(
            phone_number_id=connection.phone_number_id,
            access_token=token_plain,
        )
    else:
        token_error = "Access token missing"

    webhook_ready = verify_ok and secret_ok
    hints: list[str] = []
    if not token_ok:
        hints.append(
            "Meta access token is missing, expired, or not allowed for this phone number. Paste a fresh token and save."
        )
    if not waba_ok:
        hints.append("Add WABA ID to enable template sync from Meta.")
    if not webhook_ready:
        hints.append("Set verify token and app secret so inbound webhooks are verified securely.")
    if not connection.is_active:
        hints.append("Connection is inactive; enable it or pick another default.")

    if not connection.is_active or not token_ok or not waba_ok or not webhook_ready:
        overall = "attention"
    else:
        overall = "healthy"

    token_alert, token_alert_message = classify_token_alert(token_ok, token_error)

    return {
        "overall": overall,
        "connection_configured": True,
        "waba_configured": waba_ok,
        "verify_token_configured": verify_ok,
        "app_secret_configured": secret_ok,
        "token_valid": token_ok,
        "token_error": token_error[:500] if token_error else None,
        "token_alert": token_alert,
        "token_alert_message": token_alert_message,
        "webhook_ready": webhook_ready,
        "connection_active": connection.is_active,
        "hints": hints,
        "phone_number_id": connection.phone_number_id,
        "display_phone_number": phone_profile.get("display_phone_number") if phone_profile else None,
        "verified_name": phone_profile.get("verified_name") if phone_profile else None,
        "connection_label": connection.label,
    }
