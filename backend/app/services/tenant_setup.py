"""Agent workspace activation after Meta / WhatsApp setup."""

from __future__ import annotations

from sqlalchemy.orm import Session

from app.models.tenant import Tenant
from app.models.whatsapp_connection import WhatsAppConnection
from app.services.whatsapp_connection_health import evaluate_whatsapp_connection

SETUP_PENDING = "pending_meta"
SETUP_ACTIVE = "active"


def tenant_requires_setup(tenant: Tenant | None) -> bool:
    return tenant is not None and (tenant.setup_status or SETUP_PENDING) != SETUP_ACTIVE


async def try_activate_tenant_after_meta(db: Session, tenant_id) -> bool:
    """Mark tenant active when default WhatsApp connection passes health checks."""
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant or tenant.setup_status == SETUP_ACTIVE:
        return tenant.setup_status == SETUP_ACTIVE if tenant else False

    connection = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.tenant_id == tenant_id)
        .order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc())
        .first()
    )
    health = await evaluate_whatsapp_connection(connection)
    if health.get("overall") == "healthy":
        tenant.setup_status = SETUP_ACTIVE
        db.commit()
        db.refresh(tenant)
        return True
    return False
