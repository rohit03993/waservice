import time
from collections import defaultdict, deque
from collections.abc import Hashable

from fastapi import HTTPException, status

_WINDOWS: dict[Hashable, deque[float]] = defaultdict(deque)


def check_rate_limit(*, key: str, limit: int, window_seconds: int) -> None:
    now = time.time()
    bucket = _WINDOWS[key]
    cutoff = now - window_seconds
    while bucket and bucket[0] < cutoff:
        bucket.popleft()
    if len(bucket) >= limit:
        raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Rate limit exceeded")
    bucket.append(now)
