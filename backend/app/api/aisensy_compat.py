"""
AiSensy-compatible HTTP API for legacy CRMs (e.g. attendance Taskbook).

Paths:
  POST /campaign/t1/api/v2
  POST /api/v1/campaign/t1/api/v2
  POST /api/v1  (Taskbook uses AISENSY_API_URL as the full endpoint URL)

Auth: apiKey in JSON body (use waservice wsk.<id>.<secret> from Integrations tab).
"""

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api.integration_deps import resolve_integration_auth
from app.core.rate_limit import check_rate_limit
from app.db.session import get_db
from app.schemas.aisensy_compat import AiSensyCampaignTriggerRequest, AiSensyCampaignTriggerResponse
from app.services.aisensy_compat import resolve_live_api_campaign, template_params_to_body_parameters
from app.services.api_campaign import trigger_api_campaign_send
from app.services.audit import log_admin_action

router = APIRouter(tags=["aisensy-compat"])


async def _handle_aisensy_campaign_trigger(
    payload: AiSensyCampaignTriggerRequest,
    request: Request,
    db: Session,
) -> AiSensyCampaignTriggerResponse:
    ctx = resolve_integration_auth(payload.apiKey, db)

    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(
        key=f"aisensy:trigger:{ctx.tenant_id}:{ctx.api_key_row.id}:{client_ip}",
        limit=120,
        window_seconds=60,
    )

    campaign = resolve_live_api_campaign(
        db=db,
        tenant_id=ctx.tenant_id,
        campaign_name=payload.campaignName,
    )
    if not campaign:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=(
                f"No live API campaign found for campaignName '{payload.campaignName}'. "
                "Create an API campaign in waservice, set it live, and use the same name or template name."
            ),
        )

    body_params = template_params_to_body_parameters(payload.templateParams)

    try:
        recipient = trigger_api_campaign_send(
            db=db,
            tenant_id=ctx.tenant_id,
            campaign=campaign,
            to_phone_e164=payload.destination,
            contact_name=payload.userName,
            body_parameters=body_params,
        )
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(error)) from error

    log_admin_action(
        db=db,
        tenant_id=ctx.tenant_id,
        actor_user_id=None,
        action="integrations.aisensy_compat.trigger",
        resource_type="campaign",
        resource_id=str(campaign.id),
        details={
            "aisensy_campaign_name": payload.campaignName,
            "destination": payload.destination,
            "recipient_id": str(recipient.id),
            "integration_key_id": str(ctx.api_key_row.id),
            "source": payload.source,
        },
    )
    db.commit()

    return AiSensyCampaignTriggerResponse(
        success=True,
        message="Campaign triggered successfully",
        campaign_id=str(campaign.id),
        recipient_id=str(recipient.id),
    )


@router.post("/campaign/t1/api/v2", response_model=AiSensyCampaignTriggerResponse)
async def aisensy_campaign_trigger(
    payload: AiSensyCampaignTriggerRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AiSensyCampaignTriggerResponse:
    """Drop-in replacement for AiSensy: base URL + /campaign/t1/api/v2."""
    return await _handle_aisensy_campaign_trigger(payload, request, db)


@router.post("", response_model=AiSensyCampaignTriggerResponse)
async def aisensy_campaign_trigger_api_v1_root(
    payload: AiSensyCampaignTriggerRequest,
    request: Request,
    db: Session = Depends(get_db),
) -> AiSensyCampaignTriggerResponse:
    """
    Taskbook (and some CRMs) POST directly to AISENSY_API_URL with no path suffix.

    Set AISENSY_API_URL=https://<host>/api/v1
    """
    return await _handle_aisensy_campaign_trigger(payload, request, db)
