from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field, model_validator


class MessagingWindowResponse(BaseModel):
    is_open: bool
    last_inbound_at: datetime | None = None
    expires_at: datetime | None = None
    seconds_remaining: int | None = None
    can_send_session: bool
    can_send_template: bool = True
    session_hint: str


class CampaignCreateRequest(BaseModel):
    name: str = Field(min_length=2, max_length=120)
    template_name: str = Field(min_length=1, max_length=120)
    template_language: str = Field(default="en_US", min_length=2, max_length=20)
    campaign_type: str = Field(
        default="contacts",
        description="contacts = pick CRM contacts; csv = upload CSV recipients; api = external systems trigger sends",
    )
    contact_ids: list[UUID] = Field(default_factory=list)
    tag_ids: list[UUID] = Field(
        default_factory=list,
        description="For contact broadcasts: include every CRM contact that has any of these tags.",
    )
    template_variable_defaults: dict[str, str] | None = Field(
        default=None,
        description="Default values for template body variables (broadcast); name-like keys still per-contact unless set.",
    )
    scheduled_at: datetime | None = None
    message_text: str | None = Field(default=None, max_length=1000)

    @model_validator(mode="after")
    def validate_campaign(self) -> "CampaignCreateRequest":
        campaign_type = (self.campaign_type or "contacts").strip().lower()
        if campaign_type not in {"contacts", "csv", "api"}:
            raise ValueError("campaign_type must be contacts, csv, or api")
        if not self.template_name.strip():
            raise ValueError("template_name is required for WhatsApp broadcast campaigns")
        if campaign_type == "contacts" and not self.contact_ids and not self.tag_ids:
            raise ValueError("Select at least one contact or tag for a contact broadcast campaign")
        if campaign_type in {"csv", "api"} and (self.contact_ids or self.tag_ids):
            raise ValueError("contact_ids and tag_ids are not used for csv or api campaigns; import CSV or use the API trigger")
        self.campaign_type = campaign_type
        return self


class CampaignRecipientResponse(BaseModel):
    id: UUID
    contact_id: UUID
    state: str
    last_error: str | None = None
    sent_at: datetime | None = None
    created_at: datetime


class CampaignCostEstimateResponse(BaseModel):
    recipient_count: int
    billable_messages: int
    open_window_free_messages: int = 0
    rate_per_message_inr: float
    estimated_total_inr: float
    currency: str = "INR"
    template_category: str | None = None
    pricing_model: str = "per_message"
    rate_note: str
    disclaimer: str


class CampaignResponse(BaseModel):
    id: UUID
    name: str
    campaign_type: str
    template_name: str | None
    template_language: str | None
    message_text: str | None
    status: str
    scheduled_at: datetime | None
    created_at: datetime
    updated_at: datetime
    recipients: list[CampaignRecipientResponse]
    cost_estimate: CampaignCostEstimateResponse | None = None


class CampaignStartResponse(BaseModel):
    campaign_id: UUID
    status: str
    queued_count: int


class CampaignGoLiveResponse(BaseModel):
    campaign_id: UUID
    status: str
    message: str


class CampaignImportCsvResponse(BaseModel):
    campaign_id: UUID
    added_recipients: int
    created_contacts: int
    skipped_rows: int
