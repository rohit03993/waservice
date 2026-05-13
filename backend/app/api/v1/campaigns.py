from uuid import UUID

import csv
import io
from datetime import datetime, timezone
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from sqlalchemy import and_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_admin_membership, get_admin_or_agent_membership
from app.core.phone import normalize_phone_e164
from app.db.session import get_db
from app.models.campaign import Campaign
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.membership import Membership
from app.models.message_template import MessageTemplate
from app.schemas.campaign import (
    CampaignCostEstimateResponse,
    CampaignCreateRequest,
    CampaignGoLiveResponse,
    CampaignImportCsvResponse,
    CampaignResponse,
    CampaignStartResponse,
)
from app.services.campaign_pricing import estimate_campaign_cost
from app.services.messaging_policy import (
    build_template_body_parameters,
    csv_row_template_overrides,
    merge_template_defaults_for_contact,
)
from app.services.template_preview import body_template_variables
from app.services.audit import log_admin_action
from app.services.campaign_dispatch import queue_campaign_recipients

router = APIRouter(prefix="/campaigns", tags=["campaigns"])

_MAX_CAMPAIGN_CSV_BYTES = 6 * 1024 * 1024


def _campaign_to_schema(campaign: Campaign, *, db: Session | None = None, tenant_id: UUID | None = None) -> CampaignResponse:
    cost_estimate = None
    if db and tenant_id and campaign.template_name and campaign.template_language:
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
            count = len(campaign.recipients) if campaign.recipients else (1 if campaign.campaign_type == "api" else 0)
            if count > 0:
                cost_estimate = CampaignCostEstimateResponse(
                    **estimate_campaign_cost(
                        template_category=tmpl.category,
                        recipient_count=count,
                    )
                )

    return CampaignResponse(
        id=campaign.id,
        name=campaign.name,
        campaign_type=campaign.campaign_type or "contacts",
        template_name=campaign.template_name,
        template_language=campaign.template_language,
        message_text=campaign.message_text,
        status=campaign.status,
        scheduled_at=campaign.scheduled_at,
        created_at=campaign.created_at,
        updated_at=campaign.updated_at,
        recipients=[
            {
                "id": recipient.id,
                "contact_id": recipient.contact_id,
                "state": recipient.state,
                "last_error": recipient.last_error,
                "sent_at": recipient.sent_at,
                "created_at": recipient.created_at,
            }
            for recipient in campaign.recipients
        ],
        cost_estimate=cost_estimate,
    )


def _resolve_approved_template(
    *,
    db: Session,
    tenant_id: UUID,
    template_name: str,
    template_language: str,
) -> MessageTemplate:
    name = template_name.strip()
    language = template_language.strip()
    row = (
        db.query(MessageTemplate)
        .filter(
            MessageTemplate.tenant_id == tenant_id,
            MessageTemplate.name == name,
            MessageTemplate.language == language,
        )
        .first()
    )
    if not row:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template '{name}' ({language}) not found. Sync templates from Meta first.",
        )
    if (row.status or "").upper() != "APPROVED":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Template '{name}' ({language}) is not APPROVED in Meta (status: {row.status or 'unknown'}).",
        )
    return row


