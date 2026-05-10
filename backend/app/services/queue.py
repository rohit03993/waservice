import json
from datetime import datetime, timezone
from uuid import UUID

import redis

from app.core.config import get_settings

QUEUE_KEY = "campaign_dispatch_queue"
DELAYED_KEY = "campaign_dispatch_delayed"


def _redis() -> redis.Redis:
    settings = get_settings()
    return redis.Redis.from_url(settings.redis_url, decode_responses=True)


def enqueue_campaign_job(*, campaign_id: UUID, recipient_id: UUID, tenant_id: UUID) -> None:
    payload = {
        "campaign_id": str(campaign_id),
        "recipient_id": str(recipient_id),
        "tenant_id": str(tenant_id),
    }
    _redis().rpush(QUEUE_KEY, json.dumps(payload))


def enqueue_campaign_job_with_delay(*, campaign_id: UUID, recipient_id: UUID, tenant_id: UUID, run_at: datetime) -> None:
    payload = {
        "campaign_id": str(campaign_id),
        "recipient_id": str(recipient_id),
        "tenant_id": str(tenant_id),
    }
    score = int(run_at.replace(tzinfo=timezone.utc).timestamp())
    _redis().zadd(DELAYED_KEY, {json.dumps(payload): score})


def pop_campaign_job(timeout_seconds: int = 5) -> dict | None:
    item = _redis().blpop(QUEUE_KEY, timeout=timeout_seconds)
    if not item:
        return None
    _, payload = item
    return json.loads(payload)


def move_due_delayed_jobs() -> int:
    client = _redis()
    now_ts = int(datetime.now(timezone.utc).timestamp())
    due = client.zrangebyscore(DELAYED_KEY, 0, now_ts)
    if not due:
        return 0
    pipeline = client.pipeline()
    for item in due:
        pipeline.rpush(QUEUE_KEY, item)
        pipeline.zrem(DELAYED_KEY, item)
    pipeline.execute()
    return len(due)
