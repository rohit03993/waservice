"""AiSensy-compatible API campaign trigger (drop-in for legacy CRM integrations)."""

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class AiSensyCampaignTriggerRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    apiKey: str = Field(min_length=1, description="waservice integration key (wsk.<id>.<secret>)")
    campaignName: str = Field(min_length=1, max_length=120)
    destination: str = Field(min_length=8, max_length=20)
    userName: str | None = Field(default=None, max_length=120)
    templateParams: list[Any] | None = Field(default=None)
    source: str | None = Field(default=None, max_length=200)
    tags: list[str] | None = None
    attributes: dict[str, Any] | None = None
    media: dict[str, Any] | None = None


class AiSensyCampaignTriggerResponse(BaseModel):
    success: bool = True
    message: str = "Campaign triggered successfully"
    campaign_id: str | None = None
    recipient_id: str | None = None
