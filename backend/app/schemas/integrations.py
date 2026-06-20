from pydantic import BaseModel, Field

from app.schemas.whatsapp import TemplateSendBodyParameter


class IntegrationSendTemplateRequest(BaseModel):
    """External CRM: send an approved WhatsApp template."""

    to_phone_e164: str = Field(min_length=8, max_length=20)
    template_name: str = Field(min_length=1, max_length=120)
    language_code: str = Field(default="en_US", min_length=2, max_length=20)
    body_parameters: list[TemplateSendBodyParameter] | None = Field(
        default=None,
        description="For templates with variables: use parameter_name for named templates, omit for positional order.",
    )


class IntegrationSendTemplateResponse(BaseModel):
    success: bool
    message_id: str | None = None


class IntegrationSendTextRequest(BaseModel):
    """Session message (plain text). Only works inside Meta's customer service window unless user messaged you recently."""

    to_phone_e164: str = Field(min_length=8, max_length=20)
    text: str = Field(min_length=1, max_length=4096)


class IntegrationSendTextResponse(BaseModel):
    success: bool
    message_id: str | None = None


class IntegrationApiCampaignTriggerRequest(BaseModel):
    """Trigger a send on a live API campaign (AiSensy-style)."""

    to_phone_e164: str = Field(min_length=8, max_length=20)
    name: str | None = Field(default=None, max_length=120, description="Optional contact name for new numbers")
    body_parameters: list[TemplateSendBodyParameter] | None = Field(
        default=None,
        description="Override template variables; otherwise contact name is used for each slot.",
    )


class IntegrationApiCampaignTriggerResponse(BaseModel):
    success: bool
    campaign_id: str
    recipient_id: str
    queued: bool = True


class IntegrationApiKeyCreateRequest(BaseModel):
    label: str | None = Field(default=None, max_length=120)


class IntegrationApiKeyCreateResponse(BaseModel):
    id: str
    api_key: str
    label: str | None
    message: str = "Store this key securely; it cannot be shown again."


class IntegrationApiKeyListItem(BaseModel):
    id: str
    label: str | None
    is_active: bool
    created_at: str


class IntegrationTemplateItem(BaseModel):
    """Read-only template metadata for external CRM sync (integration key auth)."""

    id: str
    name: str
    language: str
    category: str | None = None
    status: str | None = None
    preview_text: str | None = None
    body_variables: list[str] = Field(default_factory=list)
    param_count: int = 0


class IntegrationApiCampaignItem(BaseModel):
    """Read-only live API campaign metadata for external CRM sync (integration key auth)."""

    id: str
    name: str
    status: str
    campaign_type: str
    template_name: str | None = None
    template_language: str | None = None
    preview_text: str | None = None
    body_variables: list[str] = Field(default_factory=list)
    param_count: int = 0
