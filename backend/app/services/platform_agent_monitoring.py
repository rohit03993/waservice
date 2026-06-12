"""Read-only workspace metrics for super-admin client monitoring."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import case, func
from sqlalchemy.orm import Session

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.models.integration_api_key import IntegrationApiKey
from app.models.membership import Membership
from app.models.message import Message
from app.models.message_template import MessageTemplate
from app.models.tag import Tag
from app.models.tenant import Tenant
from app.models.user import User
from app.models.whatsapp_connection import WhatsAppConnection
from app.services.messaging_policy import CUSTOMER_SERVICE_WINDOW, build_messaging_window
from app.services.template_preview import build_template_preview_from_stored
from app.services.whatsapp_connection_health import evaluate_whatsapp_connection


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _today_start_utc() -> datetime:
    now = _utc_now()
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


def delete_agent_workspace(db: Session, tenant: Tenant) -> dict:
    """Delete tenant (cascade data) and orphan agent users with no other memberships."""
    memberships = db.query(Membership).filter(Membership.tenant_id == tenant.id).all()
    user_ids = [m.user_id for m in memberships]
    user_emails = [row.email for row in db.query(User).filter(User.id.in_(user_ids)).all()] if user_ids else []

    tenant_name = tenant.name
    tenant_slug = tenant.slug
    db.delete(tenant)
    db.flush()

    deleted_user_emails: list[str] = []
    for user_id in user_ids:
        if db.query(Membership).filter(Membership.user_id == user_id).count() == 0:
            user = db.query(User).filter(User.id == user_id).first()
            if user:
                deleted_user_emails.append(user.email)
                db.delete(user)

    db.commit()
    return {
        "tenant_name": tenant_name,
        "tenant_slug": tenant_slug,
        "deleted_user_emails": deleted_user_emails,
    }


async def build_agent_overview(db: Session, tenant: Tenant, agent: User) -> dict:
    tenant_id = tenant.id
    now = _utc_now()
    today_start = _today_start_utc()
    active_window_since = now - CUSTOMER_SERVICE_WINDOW
    messages_since = today_start - timedelta(days=13)

    connection = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.tenant_id == tenant_id)
        .order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc())
        .first()
    )
    meta_health = await evaluate_whatsapp_connection(connection)

    contacts_total = db.query(func.count(Contact.id)).filter(Contact.tenant_id == tenant_id).scalar() or 0
    conversations_total = (
        db.query(func.count(Conversation.id)).filter(Conversation.tenant_id == tenant_id).scalar() or 0
    )
    active_service_windows = (
        db.query(func.count(Contact.id))
        .filter(
            Contact.tenant_id == tenant_id,
            Contact.last_inbound_at.isnot(None),
            Contact.last_inbound_at > active_window_since,
        )
        .scalar()
        or 0
    )

    messages_total = db.query(func.count(Message.id)).filter(Message.tenant_id == tenant_id).scalar() or 0
    messages_inbound = (
        db.query(func.count(Message.id))
        .filter(Message.tenant_id == tenant_id, Message.direction == "inbound")
        .scalar()
        or 0
    )
    messages_outbound = (
        db.query(func.count(Message.id))
        .filter(Message.tenant_id == tenant_id, Message.direction == "outbound")
        .scalar()
        or 0
    )
    messages_sent_today = (
        db.query(func.count(Message.id))
        .filter(
            Message.tenant_id == tenant_id,
            Message.direction == "outbound",
            Message.created_at >= today_start,
        )
        .scalar()
        or 0
    )
    messages_received_today = (
        db.query(func.count(Message.id))
        .filter(
            Message.tenant_id == tenant_id,
            Message.direction == "inbound",
            Message.created_at >= today_start,
        )
        .scalar()
        or 0
    )

    day_col = func.date(Message.created_at)
    daily_rows = (
        db.query(
            day_col.label("day"),
            func.sum(case((Message.direction == "inbound", 1), else_=0)).label("inbound"),
            func.sum(case((Message.direction == "outbound", 1), else_=0)).label("outbound"),
        )
        .filter(Message.tenant_id == tenant_id, Message.created_at >= messages_since)
        .group_by(day_col)
        .order_by(day_col.asc())
        .all()
    )
    messages_by_day = [
        {
            "date": row.day.isoformat() if row.day else None,
            "inbound": int(row.inbound or 0),
            "outbound": int(row.outbound or 0),
        }
        for row in daily_rows
    ]

    templates = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.tenant_id == tenant_id)
        .order_by(MessageTemplate.name.asc(), MessageTemplate.language.asc())
        .all()
    )
    templates_approved = sum(1 for t in templates if (t.status or "").upper() == "APPROVED")
    templates_pending = sum(1 for t in templates if (t.status or "").upper() in {"PENDING", "IN_APPEAL"})
    templates_other = len(templates) - templates_approved - templates_pending

    campaigns = db.query(Campaign).filter(Campaign.tenant_id == tenant_id).all()
    campaigns_by_status: dict[str, int] = {}
    for campaign in campaigns:
        key = (campaign.status or "unknown").strip().lower()
        campaigns_by_status[key] = campaigns_by_status.get(key, 0) + 1

    campaign_recipients_sent = (
        db.query(func.count(CampaignRecipient.id))
        .join(Campaign, Campaign.id == CampaignRecipient.campaign_id)
        .filter(Campaign.tenant_id == tenant_id, CampaignRecipient.state == "sent")
        .scalar()
        or 0
    )

    tags_total = db.query(func.count(Tag.id)).filter(Tag.tenant_id == tenant_id).scalar() or 0
    integration_keys = (
        db.query(func.count(IntegrationApiKey.id)).filter(IntegrationApiKey.tenant_id == tenant_id).scalar() or 0
    )

    last_message_at = (
        db.query(func.max(Message.created_at)).filter(Message.tenant_id == tenant_id).scalar()
    )
    last_inbound_at = (
        db.query(func.max(Contact.last_inbound_at)).filter(Contact.tenant_id == tenant_id).scalar()
    )

    recent_conversations = (
        db.query(Conversation, Contact)
        .join(Contact, Contact.id == Conversation.contact_id)
        .filter(Conversation.tenant_id == tenant_id)
        .order_by(Conversation.updated_at.desc())
        .limit(12)
        .all()
    )

    return {
        "read_only": True,
        "tenant": {
            "id": str(tenant.id),
            "name": tenant.name,
            "slug": tenant.slug,
            "setup_status": tenant.setup_status,
            "created_at": tenant.created_at.isoformat(),
        },
        "agent": {
            "email": agent.email,
            "full_name": agent.full_name,
            "is_active": agent.is_active,
        },
        "meta_health": meta_health,
        "whatsapp": {
            "connections_count": db.query(func.count(WhatsAppConnection.id))
            .filter(WhatsAppConnection.tenant_id == tenant_id)
            .scalar()
            or 0,
            "phone_number_id": connection.phone_number_id if connection else None,
            "display_phone_number": meta_health.get("display_phone_number") if meta_health else None,
            "verified_name": meta_health.get("verified_name") if meta_health else None,
            "connection_label": connection.label if connection else None,
            "waba_id": connection.waba_id if connection else None,
        },
        "metrics": {
            "contacts_total": contacts_total,
            "conversations_total": conversations_total,
            "active_service_windows": active_service_windows,
            "messages_total": messages_total,
            "messages_inbound": messages_inbound,
            "messages_outbound": messages_outbound,
            "messages_sent_today": messages_sent_today,
            "messages_received_today": messages_received_today,
            "messages_by_day": messages_by_day,
            "templates_total": len(templates),
            "templates_approved": templates_approved,
            "templates_pending": templates_pending,
            "templates_other": templates_other,
            "campaigns_total": len(campaigns),
            "campaigns_by_status": campaigns_by_status,
            "campaign_recipients_sent": campaign_recipients_sent,
            "tags_total": tags_total,
            "integration_keys": integration_keys,
            "last_message_at": last_message_at.isoformat() if last_message_at else None,
            "last_inbound_at": last_inbound_at.isoformat() if last_inbound_at else None,
        },
        "templates": [
            {
                "id": str(item.id),
                "name": item.name,
                "language": item.language,
                "category": item.category,
                "status": item.status,
                "preview_text": build_template_preview_from_stored(item.components),
            }
            for item in templates
        ],
        "recent_conversations": [
            {
                "conversation_id": str(conversation.id),
                "contact_id": str(contact.id),
                "contact_name": contact.name,
                "phone_e164": contact.phone_e164,
                "updated_at": conversation.updated_at.isoformat(),
                "messaging_window": build_messaging_window(contact.last_inbound_at),
            }
            for conversation, contact in recent_conversations
        ],
    }


def list_agent_conversations(
    db: Session,
    tenant_id: UUID,
    *,
    limit: int = 50,
    offset: int = 0,
) -> dict:
    base = (
        db.query(Conversation, Contact)
        .join(Contact, Contact.id == Conversation.contact_id)
        .filter(Conversation.tenant_id == tenant_id)
    )
    total = base.count()
    rows = base.order_by(Conversation.updated_at.desc()).offset(offset).limit(limit).all()
    return {
        "total": total,
        "items": [
            {
                "conversation_id": str(conversation.id),
                "contact_id": str(contact.id),
                "contact_name": contact.name,
                "phone_e164": contact.phone_e164,
                "updated_at": conversation.updated_at.isoformat(),
                "last_inbound_at": contact.last_inbound_at.isoformat() if contact.last_inbound_at else None,
                "messaging_window": build_messaging_window(contact.last_inbound_at),
            }
            for conversation, contact in rows
        ],
    }


def list_agent_conversation_messages(
    db: Session,
    tenant_id: UUID,
    conversation_id: UUID,
    *,
    limit: int = 100,
) -> list[dict]:
    messages = (
        db.query(Message)
        .filter(Message.tenant_id == tenant_id, Message.conversation_id == conversation_id)
        .order_by(Message.created_at.desc())
        .limit(limit)
        .all()
    )
    messages.reverse()
    out: list[dict] = []
    for item in messages:
        payload = dict(item.payload or {})
        if item.type == "template" and not payload.get("preview_text"):
            name = payload.get("template_name")
            lang = payload.get("language_code")
            if isinstance(name, str) and isinstance(lang, str):
                row = (
                    db.query(MessageTemplate)
                    .filter(
                        MessageTemplate.tenant_id == tenant_id,
                        MessageTemplate.name == name.strip(),
                        MessageTemplate.language == lang.strip(),
                    )
                    .first()
                )
                if row:
                    prev = build_template_preview_from_stored(row.components)
                    if prev:
                        payload["preview_text"] = prev
        out.append(
            {
                "id": str(item.id),
                "direction": item.direction,
                "type": item.type,
                "status": item.status,
                "payload": payload,
                "created_at": item.created_at.isoformat(),
            }
        )
    return out