@router.get("", response_model=list[CampaignResponse])
def list_campaigns(
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> list[CampaignResponse]:
    campaigns = (
        db.query(Campaign)
        .options(joinedload(Campaign.recipients))
        .filter(Campaign.tenant_id == membership.tenant_id)
        .order_by(Campaign.created_at.desc())
        .all()
    )
    return [_campaign_to_schema(campaign, db=db, tenant_id=membership.tenant_id) for campaign in campaigns]


@router.get("/estimate-cost", response_model=CampaignCostEstimateResponse)
def estimate_campaign_cost_endpoint(
    template_name: str = Query(..., min_length=1),
    template_language: str = Query(default="en_US"),
    recipient_count: int = Query(default=1, ge=0, le=5_000_000),
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> CampaignCostEstimateResponse:
    tmpl = (
        db.query(MessageTemplate)
        .filter(
            MessageTemplate.tenant_id == membership.tenant_id,
            MessageTemplate.name == template_name.strip(),
            MessageTemplate.language == template_language.strip(),
        )
        .first()
    )
    category = tmpl.category if tmpl else None
    return CampaignCostEstimateResponse(
        **estimate_campaign_cost(template_category=category, recipient_count=recipient_count)
    )


@router.post("", response_model=CampaignResponse, status_code=status.HTTP_201_CREATED)
def create_campaign(
    payload: CampaignCreateRequest,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> CampaignResponse:
    template_name = payload.template_name.strip()
    template_language = payload.template_language.strip()
    tmpl_row = _resolve_approved_template(
        db=db,
        tenant_id=membership.tenant_id,
        template_name=template_name,
        template_language=template_language,
    )
    body_var_keys = body_template_variables(tmpl_row.components)
    var_defaults = payload.template_variable_defaults or None

    campaign = Campaign(
        tenant_id=membership.tenant_id,
        name=payload.name.strip(),
        template_name=template_name,
        template_language=template_language,
        campaign_type=payload.campaign_type,
        default_template_variables=var_defaults,
        message_text=None,
        status="scheduled" if payload.scheduled_at else "draft",
        scheduled_at=payload.scheduled_at,
    )
    db.add(campaign)
    db.flush()

    if payload.contact_ids:
        contacts = (
            db.query(Contact)
            .filter(and_(Contact.tenant_id == membership.tenant_id, Contact.id.in_(payload.contact_ids)))
            .all()
        )
        contact_map = {contact.id: contact for contact in contacts}
        missing = [contact_id for contact_id in payload.contact_ids if contact_id not in contact_map]
        if missing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more contacts were not found")

        for contact_id in payload.contact_ids:
            contact = contact_map[contact_id]
            overrides = merge_template_defaults_for_contact(
                body_var_keys,
                contact_name=contact.name,
                defaults=var_defaults,
            )
            template_vars = (
                build_template_body_parameters(body_var_keys, contact_name=contact.name, overrides=overrides)
                if body_var_keys
                else None
            )
            db.add(
                CampaignRecipient(
                    campaign_id=campaign.id,
                    contact_id=contact_id,
                    state="pending",
                    template_variables=template_vars,
                )
            )

    db.commit()
    created = db.query(Campaign).options(joinedload(Campaign.recipients)).filter(Campaign.id == campaign.id).first()
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="campaign.create",
        resource_type="campaign",
        resource_id=str(campaign.id),
        details={
            "name": campaign.name,
            "template_name": template_name,
            "template_language": template_language,
            "recipient_count": len(campaign.recipients),
        },
    )
    db.commit()
    return _campaign_to_schema(created, db=db, tenant_id=membership.tenant_id)


@router.post("/{campaign_id}/start", response_model=CampaignStartResponse)
def start_campaign(
    campaign_id: UUID,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> CampaignStartResponse:
    campaign = (
        db.query(Campaign)
        .options(joinedload(Campaign.recipients))
        .filter(and_(Campaign.id == campaign_id, Campaign.tenant_id == membership.tenant_id))
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    if campaign.campaign_type == "api":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="API campaigns are triggered via the integration API. Use Go Live, then POST /integrations/campaigns/{campaign_id}/trigger.",
        )
    if not campaign.recipients:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Campaign has no recipients")
    if not campaign.template_name or not campaign.template_language:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This campaign has no WhatsApp template configured. Create a new campaign with an approved template.",
        )
    _resolve_approved_template(
        db=db,
        tenant_id=membership.tenant_id,
        template_name=campaign.template_name,
        template_language=campaign.template_language,
    )

    queued_count = queue_campaign_recipients(db=db, campaign=campaign, tenant_id=membership.tenant_id)
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="campaign.start",
        resource_type="campaign",
        resource_id=str(campaign.id),
        details={"queued_count": queued_count},
    )
    db.commit()
    return CampaignStartResponse(campaign_id=campaign.id, status=campaign.status, queued_count=queued_count)


@router.post("/{campaign_id}/go-live", response_model=CampaignGoLiveResponse)
def go_live_api_campaign(
    campaign_id: UUID,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> CampaignGoLiveResponse:
    campaign = (
        db.query(Campaign)
        .filter(and_(Campaign.id == campaign_id, Campaign.tenant_id == membership.tenant_id))
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    if campaign.campaign_type != "api":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only API campaigns can be set live")
    if not campaign.template_name or not campaign.template_language:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Campaign has no template configured")
    _resolve_approved_template(
        db=db,
        tenant_id=membership.tenant_id,
        template_name=campaign.template_name,
        template_language=campaign.template_language,
    )
    campaign.status = "live"
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="campaign.go_live",
        resource_type="campaign",
        resource_id=str(campaign.id),
        details={"campaign_type": "api"},
    )
    db.commit()
    return CampaignGoLiveResponse(
        campaign_id=campaign.id,
        status=campaign.status,
        message="API campaign is live. External systems can trigger sends via POST /integrations/campaigns/{campaign_id}/trigger.",
    )


@router.post("/{campaign_id}/import-csv", response_model=CampaignImportCsvResponse)
async def import_campaign_recipients_csv(
    campaign_id: UUID,
    file: UploadFile = File(...),
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> dict:
    campaign = (
        db.query(Campaign)
        .options(joinedload(Campaign.recipients))
        .filter(and_(Campaign.id == campaign_id, Campaign.tenant_id == membership.tenant_id))
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")
    if campaign.campaign_type != "csv":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV import is only for CSV broadcast campaigns",
        )

    tmpl_row: MessageTemplate | None = None
    body_var_keys: list[str] = []
    if campaign.template_name and campaign.template_language:
        tmpl_row = _resolve_approved_template(
            db=db,
            tenant_id=membership.tenant_id,
            template_name=campaign.template_name,
            template_language=campaign.template_language,
        )
        body_var_keys = body_template_variables(tmpl_row.components)

    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please upload a valid .csv file")

    content = await file.read()
    if len(content) > _MAX_CAMPAIGN_CSV_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"CSV too large (max {_MAX_CAMPAIGN_CSV_BYTES // (1024 * 1024)} MB)",
        )
    try:
        decoded = content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file must be UTF-8 encoded") from error

    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="CSV file is missing header row")

    header_map = {field.strip().lower(): field for field in reader.fieldnames if field}
    phone_col = header_map.get("phone_e164") or header_map.get("phone") or header_map.get("mobile")
    name_col = header_map.get("name")
    if not phone_col:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="CSV must include phone_e164 column (or phone/mobile)",
        )

    existing_contacts = db.query(Contact).filter(Contact.tenant_id == membership.tenant_id).all()
    by_phone = {item.phone_e164: item for item in existing_contacts}
    existing_recipient_contact_ids = {item.contact_id for item in campaign.recipients}

    added = 0
    created_contacts = 0
    skipped = 0
    for row in reader:
        raw_phone = (row.get(phone_col) or "").strip()
        normalized_phone = normalize_phone_e164(raw_phone) if raw_phone else ""
        raw_name = (row.get(name_col) or "").strip() if name_col else ""
        if not normalized_phone:
            skipped += 1
            continue

        contact = by_phone.get(normalized_phone)
        if not contact:
            contact = Contact(
                id=uuid4(),
                tenant_id=membership.tenant_id,
                phone_e164=normalized_phone,
                name=raw_name or None,
                custom_attributes={},
            )
            db.add(contact)
            db.flush()
            by_phone[normalized_phone] = contact
            created_contacts += 1
        elif raw_name and not contact.name:
            contact.name = raw_name

        overrides = csv_row_template_overrides(body_var_keys, row, header_map) if body_var_keys else {}
        if body_var_keys and campaign.default_template_variables:
            merged = merge_template_defaults_for_contact(
                body_var_keys,
                contact_name=contact.name,
                defaults=campaign.default_template_variables,
            )
            for key, val in merged.items():
                if key not in overrides or not overrides[key].strip():
                    overrides[key] = val
        template_vars = (
            build_template_body_parameters(body_var_keys, contact_name=contact.name, overrides=overrides)
            if body_var_keys
            else None
        )

        if contact.id in existing_recipient_contact_ids:
            skipped += 1
            continue

        db.add(
            CampaignRecipient(
                campaign_id=campaign.id,
                contact_id=contact.id,
                state="pending",
                template_variables=template_vars,
            )
        )
        existing_recipient_contact_ids.add(contact.id)
        added += 1

    if campaign.status == "draft" and campaign.scheduled_at and campaign.scheduled_at > datetime.now(timezone.utc):
        campaign.status = "scheduled"
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="campaign.import_csv",
        resource_type="campaign",
        resource_id=str(campaign.id),
        details={"added_recipients": added, "created_contacts": created_contacts, "skipped_rows": skipped},
    )
    db.commit()
    return CampaignImportCsvResponse(
        campaign_id=campaign.id,
        added_recipients=added,
        created_contacts=created_contacts,
        skipped_rows=skipped,
    )
