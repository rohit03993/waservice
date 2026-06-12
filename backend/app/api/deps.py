from fastapi import Depends, Header, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from sqlalchemy.orm import Session

from app.core.security import decode_token
from app.core.super_admin import is_super_admin_email
from app.db.session import get_db
from app.models.membership import Membership
from app.models.tenant import Tenant
from app.models.user import User
from app.services.tenant_setup import tenant_requires_setup

bearer_scheme = HTTPBearer(auto_error=False)


def get_current_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing authorization token")

    payload = decode_token(credentials.credentials)
    if not payload or "sub" not in payload:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid or expired token")

    user = db.query(User).filter(User.id == payload["sub"]).first()
    if not user or not user.is_active:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found or inactive")
    return user


def get_current_tenant_membership(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    x_tenant_slug: str | None = Header(default=None, alias="X-Tenant-Slug"),
) -> Membership:
    membership_query = db.query(Membership).join(Tenant, Membership.tenant_id == Tenant.id).filter(Membership.user_id == current_user.id)
    if x_tenant_slug:
        membership = membership_query.filter(Tenant.slug == x_tenant_slug).first()
        if not membership:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Membership for tenant slug not found")
        return membership

    membership = membership_query.first()
    if not membership:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="No tenant membership found for this user")
    return membership


def get_membership_with_roles(
    allowed_roles: set[str],
    *,
    require_active_tenant: bool = True,
):
    def _role_checked_membership(
        membership: Membership = Depends(get_current_tenant_membership),
        current_user: User = Depends(get_current_user),
        db: Session = Depends(get_db),
    ) -> Membership:
        role = (membership.role or "").strip().lower()
        normalized_allowed = {item.strip().lower() for item in allowed_roles}
        if role not in normalized_allowed:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{membership.role}' is not allowed for this action",
            )
        if require_active_tenant and not is_super_admin_email(current_user.email):
            tenant = db.query(Tenant).filter(Tenant.id == membership.tenant_id).first()
            if tenant_requires_setup(tenant):
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Complete WhatsApp setup in Settings before using the CRM.",
                )
        return membership

    return _role_checked_membership


get_admin_membership = get_membership_with_roles({"admin"})
get_admin_or_agent_membership = get_membership_with_roles({"admin", "agent"})
get_admin_membership_setup_allowed = get_membership_with_roles({"admin"}, require_active_tenant=False)


def get_super_admin_user(
    current_user: User = Depends(get_current_user),
) -> User:
    if not is_super_admin_email(current_user.email):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Platform super-admin access required",
        )
    return current_user
