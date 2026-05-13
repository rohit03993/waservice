import logging
import uuid
from typing import Any

import httpx

from app.core.config import get_settings

_logger = logging.getLogger("uvicorn.error")

SENT_MESSAGES_URL = "https://api.sent.dm/v3/messages"


def send_sms_with_template(*, to_e164: str, template_parameters: dict[str, str]) -> None:
    """Send one SMS via Sent.dm v3 messages API. Raises on transport or API failure."""
    settings = get_settings()
    api_key = (settings.sent_dm_api_key or "").strip()
    template_id = (settings.sent_dm_template_id or "").strip()
    if not api_key or not template_id:
        raise RuntimeError("Sent.dm API key or template id is not configured")

    body: dict[str, Any] = {
        "to": [to_e164],
        "channel": ["sms"],
        "template": {
            "id": template_id,
            "parameters": template_parameters,
        },
    }
    headers = {
        "x-api-key": api_key,
        "Content-Type": "application/json",
        "Idempotency-Key": str(uuid.uuid4()),
    }
    with httpx.Client(timeout=25.0) as client:
        resp = client.post(SENT_MESSAGES_URL, json=body, headers=headers)

    if resp.status_code not in (200, 202):
        _logger.error("Sent.dm HTTP error: %s %s", resp.status_code, (resp.text or "")[:800])
        raise RuntimeError("Sent.dm request failed")

    try:
        payload = resp.json()
    except ValueError:
        _logger.error("Sent.dm non-JSON body: %s", (resp.text or "")[:500])
        raise RuntimeError("Sent.dm returned invalid JSON") from None

    if not payload.get("success"):
        err = payload.get("error") or {}
        _logger.error(
            "Sent.dm API error: code=%s message=%s details=%s",
            err.get("code"),
            err.get("message"),
            err.get("details"),
        )
        raise RuntimeError("Sent.dm rejected the message")
