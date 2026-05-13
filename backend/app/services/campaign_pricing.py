"""Approximate Meta WhatsApp template message costs for campaign budgeting.

Meta bills per delivered template message (per-message model). Rates vary by country
and template category. Defaults below are India (IN) reference rates — see:
https://developers.facebook.com/docs/whatsapp/pricing/

Utility messages can be free inside an open customer-service window; broadcast/API
campaigns typically target users outside that window, so we bill at full category rate
unless you pass open_window_count for a refined estimate.
"""

from __future__ import annotations

from typing import Any

# INR per delivered template message (India, approximate — update when Meta revises rates).
_INR_PER_MESSAGE_BY_CATEGORY: dict[str, float] = {
    "MARKETING": 0.8846,
    "UTILITY": 0.125,
    "AUTHENTICATION": 0.125,
    "SERVICE": 0.0,
}

_DEFAULT_INR_IF_UNKNOWN = 0.8846  # assume marketing (worst case for budgeting)


def normalize_template_category(category: str | None) -> str:
    if not category:
        return "UNKNOWN"
    return category.strip().upper().replace("-", "_")


def rate_inr_per_message(template_category: str | None, *, country_code: str = "IN") -> float:
    """Return approximate INR rate for one delivered template message."""
    _ = country_code  # reserved for future country-specific tables
    key = normalize_template_category(template_category)
    if key in _INR_PER_MESSAGE_BY_CATEGORY:
        return _INR_PER_MESSAGE_BY_CATEGORY[key]
    if key == "UNKNOWN":
        return _DEFAULT_INR_IF_UNKNOWN
    # Meta may return e.g. MARKETING_LITE — treat unknown marketing-like as marketing
    if "MARKETING" in key:
        return _INR_PER_MESSAGE_BY_CATEGORY["MARKETING"]
    if "UTILITY" in key:
        return _INR_PER_MESSAGE_BY_CATEGORY["UTILITY"]
    if "AUTHENTICATION" in key:
        return _INR_PER_MESSAGE_BY_CATEGORY["AUTHENTICATION"]
    return _DEFAULT_INR_IF_UNKNOWN


def estimate_campaign_cost(
    *,
    template_category: str | None,
    recipient_count: int,
    country_code: str = "IN",
    open_window_count: int = 0,
) -> dict[str, Any]:
    """
    Estimate Meta spend for a template campaign.

    open_window_count: recipients with an open 24h utility window (utility templates may be ₹0).
    """
    count = max(0, int(recipient_count))
    open_w = max(0, min(count, int(open_window_count)))
    billable = count - open_w if normalize_template_category(template_category) == "UTILITY" else count
    rate = rate_inr_per_message(template_category, country_code=country_code)
    utility_rate = _INR_PER_MESSAGE_BY_CATEGORY["UTILITY"]
    if normalize_template_category(template_category) == "UTILITY" and open_w > 0:
        total = open_w * 0.0 + billable * utility_rate
        rate_note = f"₹{utility_rate:.4f} per message outside the 24h window; free inside window"
    else:
        total = billable * rate
        rate_note = f"₹{rate:.4f} per delivered template message (India reference)"

    category = normalize_template_category(template_category)
    return {
        "recipient_count": count,
        "billable_messages": billable,
        "open_window_free_messages": open_w if category == "UTILITY" else 0,
        "rate_per_message_inr": round(rate if category != "UTILITY" or open_w == 0 else utility_rate, 4),
        "estimated_total_inr": round(total, 2),
        "currency": "INR",
        "template_category": category if category != "UNKNOWN" else None,
        "pricing_model": "per_message",
        "rate_note": rate_note,
        "disclaimer": (
            "Estimate only. Actual Meta charges depend on delivery, country, category reclassification, "
            "and volume tiers. Does not include BSP/platform fees."
        ),
    }
