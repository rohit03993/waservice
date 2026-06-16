import asyncio
from datetime import datetime, timedelta, timezone
from uuid import UUID

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.secrets import decrypt_secret
from app.db.session import SessionLocal
from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_template import MessageTemplate
from app.services.campaign_dispatch import queue_due_scheduled_campaigns
from app.services.connection_resolver import resolve_active_connection
from app.services.messaging_policy import (
    align_stored_template_parameters,
    build_template_body_parameters,
)
from app.services.meta_errors import format_meta_error
from app.services.outbound_whatsapp import send_whatsapp_template_message
from app.services.queue import enqueue_campaign_job_with_delay, move_due_delayed_jobs, pop_campaign_job
from app.services.template_meta_components import build_meta_template_components
from app.services.template_preview import body_template_variables

MAX_ATTEMPTS = 3


def _get_or_create_conversation(db: Session, *, tenant_id, contact_id) -> Conversation:
    conversation = (
        db.query(Conversation)
        .filter(Conversation.tenant_id == tenant_id, Conversation.contact_id == contact_id)
        .first()
    )
    if conversation:
        return conversation
    conversation = Conversation(tenant_id=tenant_id, contact_id=contact_id)
    db.add(conversation)
    db.flush()
    return conversation


def process_job(job: dict) -> None:
    db = SessionLocal()
    try:
        recipient_id = UUID(job["recipient_id"])
        campaign_id = UUID(job["campaign_id"])
        tenant_id = UUID(job["tenant_id"])

        recipient = (
            db.query(CampaignRecipient)
            .filter(and_(CampaignRecipient.id == recipient_id, CampaignRecipient.campaign_id == campaign_id))
            .first()
        )
        if not recipient:
            db.close()
            return

        campaign = db.query(Campaign).filter(Campaign.id == campaign_id, Campaign.tenant_id == tenant_id).first()
        contact = db.query(Contact).filter(Contact.id == recipient.contact_id, Contact.tenant_id == tenant_id).first()
        if not campaign or not contact:
            recipient.state = "failed"
            recipient.last_error = "Campaign or contact missing"
            db.commit()
            return

        if not campaign.template_name or not campaign.template_language:
            recipient.state = "failed"
            recipient.last_error = "Campaign has no WhatsApp template. Recreate the campaign with an approved template."
            db.commit()
            return

        tmpl_row = (
            db.query(MessageTemplate)
            .filter(
                MessageTemplate.tenant_id == tenant_id,
                MessageTemplate.name == campaign.template_name.strip(),
                MessageTemplate.language == campaign.template_language.strip(),
            )
            .first()
        )
        if not tmpl_row or (tmpl_row.status or "").upper() != "APPROVED":
            recipient.state = "failed"
            recipient.last_error = "Template not found or not APPROVED in Meta"
            db.commit()
            return

        connection = resolve_active_connection(db=db, tenant_id=tenant_id)
        recipient.state = "processing"
        db.commit()

        var_keys = body_template_variables(tmpl_row.components)
        stored = align_stored_template_parameters(recipient.template_variables, var_keys)
        raw_params = stored if stored else build_template_body_parameters(var_keys, contact_name=contact.name)
        from app.schemas.whatsapp import TemplateSendBodyParameter

        body_parameters = [
            TemplateSendBodyParameter(
                text=p["text"],
                parameter_name=p.get("parameter_name"),
            )
            for p in raw_params
        ]
        components = build_meta_template_components(
            body_parameters,
            category=tmpl_row.category,
            components_wrapped=tmpl_row.components,
        )

        try:
            result = asyncio.run(
                send_whatsapp_template_message(
                    db,
                    tenant_id,
                    to_phone_e164=contact.phone_e164,
                    template_name=campaign.template_name.strip(),
                    language_code=campaign.template_language.strip(),
                    connection_id=str(connection.id),
                    template_components=components,
                )
            )
            message_id = result.message_id

            recipient.state = "sent"
            recipient.message_id = message_id
            recipient.sent_at = datetime.now(timezone.utc)
            recipient.last_error = None
            recipient.next_retry_at = None

            if campaign.campaign_type != "api" and all(item.state in {"sent", "failed"} for item in campaign.recipients):
                campaign.status = "completed"
            db.commit()
        except Exception as exc:  # noqa: BLE001
            recipient.attempts = (recipient.attempts or 0) + 1
            recipient.last_error = format_meta_error(exc)[:500]
            if recipient.attempts < MAX_ATTEMPTS:
                delay_seconds = 30 * (2 ** (recipient.attempts - 1))
                next_retry = datetime.now(timezone.utc) + timedelta(seconds=delay_seconds)
                recipient.state = "retry_scheduled"
                recipient.next_retry_at = next_retry
                db.commit()
                enqueue_campaign_job_with_delay(
                    campaign_id=campaign_id,
                    recipient_id=recipient_id,
                    tenant_id=tenant_id,
                    run_at=next_retry,
                )
            else:
                recipient.state = "failed"
                recipient.next_retry_at = None
                if campaign.campaign_type != "api" and all(item.state in {"sent", "failed"} for item in campaign.recipients):
                    campaign.status = "completed"
                db.commit()
    finally:
        db.close()


def run_worker() -> None:
    print("Campaign worker started. Waiting for jobs...")
    while True:
        scheduler_db = SessionLocal()
        try:
            started = queue_due_scheduled_campaigns(db=scheduler_db)
            if started:
                print(f"Scheduler started {started} due campaign(s)")
        finally:
            scheduler_db.close()

        move_due_delayed_jobs()
        job = pop_campaign_job(timeout_seconds=5)
        if not job:
            continue
        try:
            process_job(job)
        except Exception as exc:  # noqa: BLE001
            print(f"Worker error while processing job: {exc}")


if __name__ == "__main__":
    run_worker()
