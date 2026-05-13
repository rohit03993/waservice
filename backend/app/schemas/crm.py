from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, Field

from app.schemas.campaign import MessagingWindowResponse


class TagCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=50)


class TagResponse(BaseModel):
    id: UUID
    name: str
    created_at: datetime


class ContactCreateRequest(BaseModel):
    phone_e164: str = Field(min_length=8, max_length=20)
    name: str | None = Field(default=None, max_length=120)
    custom_attributes: dict = Field(default_factory=dict)
    tag_ids: list[UUID] = Field(default_factory=list)


class ContactUpdateRequest(BaseModel):
    phone_e164: str | None = Field(default=None, min_length=8, max_length=20)
    name: str | None = Field(default=None, max_length=120)
    custom_attributes: dict | None = None
    tag_ids: list[UUID] | None = None


class ContactFilterRequest(BaseModel):
    query: str | None = None
    tag_ids: list[UUID] = Field(default_factory=list)
    custom_attribute_key: str | None = None
    custom_attribute_value: str | None = None


class ContactResponse(BaseModel):
    id: UUID
    phone_e164: str
    name: str | None
    custom_attributes: dict
    tags: list[TagResponse]
    created_at: datetime
    updated_at: datetime
    merged_with_existing: bool = False
    messaging_window: MessagingWindowResponse
