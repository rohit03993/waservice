"""Shared outbound WhatsApp send + inbox persistence (templates, session text)."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session

from app.core.phone import normalize_phone_e164
from app.core.secrets import decrypt_secret
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_template import MessageTemplate
from app.services.connection_resolver import resolve_active_connection
from app.services.meta_client import MetaClient
from app.services.template_preview import build_template_preview_from_stored


@dataclass
class SendTemplateResult:
    message_id: str | None
    meta_response: dict
    preview_text: str | None


async def send_whatsapp_template_message(
    db: Session,
    tenant_id: UUID,
    *,
    to_phone_e164: str,
    template_name: str,
    language_code: str,
    connection_id: str | None = None,
    template_components: list[dict] | None = None,
) -> SendTemplateResult:
    connection = resolve_active_connection(db=db, tenant_id=tenant_id, connection_id=connection_id)
    to_e164 = normalize_phone_e164(to_phone_e164)
    data = await MetaClient.send_template_message(
        phone_number_id=connection.phone_number_id,
        access_token=decrypt_secret(connection.access_token) or "",
        to_phone_e164=to_e164,
        template_name=template_name.strip(),
        language_code=language_code.strip(),
        template_components=template_components,
    )
    message_id = None
    if isinstance(data.get("messages"), list) and data["messages"]:
        message_id = data["messages"][0].get("id")

    tmpl_row = (
        db.query(MessageTemplate)
        .filter(
            MessageTemplate.tenant_id == tenant_id,
            MessageTemplate.name == template_name.strip(),
            MessageTemplate.language == language_code.strip(),
        )
        .first()
    )
    preview_text = build_template_preview_from_stored(tmpl_row.components) if tmpl_row else None

    if message_id:
        contact = (
            db.query(Contact).filter(Contact.tenant_id == tenant_id, Contact.phone_e164 == to_e164).first()
        )
        if not contact:
            contact = Contact(
                tenant_id=tenant_id,
                phone_e164=to_e164,
                name=None,
                custom_attributes={},
            )
            db.add(contact)
            db.flush()

        conversation = (
            db.query(Conversation)
            .filter(Conversation.tenant_id == tenant_id, Conversation.contact_id == contact.id)
            .first()
        )
        if not conversation:
            conversation = Conversation(tenant_id=tenant_id, contact_id=contact.id)
            db.add(conversation)
            db.flush()

        conversation.updated_at = datetime.now(timezone.utc)

        existing = db.query(Message).filter(Message.tenant_id == tenant_id, Message.wamid == message_id).first()
        if not existing:
            db.add(
                Message(
                    tenant_id=tenant_id,
                    conversation_id=conversation.id,
                    contact_id=contact.id,
                    direction="outbound",
                    wamid=message_id,
                    type="template",
                    status="sent",
                    payload={
                        "template_name": template_name.strip(),
                        "language_code": language_code.strip(),
                        "preview_text": preview_text,
                        "meta_response": data,
                    },
                )
            )

    return SendTemplateResult(message_id=message_id, meta_response=data, preview_text=preview_text)


@dataclass
class SendTextResult:
    message_id: str | None
    meta_response: dict


async def send_whatsapp_text_message(
    db: Session,
    tenant_id: UUID,
    *,
    to_phone_e164: str,
    text: str,
    connection_id: str | None = None,
) -> SendTextResult:
    """Session message (plain text). Requires an open customer service window per Meta rules."""
    connection = resolve_active_connection(db=db, tenant_id=tenant_id, connection_id=connection_id)
    to_e164 = normalize_phone_e164(to_phone_e164)
    data = await MetaClient.send_text_message(
        phone_number_id=connection.phone_number_id,
        access_token=decrypt_secret(connection.access_token) or "",
        to_phone_e164=to_e164,
        text=text,
    )
    message_id = None
    if isinstance(data.get("messages"), list) and data["messages"]:
        message_id = data["messages"][0].get("id")

    if message_id:
        contact = db.query(Contact).filter(Contact.tenant_id == tenant_id, Contact.phone_e164 == to_e164).first()
        if not contact:
            contact = Contact(
                tenant_id=tenant_id,
                phone_e164=to_e164,
                name=None,
                custom_attributes={},
            )
            db.add(contact)
            db.flush()

        conversation = (
            db.query(Conversation)
            .filter(Conversation.tenant_id == tenant_id, Conversation.contact_id == contact.id)
            .first()
        )
        if not conversation:
            conversation = Conversation(tenant_id=tenant_id, contact_id=contact.id)
            db.add(conversation)
            db.flush()

        conversation.updated_at = datetime.now(timezone.utc)

        existing = db.query(Message).filter(Message.tenant_id == tenant_id, Message.wamid == message_id).first()
        if not existing:
            db.add(
                Message(
                    tenant_id=tenant_id,
                    conversation_id=conversation.id,
                    contact_id=contact.id,
                    direction="outbound",
                    wamid=message_id,
                    type="text",
                    status="sent",
                    payload={"text": text, "meta_response": data},
                )
            )

    return SendTextResult(message_id=message_id, meta_response=data)
