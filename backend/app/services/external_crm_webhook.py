"""Forward Meta WhatsApp webhook payloads to an external CRM (optional, env-configured)."""

from __future__ import annotations

import hashlib
import hmac
import json
import logging
from datetime import datetime, timezone
from urllib.parse import urlparse

import httpx

from app.core.config import get_settings

_logger = logging.getLogger("uvicorn.error")


def external_crm_webhook_configured() -> bool:
    return bool((get_settings().external_crm_webhook_url or "").strip())


def external_crm_webhook_status() -> dict[str, str | bool]:
    settings = get_settings()
    url = (settings.external_crm_webhook_url or "").strip()
    if not url:
        return {"configured": False, "url_host": "", "signing_enabled": False}
    parsed = urlparse(url)
    host = parsed.netloc or parsed.path.split("/")[0] or ""
    return {
        "configured": True,
        "url_host": host,
        "signing_enabled": bool((settings.external_crm_webhook_secret or "").strip()),
    }


def build_forward_payload(*, meta_payload: dict, phone_number_ids: list[str]) -> dict:
    return {
        "source": "waservice",
        "event_type": "meta.whatsapp.webhook",
        "received_at": datetime.now(timezone.utc).isoformat(),
        "phone_number_ids": phone_number_ids,
        "payload": meta_payload,
    }


def _sign_body(body_bytes: bytes, secret: str) -> str:
    digest = hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
    return f"sha256={digest}"


def deliver_external_crm_webhook(*, meta_payload: dict, phone_number_ids: list[str]) -> tuple[bool, str | None]:
    """
    POST normalized event to EXTERNAL_CRM_WEBHOOK_URL.
    Returns (success, error_message). Never raises — safe to call from webhook background task.
    """
    settings = get_settings()
    url = (settings.external_crm_webhook_url or "").strip()
    if not url:
        return False, "EXTERNAL_CRM_WEBHOOK_URL is not configured"

    body = build_forward_payload(meta_payload=meta_payload, phone_number_ids=phone_number_ids)
    body_bytes = json.dumps(body, separators=(",", ":"), default=str).encode("utf-8")
    headers = {
        "Content-Type": "application/json",
        "User-Agent": "waservice-webhook-forward/1.0",
    }
    secret = (settings.external_crm_webhook_secret or "").strip()
    if secret:
        headers["X-Waservice-Signature"] = _sign_body(body_bytes, secret)

    try:
        with httpx.Client(timeout=12.0) as client:
            resp = client.post(url, content=body_bytes, headers=headers)
    except httpx.HTTPError as exc:
        _logger.warning("External CRM webhook delivery failed: %s", exc)
        return False, str(exc)

    if resp.status_code >= 400:
        detail = (resp.text or "")[:500]
        _logger.warning("External CRM webhook returned %s: %s", resp.status_code, detail)
        return False, f"HTTP {resp.status_code}: {detail}"

    return True, None


def sample_test_payload() -> tuple[dict, list[str]]:
    payload = {
        "object": "whatsapp_business_account",
        "entry": [
            {
                "id": "TEST_ENTRY",
                "changes": [
                    {
                        "field": "messages",
                        "value": {
                            "metadata": {"phone_number_id": "TEST_PHONE_NUMBER_ID"},
                            "messages": [
                                {
                                    "from": "919999999999",
                                    "id": "wamid.waservice_test",
                                    "timestamp": "0",
                                    "type": "text",
                                    "text": {"body": "waservice external CRM webhook test"},
                                }
                            ],
                        },
                    }
                ],
            }
        ],
    }
    return payload, ["TEST_PHONE_NUMBER_ID"]
