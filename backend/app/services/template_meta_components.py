"""Build Meta Cloud API template `components` for sends (body + auth copy-code button)."""

from __future__ import annotations

from app.schemas.whatsapp import TemplateSendBodyParameter, template_body_parameters_to_meta_components


def authentication_template_needs_copy_code_button(
    *,
    category: str | None,
    components_wrapped: dict | None,
) -> bool:
    """
    Meta Authentication templates (copy code) require the same OTP in a button component
    when sending — not only in the body. Without it Meta returns error #131008.
    """
    if (category or "").strip().upper() == "AUTHENTICATION":
        return True

    raw = components_wrapped.get("components") if isinstance(components_wrapped, dict) else None
    if not isinstance(raw, list):
        return False
    for comp in raw:
        if str(comp.get("type") or "").upper() != "BUTTONS":
            continue
        buttons = comp.get("buttons")
        if not isinstance(buttons, list):
            continue
        for btn in buttons:
            if not isinstance(btn, dict):
                continue
            btn_type = str(btn.get("type") or "").upper()
            otp_type = str(btn.get("otp_type") or "").upper()
            if btn_type == "OTP" or otp_type in {"COPY_CODE", "ONE_TAP", "ZERO_TAP"}:
                return True
    return False


def _first_body_otp_text(params: list[TemplateSendBodyParameter] | None) -> str | None:
    if not params:
        return None
    for p in params:
        text = str(p.text or "").strip()
        if text:
            return text
    return None


def build_copy_code_button_component(otp_text: str) -> dict:
    """Meta send payload for Authentication template copy-code button (index 0)."""
    return {
        "type": "button",
        "sub_type": "url",
        "index": "0",
        "parameters": [{"type": "text", "text": otp_text}],
    }


def build_meta_template_components(
    body_parameters: list[TemplateSendBodyParameter] | None,
    *,
    category: str | None = None,
    components_wrapped: dict | None = None,
    button_otp_text: str | None = None,
) -> list[dict] | None:
    """
    Body variables + optional Authentication copy-code button (same OTP as body {{1}}).
    """
    comps: list[dict] = []
    body_block = template_body_parameters_to_meta_components(body_parameters)
    if body_block:
        comps.extend(body_block)

    otp = (button_otp_text or "").strip() or _first_body_otp_text(body_parameters)
    if otp and authentication_template_needs_copy_code_button(
        category=category,
        components_wrapped=components_wrapped,
    ):
        comps.append(build_copy_code_button_component(otp))

    return comps or None
