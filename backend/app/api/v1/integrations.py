"""Server-to-server API for external CRMs (X-Integration-Key auth)."""

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.api.integration_deps import IntegrationAuthContext, get_integration_auth
from app.core.rate_limit import check_rate_limit
from app.db.session import get_db
from app.models.campaign import Campaign
from app.models.message_template import MessageTemplate
from app.schemas.integrations import (
    IntegrationApiCampaignItem,
    IntegrationApiCampaignTriggerRequest,
    IntegrationApiCampaignTriggerResponse,
    IntegrationSendTemplateRequest,
    IntegrationSendTemplateResponse,
    IntegrationSendTextRequest,
    IntegrationSendTextResponse,
    IntegrationTemplateItem,
)
from app.services.api_campaign import trigger_api_campaign_send
from app.services.audit import log_admin_action
from app.services.queue import enqueue_campaign_job
from app.services.outbound_whatsapp import send_whatsapp_template_message, send_whatsapp_text_message
from app.services.template_meta_components import build_meta_template_components
from app.services.template_preview import body_template_variables, build_template_preview_from_stored

router = APIRouter(prefix="/integrations", tags=["integrations"])


def _template_metadata(row: MessageTemplate | None) -> tuple[str | None, list[str], int]:
    if not row:
        return None, [], 0
    variables = body_template_variables(row.components)
    return build_template_preview_from_stored(row.components), variables, len(variables)


@router.get("/templates", response_model=list[IntegrationTemplateItem])
def integration_list_templates(
    request: Request,
    ctx: IntegrationAuthContext = Depends(get_integration_auth),
    db: Session = Depends(get_db),
    status_filter: str = Query(default="APPROVED", alias="status"),
    language: str | None = Query(default=None),
) -> list[IntegrationTemplateItem]:
    """
    List WhatsApp templates synced from Meta for this integration key's tenant.
    Auth: `X-Integration-Key: wsk.<key-id>.<secret>`.
    """
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(
        key=f"int:list-tpl:{ctx.tenant_id}:{ctx.api_key_row.id}:{client_ip}",
        limit=60,
        window_seconds=60,
    )
    query = db.query(MessageTemplate).filter(MessageTemplate.tenant_id == ctx.tenant_id)
    if status_filter.strip():
        query = query.filter(MessageTemplate.status == status_filter.strip().upper())
    if language and language.strip():
        query = query.filter(MessageTemplate.language == language.strip())
    rows = query.order_by(MessageTemplate.name.asc(), MessageTemplate.language.asc()).all()
    out: list[IntegrationTemplateItem] = []
    for row in rows:
        preview, variables, count = _template_metadata(row)
        out.append(
            IntegrationTemplateItem(
                id=str(row.id),
                name=row.name,
                language=row.language,
                category=row.category,
                status=row.status,
                preview_text=preview,
                body_variables=variables,
                param_count=count,
            )
        )
    return out


@router.get("/api-campaigns", response_model=list[IntegrationApiCampaignItem])
def integration_list_api_campaigns(
    request: Request,
    ctx: IntegrationAuthContext = Depends(get_integration_auth),
    db: Session = Depends(get_db),
    status_filter: str = Query(default="live", alias="status"),
) -> list[IntegrationApiCampaignItem]:
    """
    List live API campaigns triggerable by external CRMs (`campaignName` on AiSensy send).
    Auth: `X-Integration-Key: wsk.<key-id>.<secret>`.
    """
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(
        key=f"int:list-camp:{ctx.tenant_id}:{ctx.api_key_row.id}:{client_ip}",
        limit=60,
        window_seconds=60,
    )
    query = (
        db.query(Campaign)
        .filter(Campaign.tenant_id == ctx.tenant_id, Campaign.campaign_type == "api")
        .order_by(Campaign.name.asc())
    )
    if status_filter.strip():
        query = query.filter(Campaign.status == status_filter.strip().lower())
    campaigns = query.all()
    out: list[IntegrationApiCampaignItem] = []
    for campaign in campaigns:
        tmpl_row = None
        if campaign.template_name and campaign.template_language:
            tmpl_row = (
                db.query(MessageTemplate)
                .filter(
                    MessageTemplate.tenant_id == ctx.tenant_id,
                    MessageTemplate.name == campaign.template_name.strip(),
                    MessageTemplate.language == campaign.template_language.strip(),
                )
                .first()
            )
        preview, variables, count = _template_metadata(tmpl_row)
        out.append(
            IntegrationApiCampaignItem(
                id=str(campaign.id),
                name=campaign.name,
                status=campaign.status,
                campaign_type=campaign.campaign_type,
                template_name=campaign.template_name,
                template_language=campaign.template_language,
                preview_text=preview,
                body_variables=variables,
                param_count=count,
            )
        )
    return out


