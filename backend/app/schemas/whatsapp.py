from typing import Literal

from pydantic import BaseModel, Field


class TemplateSendBodyParameter(BaseModel):
    """One body variable for Cloud API template send (positional or named)."""

    type: Literal["text"] = "text"
    text: str = Field(min_length=1, max_length=4096)
    parameter_name: str | None = Field(default=None, max_length=80)


def template_body_parameters_to_meta_components(params: list[TemplateSendBodyParameter] | None) -> list[dict] | None:
    if not params:
        return None
    plist: list[dict] = []
    for p in params:
        d: dict = {"type": "text", "text": p.text}
        if p.parameter_name and str(p.parameter_name).strip():
            d["parameter_name"] = str(p.parameter_name).strip()
        plist.append(d)
    return [{"type": "body", "parameters": plist}]


class WhatsAppConnectionUpsertRequest(BaseModel):
    connection_id: str | None = None
    label: str = Field(default="Primary", min_length=1, max_length=120)
    phone_number_id: str = Field(min_length=5, max_length=64)
    access_token: str | None = Field(default=None, min_length=20, max_length=1024)
    verify_token: str | None = Field(default=None, min_length=4, max_length=255)
    waba_id: str | None = Field(default=None, max_length=64)
    app_secret: str | None = Field(default=None, max_length=255)
    is_default: bool = False
    is_active: bool = True


class WhatsAppConnectionResponse(BaseModel):
    id: str
    label: str
    phone_number_id: str
    waba_id: str | None
    verify_token_configured: bool
    app_secret_configured: bool
    access_token_preview: str
    is_default: bool
    is_active: bool


class WhatsAppTemplateSendRequest(BaseModel):
    connection_id: str | None = None
    to_phone_e164: str = Field(min_length=8, max_length=20)
    template_name: str = Field(min_length=1, max_length=120)
    language_code: str = Field(default="en_US", min_length=2, max_length=20)
    body_parameters: list[TemplateSendBodyParameter] | None = None


class WhatsAppTemplateSendResponse(BaseModel):
    success: bool
    message_id: str | None = None


class WhatsAppTextReplyRequest(BaseModel):
    connection_id: str | None = None
    conversation_id: str
    to_phone_e164: str = Field(min_length=8, max_length=20)
    text: str = Field(min_length=1, max_length=4096)


class TemplateItemResponse(BaseModel):
    id: str
    name: str
    language: str
    category: str | None
    status: str | None
    preview_text: str | None = None
    body_variables: list[str] = Field(default_factory=list)


class BodyVariableExample(BaseModel):
    """Sample value for a template variable (positional {{1}} or named {{order_id}})."""

    param_name: str = Field(min_length=1, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    example: str = Field(min_length=1, max_length=256)


class WhatsAppTemplateCreateRequest(BaseModel):
    name: str = Field(min_length=3, max_length=64, pattern=r"^[a-z][a-z0-9_]*$")
    language: str = Field(min_length=2, max_length=20)
    category: Literal["UTILITY", "MARKETING", "AUTHENTICATION"] = "UTILITY"
    body_text: str = Field(min_length=1, max_length=1024)
    header_text: str | None = Field(default=None, max_length=60)
    footer_text: str | None = Field(default=None, max_length=60)
    body_variables: list[BodyVariableExample] | None = Field(
        default=None,
        description="One entry per unique variable, in left-to-right order of first appearance in body_text.",
    )
    body_examples_csv: str | None = Field(
        default=None,
        max_length=2000,
        description="Legacy: comma-separated sample values for each unique {{n}} in left-to-right order (positional templates only).",
    )
    allow_category_change: bool = True


class WhatsAppTemplateCreateResponse(BaseModel):
    success: bool
    status: str | None = None
    category: str | None = None
