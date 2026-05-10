from typing import NamedTuple
from uuid import UUID

from fastapi import Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models.integration_api_key import IntegrationApiKey
from app.services.integration_keys import parse_integration_api_key, verify_integration_secret


class IntegrationAuthContext(NamedTuple):
    tenant_id: UUID
    api_key_row: IntegrationApiKey


def get_integration_auth(
    x_integration_key: str | None = Header(default=None, alias="X-Integration-Key"),
    db: Session = Depends(get_db),
) -> IntegrationAuthContext:
    if not x_integration_key or not x_integration_key.strip():
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Integration-Key header",
        )
    parsed = parse_integration_api_key(x_integration_key.strip())
    if not parsed:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid integration key format (expected wsk.<uuid>.<secret>)",
        )
    kid, secret = parsed
    row = db.query(IntegrationApiKey).filter(IntegrationApiKey.id == kid).first()
    if not row or not row.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid integration key")
    if not verify_integration_secret(secret, row.key_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid integration key")
    return IntegrationAuthContext(tenant_id=row.tenant_id, api_key_row=row)
