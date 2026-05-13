import hashlib
import hmac
import secrets

import redis

from app.core.config import get_settings

_OTP_REDIS_KEY = "phone_otp:v1:{phone}"
_BIND_OTP_REDIS_KEY = "phone_bind_otp:v1:{user_id}:{phone}"


def generate_six_digit_code() -> str:
    return f"{secrets.randbelow(1_000_000):06d}"


def _redis():
    return redis.Redis.from_url(get_settings().redis_url, decode_responses=True)


def _otp_digest(*, phone_e164: str, code: str) -> str:
    pepper = get_settings().jwt_secret_key.encode("utf-8")
    return hmac.new(pepper, f"{phone_e164}:{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def store_login_otp(*, phone_e164: str, code: str, ttl_seconds: int) -> None:
    r = _redis()
    r.setex(_OTP_REDIS_KEY.format(phone=phone_e164), ttl_seconds, _otp_digest(phone_e164=phone_e164, code=code))


def verify_and_consume_login_otp(*, phone_e164: str, code: str) -> bool:
    r = _redis()
    key = _OTP_REDIS_KEY.format(phone=phone_e164)
    stored = r.get(key)
    if not stored:
        return False
    expected = _otp_digest(phone_e164=phone_e164, code=code)
    if not hmac.compare_digest(stored, expected):
        return False
    r.delete(key)
    return True


def _bind_digest(*, user_id: str, phone_e164: str, code: str) -> str:
    pepper = get_settings().jwt_secret_key.encode("utf-8")
    return hmac.new(pepper, f"{user_id}:{phone_e164}:{code}".encode("utf-8"), hashlib.sha256).hexdigest()


def store_bind_phone_otp(*, user_id: str, phone_e164: str, code: str, ttl_seconds: int) -> None:
    r = _redis()
    key = _BIND_OTP_REDIS_KEY.format(user_id=user_id, phone=phone_e164)
    r.setex(key, ttl_seconds, _bind_digest(user_id=user_id, phone_e164=phone_e164, code=code))


def verify_and_consume_bind_phone_otp(*, user_id: str, phone_e164: str, code: str) -> bool:
    r = _redis()
    key = _BIND_OTP_REDIS_KEY.format(user_id=user_id, phone=phone_e164)
    stored = r.get(key)
    if not stored:
        return False
    expected = _bind_digest(user_id=user_id, phone_e164=phone_e164, code=code)
    if not hmac.compare_digest(stored, expected):
        return False
    r.delete(key)
    return True
