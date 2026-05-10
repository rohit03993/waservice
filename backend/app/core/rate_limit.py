import logging
import time
from collections import defaultdict, deque
from collections.abc import Hashable

from fastapi import HTTPException, status

from app.core.config import get_settings

_WINDOWS: dict[Hashable, deque[float]] = defaultdict(deque)
_logger = logging.getLogger("uvicorn.error")
_redis_warned = False
_redis_client = None


def _check_rate_limit_memory(*, key: str, limit: int, window_seconds: int) -> None:
    now = time.time()
    bucket = _WINDOWS[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    bucket.append(now)


def _get_redis():
    global _redis_client
    if _redis_client is None:
        import redis

        _redis_client = redis.from_url(
            get_settings().redis_url,
            socket_connect_timeout=1.5,
            socket_timeout=2.0,
        )
    return _redis_client


def _check_rate_limit_redis(*, key: str, limit: int, window_seconds: int) -> None:
    global _redis_warned

    now = int(time.time())
    window_id = now // max(window_seconds, 1)
    safe_key = key.replace("\n", "").replace("\r", "")[:200]
    rk = f"rl:v1:{safe_key}:{window_id}"
    try:
        r = _get_redis()
        n = int(r.incr(rk))
        if n == 1:
            r.expire(rk, window_seconds)
        if n > limit:
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    except HTTPException:
        raise
    except Exception as err:
        global _redis_client
        _redis_client = None
        if not _redis_warned:
            _logger.warning("Redis rate limit unavailable, using in-process fallback: %s", err)
            _redis_warned = True
        _check_rate_limit_memory(key=key, limit=limit, window_seconds=window_seconds)


def check_rate_limit(*, key: str, limit: int, window_seconds: int) -> None:
    settings = get_settings()
    if settings.rate_limit_use_redis:
        _check_rate_limit_redis(key=key, limit=limit, window_seconds=window_seconds)
    else:
        _check_rate_limit_memory(key=key, limit=limit, window_seconds=window_seconds)
