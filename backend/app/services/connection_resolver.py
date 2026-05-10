from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.whatsapp_connection import WhatsAppConnection


def resolve_active_connection(*, db: Session, tenant_id, connection_id: str | None = None) -> WhatsAppConnection:
    query = db.query(WhatsAppConnection).filter(WhatsAppConnection.tenant_id == tenant_id, WhatsAppConnection.is_active.is_(True))
    connection = None
    if connection_id:
        connection = query.filter(WhatsAppConnection.id == connection_id).first()
    if not connection:
        connection = query.filter(WhatsAppConnection.is_default.is_(True)).first()
    if not connection:
        connection = query.order_by(WhatsAppConnection.created_at.asc()).first()
    if not connection:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active WhatsApp connection configured")
    return connection
