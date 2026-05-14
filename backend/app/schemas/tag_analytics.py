from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class TagPerformanceRow(BaseModel):
    tag_id: UUID
    tag_name: str
    contact_count: int
    messages_sent: int
    messages_failed: int
    messages_pending: int
    estimated_cost_inr: float
    currency: str = "INR"


class TagPerformanceResponse(BaseModel):
    fetched_at: datetime
    start_ts: int | None = None
    end_ts: int | None = None
    summary_messages_sent: int
    summary_messages_failed: int
    summary_estimated_cost_inr: float
    currency: str = "INR"
    disclaimer: str
    tags: list[TagPerformanceRow] = Field(default_factory=list)
