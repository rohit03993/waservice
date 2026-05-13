import re

# E.164: + then country + subscriber (7–15 digits total after +).
_E164 = re.compile(r"^\+[1-9]\d{6,14}$")


def to_e164_india_default(raw: str) -> str:
    """
    Normalize to E.164. If there is no leading +, a 10-digit Indian mobile
    (starting 6–9) or a 12-digit 91… form is treated as India (+91).
    """
    s = (raw or "").strip().replace(" ", "")
    if not s:
        raise ValueError("Phone is required")
    if s.startswith("+"):
        if _E164.fullmatch(s):
            return s
        raise ValueError("Phone must be in E.164 format (e.g. +919876543210)")
    digits = re.sub(r"\D", "", s)
    if digits.startswith("0") and len(digits) == 11:
        digits = digits[1:]
    if re.fullmatch(r"[6-9]\d{9}", digits):
        s = "+91" + digits
    elif len(digits) == 12 and digits.startswith("91") and re.fullmatch(r"[6-9]\d{9}", digits[2:]):
        s = "+" + digits
    else:
        if not digits:
            raise ValueError("Phone must be in E.164 format (e.g. +919876543210)")
        s = "+" + digits
    if not _E164.fullmatch(s):
        raise ValueError("Phone must be in E.164 format (e.g. +919876543210)")
    return s
