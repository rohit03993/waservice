"""Parse Meta Graph API errors into operator-friendly messages."""

from __future__ import annotations

import re

# Common WhatsApp / Graph error codes (subset). See Meta error codes documentation.
_META_ERROR_HINTS: dict[int, str] = {
    4: "Meta rate limit reached. Wait and retry.",
    10: "Permission denied for this WhatsApp asset. Check system user token and WABA access.",
    100: "Invalid request parameters. Check template name, language, and variable values.",
    104: "Access token missing from the request.",
    190: "Access token expired or invalid. Update the system user token in WhatsApp Settings.",
    131008: "Template parameter mismatch. The template expects variables you did not provide.",
    131009: "Template parameter value is invalid.",
    131021: "Recipient cannot be messaged (may not be on WhatsApp or has blocked you).",
    131026: "Message undeliverable — customer service window may be closed; use an approved template.",
    131047: "Re-engagement required: send an approved template (24-hour window is closed).",
    131048: "Spam rate limit hit for this number. Slow down sends.",
    131049: "Meta blocked this send due to ecosystem engagement limits. Try later or use a different template category.",
    131056: "Pair rate limit: too many messages to the same user too quickly. Wait and retry.",
    132000: "Template parameter count does not match the template definition.",
    132001: (
        "Template name or language does not match Meta. Sync templates and use the exact language code "
        "(e.g. en_US vs en_GB) shown in the template library."
    ),
    132005: "Template hydration failed — check template name and language code.",
    133010: "Phone number not registered or not available for sending.",
}


def _extract_message(raw: str) -> tuple[str | None, int | None]:
    message: str | None = None
    code: int | None = None
    for pattern in (r"'message'\s*:\s*'((?:\\'|[^'])*)'", r'"message"\s*:\s*"((?:\\"|[^"])*)"'):
        match = re.search(pattern, raw)
        if match:
            message = match.group(1).replace("\\'", "'").replace('\\"', '"')
            break
    code_match = re.search(r"['\"]code['\"]\s*:\s*(\d+)", raw)
    if code_match:
        code = int(code_match.group(1))
    subcode_match = re.search(r"['\"]error_subcode['\"]\s*:\s*(\d+)", raw)
    if subcode_match:
        sub = int(subcode_match.group(1))
        if sub in _META_ERROR_HINTS:
            code = sub
    return message, code


def format_meta_error(exc: BaseException) -> str:
    raw = str(exc)
    message, code = _extract_message(raw)
    if code == 190 or (message and re.search(r"session has expired|error validating access token", message, re.I)):
        return _META_ERROR_HINTS[190]
    if code and code in _META_ERROR_HINTS:
        hint = _META_ERROR_HINTS[code]
        if message and message not in hint:
            return f"{hint} ({message})"
        return hint
    if message:
        if re.search(r"customer service|24.?hour|re-engagement|template", message, re.I):
            return f"{message} — Use an approved template if the 24-hour window is closed."
        return message
    if len(raw) > 400:
        return raw[:400] + "…"
    return raw