@router.post("/whatsapp/send-template", response_model=IntegrationSendTemplateResponse)
async def integration_send_template(
    payload: IntegrationSendTemplateRequest,
    request: Request,
    ctx: IntegrationAuthContext = Depends(get_integration_auth),
    db: Session = Depends(get_db),
) -> IntegrationSendTemplateResponse:
    """
    Send a WhatsApp **template** message using this tenant's default connection.
    Auth: `X-Integration-Key: wsk.<key-id>.<secret>` (create key via `POST /admin/integration-keys`).

    Optional `body_parameters`: for each variable, send `{"type":"text","text":"...","parameter_name":"foo"}`
    for **named** templates, or omit `parameter_name` for **positional** templates (order = first appearance in body).
    """
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(
        key=f"int:tpl:{ctx.tenant_id}:{ctx.api_key_row.id}:{client_ip}",
        limit=60,
        window_seconds=60,
    )
    tmpl_row = (
        db.query(MessageTemplate)
        .filter(
            MessageTemplate.tenant_id == ctx.tenant_id,
            MessageTemplate.name == payload.template_name.strip(),
            MessageTemplate.language == payload.language_code.strip(),
        )
        .first()
    )
    comps = build_meta_template_components(
        payload.body_parameters,
        category=tmpl_row.category if tmpl_row else None,
        components_wrapped=tmpl_row.components if tmpl_row else None,
    )
    try:
        result = await send_whatsapp_template_message(
            db,
            ctx.tenant_id,
            to_phone_e164=payload.to_phone_e164,
            template_name=payload.template_name,
            language_code=payload.language_code,
            connection_id=None,
            template_components=comps,
        )
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Meta send failed: {error}",
        ) from error

    log_admin_action(
        db=db,
        tenant_id=ctx.tenant_id,
        actor_user_id=None,
        action="integrations.whatsapp.send_template",
        resource_type="integration_api_key",
        resource_id=str(ctx.api_key_row.id),
        details={
            "to_phone_e164": payload.to_phone_e164,
            "template_name": payload.template_name,
            "message_id": result.message_id,
        },
    )
    db.commit()
    return IntegrationSendTemplateResponse(success=True, message_id=result.message_id)


@router.post("/whatsapp/send-text", response_model=IntegrationSendTextResponse)
async def integration_send_text(
    payload: IntegrationSendTextRequest,
    request: Request,
    ctx: IntegrationAuthContext = Depends(get_integration_auth),
    db: Session = Depends(get_db),
) -> IntegrationSendTextResponse:
    """
    Send a **session** text message (not a template). Meta only delivers this if the user is inside
    the messaging window (e.g. after they messaged you). Otherwise Meta returns an error.
    """
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(
        key=f"int:txt:{ctx.tenant_id}:{ctx.api_key_row.id}:{client_ip}",
        limit=120,
        window_seconds=60,
    )
    try:
        result = await send_whatsapp_text_message(
            db,
            ctx.tenant_id,
            to_phone_e164=payload.to_phone_e164,
            text=payload.text,
            connection_id=None,
        )
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Meta send failed: {error}",
        ) from error

    log_admin_action(
        db=db,
        tenant_id=ctx.tenant_id,
        actor_user_id=None,
        action="integrations.whatsapp.send_text",
        resource_type="integration_api_key",
        resource_id=str(ctx.api_key_row.id),
        details={"to_phone_e164": payload.to_phone_e164, "message_id": result.message_id},
    )
    db.commit()
    return IntegrationSendTextResponse(success=True, message_id=result.message_id)


@router.post(
    "/campaigns/{campaign_id}/trigger",
    response_model=IntegrationApiCampaignTriggerResponse,
)
async def integration_trigger_api_campaign(
    campaign_id: str,
    payload: IntegrationApiCampaignTriggerRequest,
    request: Request,
    ctx: IntegrationAuthContext = Depends(get_integration_auth),
    db: Session = Depends(get_db),
) -> IntegrationApiCampaignTriggerResponse:
    """
    Trigger a WhatsApp template send on a **live API campaign**.
    Create the campaign in the dashboard (type API), set it live, then call this endpoint
    from your CRM, website, or automation with `X-Integration-Key`.
    """
    from uuid import UUID

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(
        key=f"int:api-camp:{ctx.tenant_id}:{ctx.api_key_row.id}:{client_ip}",
        limit=120,
        window_seconds=60,
    )
    try:
        campaign_uuid = UUID(campaign_id)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid campaign_id") from error

    campaign = (
        db.query(Campaign)
        .filter(and_(Campaign.id == campaign_uuid, Campaign.tenant_id == ctx.tenant_id))
        .first()
    )
    if not campaign:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Campaign not found")

    body_params = None
    if payload.body_parameters:
        body_params = [item.model_dump(exclude_none=True) for item in payload.body_parameters]

    try:
        recipient = trigger_api_campaign_send(
            db=db,
            tenant_id=ctx.tenant_id,
            campaign=campaign,
            to_phone_e164=payload.to_phone_e164,
            contact_name=payload.name,
            body_parameters=body_params,
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    log_admin_action(
        db=db,
        tenant_id=ctx.tenant_id,
        actor_user_id=None,
        action="integrations.campaign.trigger",
        resource_type="campaign",
        resource_id=str(campaign.id),
        details={
            "to_phone_e164": payload.to_phone_e164,
            "recipient_id": str(recipient.id),
            "integration_key_id": str(ctx.api_key_row.id),
        },
    )
    db.commit()
    enqueue_campaign_job(campaign_id=campaign.id, recipient_id=recipient.id, tenant_id=ctx.tenant_id)
    return IntegrationApiCampaignTriggerResponse(
        success=True,
        campaign_id=str(campaign.id),
        recipient_id=str(recipient.id),
        queued=True,
    )
