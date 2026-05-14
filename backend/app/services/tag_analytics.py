from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy import and_, func
from sqlalchemy.orm import Session

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.message_template import MessageTemplate
from app.models.tag import Tag
from app.services.campaign_pricing import rate_inr_per_message

_SENT_STATES = frozenset({"sent"})
_FAILED_STATES = frozenset({"failed"})


def build_tag_performance(
    db: Session,
    *,
    tenant_id: UUID,
    start_ts: int | None = None,
    end_ts: int | None = None,
) -> dict:
    tags = db.query(Tag).filter(Tag.tenant_id == tenant_id).order_by(Tag.name.asc()).all()
    if not tags:
        return {
            "fetched_at": datetime.now(timezone.utc),
            "start_ts": start_ts,
            "end_ts": end_ts,
            "summary_messages_sent": 0,
            "summary_messages_failed": 0,
            "summary_estimated_cost_inr": 0.0,
            "currency": "INR",
            "disclaimer": (
                "Counts are from campaign sends linked to contacts that currently have each tag. "
                "A contact with multiple tags is counted once per tag. Cost is an India-reference estimate "
                "from template category rates, not Meta's official invoice."
            ),
            "tags": [],
        }

    tag_by_id = {tag.id: tag for tag in tags}

    contact_count_rows = (
        db.query(ContactTag.tag_id, func.count(ContactTag.contact_id))
        .join(Contact, Contact.id == ContactTag.contact_id)
        .filter(Contact.tenant_id == tenant_id)
        .group_by(ContactTag.tag_id)
        .all()
    )
    contact_counts = {tag_id: int(count) for tag_id, count in contact_count_rows}

    template_rows = db.query(MessageTemplate).filter(MessageTemplate.tenant_id == tenant_id).all()
    rate_by_template: dict[tuple[str, str], float] = {}
    for row in template_rows:
        key = (row.name.strip(), row.language.strip())
        rate_by_template[key] = rate_inr_per_message(row.category)

    recipient_query = (
        db.query(
            ContactTag.tag_id,
            CampaignRecipient.state,
            Campaign.template_name,
            Campaign.template_language,
            func.count(CampaignRecipient.id),
        )
        .select_from(ContactTag)
        .join(Contact, and_(Contact.id == ContactTag.contact_id, Contact.tenant_id == tenant_id))
        .join(CampaignRecipient, CampaignRecipient.contact_id == Contact.id)
        .join(Campaign, and_(Campaign.id == CampaignRecipient.campaign_id, Campaign.tenant_id == tenant_id))
        .filter(ContactTag.tag_id.in_(tag_by_id.keys()))
    )

    activity_at = func.coalesce(CampaignRecipient.sent_at, CampaignRecipient.created_at)
    if start_ts is not None:
        start_dt = datetime.fromtimestamp(start_ts, tz=timezone.utc)
        recipient_query = recipient_query.filter(activity_at >= start_dt)
    if end_ts is not None:
        end_dt = datetime.fromtimestamp(end_ts, tz=timezone.utc)
        recipient_query = recipient_query.filter(activity_at < end_dt)

    recipient_rows = recipient_query.group_by(
        ContactTag.tag_id,
        CampaignRecipient.state,
        Campaign.template_name,
        Campaign.template_language,
    ).all()

    stats: dict[UUID, dict] = {
        tag_id: {
            "messages_sent": 0,
            "messages_failed": 0,
            "messages_pending": 0,
            "estimated_cost_inr": 0.0,
        }
        for tag_id in tag_by_id
    }

    for tag_id, state, template_name, template_language, count in recipient_rows:
        if tag_id not in stats:
            continue
        qty = int(count)
        normalized_state = (state or "").strip().lower()
        if normalized_state in _SENT_STATES:
            stats[tag_id]["messages_sent"] += qty
            tpl_key = ((template_name or "").strip(), (template_language or "").strip())
            rate = rate_by_template.get(tpl_key, rate_inr_per_message(None))
            stats[tag_id]["estimated_cost_inr"] += qty * rate
        elif normalized_state in _FAILED_STATES:
            stats[tag_id]["messages_failed"] += qty
        else:
            stats[tag_id]["messages_pending"] += qty

    tag_rows = []
    summary_sent = 0
    summary_failed = 0
    summary_cost = 0.0
    for tag in tags:
        bucket = stats[tag.id]
        cost = round(bucket["estimated_cost_inr"], 2)
        tag_rows.append(
            {
                "tag_id": tag.id,
                "tag_name": tag.name,
                "contact_count": contact_counts.get(tag.id, 0),
                "messages_sent": bucket["messages_sent"],
                "messages_failed": bucket["messages_failed"],
                "messages_pending": bucket["messages_pending"],
                "estimated_cost_inr": cost,
                "currency": "INR",
            }
        )
        summary_sent += bucket["messages_sent"]
        summary_failed += bucket["messages_failed"]
        summary_cost += cost

    tag_rows.sort(key=lambda row: (-row["messages_sent"], row["tag_name"].lower()))

    return {
        "fetched_at": datetime.now(timezone.utc),
        "start_ts": start_ts,
        "end_ts": end_ts,
        "summary_messages_sent": summary_sent,
        "summary_messages_failed": summary_failed,
        "summary_estimated_cost_inr": round(summary_cost, 2),
        "currency": "INR",
        "disclaimer": (
            "Counts are from campaign sends linked to contacts that currently have each tag. "
            "A contact with multiple tags is counted once per tag. Cost is an India-reference estimate "
            "from template category rates, not Meta's official invoice."
        ),
        "tags": tag_rows,
    }
