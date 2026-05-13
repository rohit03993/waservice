"""Meta WhatsApp customer service window and send eligibility (24h rule)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from typing import Any

# Meta: customer service window is 24 hours from last user message/call.
CUSTOMER_SERVICE_WINDOW = timedelta(hours=24)


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def window_expires_at(last_inbound_at: datetime | None) -> datetime | None:
    if last_inbound_at is None:
        return None
    return _as_utc(last_inbound_at) + CUSTOMER_SERVICE_WINDOW


def is_customer_service_window_open(last_inbound_at: datetime | None, *, now: datetime | None = None) -> bool:
    expires = window_expires_at(last_inbound_at)
    if expires is None:
        return False
    current = _as_utc(now) if now else _utc_now()
    return current < expires


def build_messaging_window(last_inbound_at: datetime | None, *, now: datetime | None = None) -> dict[str, Any]:
    """UI/API payload describing what send modes Meta allows for this contact."""
    current = _as_utc(now) if now else _utc_now()
    expires = window_expires_at(last_inbound_at)
    is_open = expires is not None and current < expires
    seconds_remaining: int | None = None
    if is_open and expires is not None:
        seconds_remaining = max(0, int((expires - current).total_seconds()))

    if is_open:
        session_hint = "Free-form replies (text/media) are allowed until the customer service window closes."
    elif last_inbound_at is None:
        session_hint = "This contact has not messaged you yet. Use an approved template to start the conversation."
    else:
        session_hint = "Customer service window closed. Use an approved template to message this contact."

    return {
        "is_open": is_open,
        "last_inbound_at": _as_utc(last_inbound_at).isoformat() if last_inbound_at else None,
        "expires_at": expires.isoformat() if expires else None,
        "seconds_remaining": seconds_remaining,
        "can_send_session": is_open,
        "can_send_template": True,
        "session_hint": session_hint,
    }


def build_template_body_parameters(
    body_variable_keys: list[str],
    *,
    contact_name: str | None,
    overrides: dict[str, str] | None = None,
) -> list[dict[str, str]]:
    """Map template body placeholders to values (contact name default; CSV/API may override per key)."""
    fill = (contact_name or "Customer").strip() or "Customer"
    overrides = overrides or {}
    params: list[dict[str, str]] = []
    for index, key in enumerate(body_variable_keys, start=1):
        if key.isdigit():
            value = overrides.get(key) or overrides.get(str(index)) or fill
            params.append({"type": "text", "text": value})
        else:
            value = overrides.get(key) or overrides.get(key.lower()) or fill
            params.append({"type": "text", "text": value, "parameter_name": key})
    return params


def merge_template_defaults_for_contact(
    body_variable_keys: list[str],
    *,
    contact_name: str | None,
    defaults: dict[str, str] | None,
) -> dict[str, str]:
    """Apply user-provided defaults; fill name-like keys from contact when not set."""
    overrides: dict[str, str] = {k: str(v).strip() for k, v in (defaults or {}).items() if str(v).strip()}
    fill_name = (contact_name or "Customer").strip() or "Customer"
    for key in body_variable_keys:
        if overrides.get(key, "").strip():
            continue
        kl = key.lower()
        if kl.isdigit():
            continue
        if any(token in kl for token in ("name", "customer", "first", "user", "recipient")):
            overrides[key] = fill_name
    return overrides


def template_variables_from_stored(stored: list | None) -> list[dict[str, str]] | None:
    if not stored:
        return None
    return [item for item in stored if isinstance(item, dict)]


def csv_row_template_overrides(
    body_variable_keys: list[str],
    row: dict[str, str],
    header_map: dict[str, str],
) -> dict[str, str]:
    """Read CSV columns matching template variable names or var1/var2/1/2."""
    overrides: dict[str, str] = {}
    for index, key in enumerate(body_variable_keys, start=1):
        candidates = [key, key.lower(), f"var{index}", f"variable{index}", str(index)]
        for candidate in candidates:
            col = header_map.get(candidate.lower())
            if not col:
                continue
            value = (row.get(col) or "").strip()
            if value:
                overrides[key] = value
                break
    return overrides


def session_send_blocked_message(last_inbound_at: datetime | None) -> str:
    if last_inbound_at is None:
        return (
            "Cannot send a free-form reply: this contact has not messaged you. "
            "Send an approved WhatsApp template instead (Meta customer service window)."
        )
    return (
        "Cannot send a free-form reply: the 24-hour customer service window has closed. "
        "Send an approved WhatsApp template instead."
    )
