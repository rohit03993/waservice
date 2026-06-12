"""Trigger sends on API-type campaigns (AiSensy-style API campaigns)."""

from __future__ import annotations

from uuid import UUID, uuid4

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.phone import normalize_phone_e164
from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.message_template import MessageTemplate
from app.services.messaging_policy import build_template_body_parameters
from app.services.template_preview import body_template_variables


def trigger_api_campaign_send(
    *,
    db: Session,
    tenant_id: UUID,
    campaign: Campaign,
    to_phone_e164: str,
    contact_name: str | None = None,
    body_parameters: list[dict] | None = None,
) -> CampaignRecipient:
    if campaign.campaign_type != "api":
        raise ValueError("This campaign is not an API campaign")
    if campaign.status != "live":
        raise ValueError("API campaign is not live. Set it live from the Campaigns dashboard first.")

    normalized = normalize_phone_e164(to_phone_e164)
    if not normalized:
        raise ValueError("Invalid phone number")

    contact = (
        db.query(Contact)
        .filter(and_(Contact.tenant_id == tenant_id, Contact.phone_e164 == normalized))
        .first()
    )
    if not contact:
        contact = Contact(
            id=uuid4(),
            tenant_id=tenant_id,
            phone_e164=normalized,
            name=(contact_name or "").strip() or None,
            custom_attributes={},
        )
        db.add(contact)
        db.flush()
    elif contact_name and not contact.name:
        contact.name = contact_name.strip()

    stored_vars: list[dict] | None = None
    if body_parameters:
        stored_vars = [item for item in body_parameters if isinstance(item, dict)]
    elif campaign.template_name and campaign.template_language:
        tmpl = (
            db.query(MessageTemplate)
            .filter(
                MessageTemplate.tenant_id == tenant_id,
                MessageTemplate.name == campaign.template_name.strip(),
                MessageTemplate.language == campaign.template_language.strip(),
            )
            .first()
        )
        if tmpl:
            var_keys = body_template_variables(tmpl.components)
            stored_vars = build_template_body_parameters(var_keys, contact_name=contact.name)

    existing = (
        db.query(CampaignRecipient)
        .filter(
            CampaignRecipient.campaign_id == campaign.id,
            CampaignRecipient.contact_id == contact.id,
        )
        .first()
    )
    if existing:
        # API campaigns may trigger many times for the same parent phone (daily attendance).
        existing.state = "queued"
        existing.template_variables = stored_vars
        existing.last_error = None
        existing.next_retry_at = None
        existing.attempts = 0
        db.flush()
        return existing

    recipient = CampaignRecipient(
        campaign_id=campaign.id,
        contact_id=contact.id,
        state="queued",
        template_variables=stored_vars,
        last_error=None,
        next_retry_at=None,
    )
    db.add(recipient)
    db.flush()
    return recipient
