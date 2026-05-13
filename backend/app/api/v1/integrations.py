"""Server-to-server API for external CRMs (X-Integration-Key auth)."""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.api.integration_deps import IntegrationAuthContext, get_integration_auth
from app.core.rate_limit import check_rate_limit
from app.db.session import get_db
from app.models.campaign import Campaign
from app.schemas.integrations import (
    IntegrationApiCampaignTriggerRequest,
    IntegrationApiCampaignTriggerResponse,
    IntegrationSendTemplateRequest,
    IntegrationSendTemplateResponse,
    IntegrationSendTextRequest,
    IntegrationSendTextResponse,
)
from app.schemas.whatsapp import template_body_parameters_to_meta_components
from app.services.api_campaign import trigger_api_campaign_send
from app.services.audit import log_admin_action
from app.services.outbound_whatsapp import send_whatsapp_template_message, send_whatsapp_text_message

router = APIRouter(prefix="/integrations", tags=["integrations"])


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
    comps = template_body_parameters_to_meta_components(payload.body_parameters)
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
    return IntegrationApiCampaignTriggerResponse(
        success=True,
        campaign_id=str(campaign.id),
        recipient_id=str(recipient.id),
        queued=True,
    )
