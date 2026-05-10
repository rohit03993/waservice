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
from app.services.campaign_dispatch import queue_due_scheduled_campaigns
from app.services.connection_resolver import resolve_active_connection
from app.services.meta_client import MetaClient
from app.services.queue import enqueue_campaign_job_with_delay, move_due_delayed_jobs, pop_campaign_job

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

        connection = resolve_active_connection(db=db, tenant_id=tenant_id)
        recipient.state = "processing"
        db.commit()

        try:
            response = asyncio.run(
                MetaClient.send_text_message(
                    phone_number_id=connection.phone_number_id,
                    access_token=decrypt_secret(connection.access_token) or "",
                    to_phone_e164=contact.phone_e164,
                    text=campaign.message_text,
                )
            )
            message_id = None
            if isinstance(response.get("messages"), list) and response["messages"]:
                message_id = response["messages"][0].get("id")

            recipient.state = "sent"
            recipient.message_id = message_id
            recipient.sent_at = datetime.now(timezone.utc)
            recipient.last_error = None
            recipient.next_retry_at = None

            conversation = _get_or_create_conversation(db, tenant_id=tenant_id, contact_id=contact.id)
            if message_id:
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
                            payload={"text": campaign.message_text, "meta_response": response},
                        )
                    )

            if all(item.state in {"sent", "failed"} for item in campaign.recipients):
                campaign.status = "completed"
            db.commit()
        except Exception as exc:  # noqa: BLE001
            recipient.attempts = (recipient.attempts or 0) + 1
            recipient.last_error = str(exc)[:500]
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
                if all(item.state in {"sent", "failed"} for item in campaign.recipients):
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
