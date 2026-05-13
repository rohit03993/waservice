from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.orm import Session, joinedload

from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.services.queue import enqueue_campaign_job


def queue_single_campaign_recipient(
    *,
    db: Session,
    campaign: Campaign,
    recipient: CampaignRecipient,
    tenant_id: UUID,
) -> None:
    recipient.state = "queued"
    recipient.last_error = None
    recipient.next_retry_at = None
    if campaign.campaign_type != "api" and campaign.status not in {"running", "completed"}:
        campaign.status = "running"
    db.commit()
    enqueue_campaign_job(campaign_id=campaign.id, recipient_id=recipient.id, tenant_id=tenant_id)


def queue_campaign_recipients(*, db: Session, campaign: Campaign, tenant_id: UUID) -> int:
    if campaign.status == "completed":
        return 0

    campaign.status = "running"
    queued_recipients: list[CampaignRecipient] = []
    for recipient in campaign.recipients:
        if recipient.state in {"pending", "retry_scheduled"}:
            recipient.state = "queued"
            recipient.last_error = None
            recipient.next_retry_at = None
            queued_recipients.append(recipient)
    db.commit()

    for recipient in queued_recipients:
        enqueue_campaign_job(campaign_id=campaign.id, recipient_id=recipient.id, tenant_id=tenant_id)
    return len(queued_recipients)


def queue_due_scheduled_campaigns(*, db: Session, now: datetime | None = None) -> int:
    current_time = now or datetime.now(timezone.utc)
    due_campaigns = (
        db.query(Campaign)
        .options(joinedload(Campaign.recipients))
        .filter(
            Campaign.status == "scheduled",
            Campaign.scheduled_at.is_not(None),
            Campaign.scheduled_at <= current_time,
        )
        .order_by(Campaign.scheduled_at.asc())
        .all()
    )

    started = 0
    for campaign in due_campaigns:
        queued = queue_campaign_recipients(db=db, campaign=campaign, tenant_id=campaign.tenant_id)
        if queued > 0:
            started += 1
    return started
