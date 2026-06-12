from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.orm import Session

from app.api.deps import get_admin_membership
from app.db.session import get_db
from app.models.audit_log import AuditLog
from app.models.integration_api_key import IntegrationApiKey
from app.models.membership import Membership
from app.schemas.integrations import (
    IntegrationApiKeyCreateRequest,
    IntegrationApiKeyCreateResponse,
    IntegrationApiKeyListItem,
)
from app.services.audit import log_admin_action
from app.services.external_crm_webhook import (
    deliver_external_crm_webhook,
    external_crm_webhook_configured,
    external_crm_webhook_status,
    sample_test_payload,
)
from app.services.integration_keys import generate_integration_api_key, hash_integration_secret

router = APIRouter(prefix="/admin", tags=["admin"])


@router.get("/audit-logs")
def list_audit_logs(
    limit: int = Query(default=100, ge=1, le=500),
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = (
        db.query(AuditLog)
        .filter(AuditLog.tenant_id == membership.tenant_id)
        .order_by(AuditLog.created_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": str(item.id),
            "action": item.action,
            "resource_type": item.resource_type,
            "resource_id": item.resource_id,
            "actor_user_id": str(item.actor_user_id) if item.actor_user_id else None,
            "details": item.details or {},
            "created_at": item.created_at.isoformat(),
        }
        for item in rows
    ]


@router.post("/integration-keys", response_model=IntegrationApiKeyCreateResponse)
def create_integration_key(
    payload: IntegrationApiKeyCreateRequest,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> IntegrationApiKeyCreateResponse:
    """Create a key for `X-Integration-Key` (server-to-server). The plaintext key is returned once."""
    key_id = uuid4()
    full_key, raw_secret = generate_integration_api_key(key_id=key_id)
    row = IntegrationApiKey(
        id=key_id,
        tenant_id=membership.tenant_id,
        label=payload.label.strip() if payload.label else None,
        key_hash=hash_integration_secret(raw_secret),
    )
    db.add(row)
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="admin.integration_key.create",
        resource_type="integration_api_key",
        resource_id=str(row.id),
        details={"label": row.label},
    )
    db.commit()
    return IntegrationApiKeyCreateResponse(id=str(row.id), api_key=full_key, label=row.label)


@router.get("/integration-keys", response_model=list[IntegrationApiKeyListItem])
def list_integration_keys(
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> list[IntegrationApiKeyListItem]:
    rows = (
        db.query(IntegrationApiKey)
        .filter(IntegrationApiKey.tenant_id == membership.tenant_id)
        .order_by(IntegrationApiKey.created_at.desc())
        .all()
    )
    return [
        IntegrationApiKeyListItem(
            id=str(item.id),
            label=item.label,
            is_active=item.is_active,
            created_at=item.created_at.isoformat(),
        )
        for item in rows
    ]


@router.get("/external-crm-webhook/status")
def get_external_crm_webhook_status(
    membership: Membership = Depends(get_admin_membership),
) -> dict:
    """Whether outbound forwarding to another CRM is enabled (URL from server env)."""
    _ = membership
    return external_crm_webhook_status()


@router.post("/external-crm-webhook/test")
def test_external_crm_webhook(
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> dict:
    """POST a sample event to EXTERNAL_CRM_WEBHOOK_URL (configure in .env on the server)."""
    if not external_crm_webhook_configured():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Set EXTERNAL_CRM_WEBHOOK_URL in the API server .env, then restart the backend.",
        )
    payload, phone_ids = sample_test_payload()
    ok, err = deliver_external_crm_webhook(meta_payload=payload, phone_number_ids=phone_ids)
    if not ok:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=err or "Delivery failed",
        )
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="admin.external_crm_webhook.test",
        resource_type="external_crm_webhook",
        resource_id=None,
        details={"url_host": external_crm_webhook_status().get("url_host")},
    )
    db.commit()
    return {
        "success": True,
        "message": "Test event delivered. Check your external CRM receiver logs.",
    }


@router.delete("/integration-keys/{key_id}", status_code=status.HTTP_204_NO_CONTENT)
def revoke_integration_key(
    key_id: str,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> None:
    try:
        kid = UUID(key_id)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid key id") from exc
    row = (
        db.query(IntegrationApiKey)
        .filter(IntegrationApiKey.tenant_id == membership.tenant_id, IntegrationApiKey.id == kid)
        .first()
    )
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Integration key not found")
    row.is_active = False
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="admin.integration_key.revoke",
        resource_type="integration_api_key",
        resource_id=key_id,
        details={},
    )
    db.commit()
