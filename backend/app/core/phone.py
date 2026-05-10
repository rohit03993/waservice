import re

DEFAULT_COUNTRY_CODE = "+91"


def normalize_phone_e164(value: str, default_country_code: str = DEFAULT_COUNTRY_CODE) -> str:
    raw = (value or "").strip()
    if not raw:
        return raw

    cleaned = re.sub(r"[^\d+]", "", raw)
    if cleaned.startswith("+"):
        return "+" + re.sub(r"\D", "", cleaned[1:])
    if cleaned.startswith("00"):
        return "+" + re.sub(r"\D", "", cleaned[2:])

    digits = re.sub(r"\D", "", cleaned)
    if not digits:
        return raw

    # If country code is already present without plus (e.g. 9198xxxxxx), just add '+'.
    default_digits = re.sub(r"\D", "", default_country_code)
    if digits.startswith(default_digits) and len(digits) >= len(default_digits) + 8:
        return f"+{digits}"

    local_digits = digits.lstrip("0")
    return f"+{default_digits}{local_digits}"
