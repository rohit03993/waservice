from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field


class CampaignCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    message_text: str = Field(min_length=1, max_length=1000)
    contact_ids: list[UUID] = Field(default_factory=list)
    scheduled_at: datetime | None = None


class CampaignRecipientResponse(BaseModel):
    id: UUID
    contact_id: UUID
    state: str
    created_at: datetime


class CampaignResponse(BaseModel):
    id: UUID
    name: str
    message_text: str
    status: str
    scheduled_at: datetime | None
    created_at: datetime
    updated_at: datetime
    recipients: list[CampaignRecipientResponse]


class CampaignStartResponse(BaseModel):
    campaign_id: UUID
    status: str
    queued_count: int
