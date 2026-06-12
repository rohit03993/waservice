"""Platform super-admin routes (cross-tenant agent provisioning)."""

from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import get_super_admin_user
from app.core.security import hash_password
from app.core.super_admin import is_super_admin_email
from app.db.session import get_db
from app.models.membership import Membership
from app.models.tenant import Tenant
from app.models.user import User
from app.models.whatsapp_connection import WhatsAppConnection
from app.models.contact import Contact
from app.models.message import Message
from app.schemas.platform import (
    AgentActionResponse,
    CreateAgentRequest,
    CreateAgentResponse,
    DeleteAgentRequest,
    DeleteAgentResponse,
    ResetAgentPasswordRequest,
    UpdateAgentRequest,
)
from app.services.platform_agent_monitoring import (
    build_agent_overview,
    delete_agent_workspace,
    list_agent_conversation_messages,
    list_agent_conversations,
)
from app.services.tenant_setup import SETUP_ACTIVE, SETUP_PENDING
from app.services.whatsapp_connection_health import evaluate_whatsapp_connection

router = APIRouter(prefix="/platform", tags=["platform"])


def _tenant_is_super_admin_workspace(memberships: list[tuple[Membership, User]]) -> bool:
    """Super-admin personal workspaces are not agent accounts."""
    return any(is_super_admin_email(user.email) for _, user in memberships)


def _primary_agent_user(memberships: list[tuple[Membership, User]]) -> User | None:
    for membership, user in memberships:
        if (membership.role or "").strip().lower() == "admin":
            return user
    return memberships[0][1] if memberships else None


def _resolve_agent_workspace(db: Session, tenant_id: UUID) -> tuple[Tenant, User]:
    tenant = db.query(Tenant).filter(Tenant.id == tenant_id).first()
    if not tenant:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent workspace not found")
    memberships = (
        db.query(Membership, User)
        .join(User, Membership.user_id == User.id)
        .filter(Membership.tenant_id == tenant.id)
        .all()
    )
    if _tenant_is_super_admin_workspace(memberships):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not an agent workspace")
    agent = _primary_agent_user(memberships)
    if not agent:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Agent user not found for workspace")
    return tenant, agent


async def _agent_tenants_with_memberships(db: Session) -> list[tuple[Tenant, list[tuple[Membership, User]]]]:
    rows: list[tuple[Tenant, list[tuple[Membership, User]]]] = []
    for tenant in db.query(Tenant).all():
        memberships = (
            db.query(Membership, User)
            .join(User, Membership.user_id == User.id)
            .filter(Membership.tenant_id == tenant.id)
            .all()
        )
        if not _tenant_is_super_admin_workspace(memberships):
            rows.append((tenant, memberships))
    return rows


async def _count_token_attention(db: Session, agent_tenant_ids: list) -> int:
    if not agent_tenant_ids:
        return 0
    count = 0
    for tenant_id in agent_tenant_ids:
        connection = (
            db.query(WhatsAppConnection)
            .filter(WhatsAppConnection.tenant_id == tenant_id)
            .order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc())
            .first()
        )
        health = await evaluate_whatsapp_connection(connection)
        if health.get("token_alert") in {"expired", "invalid", "missing"}:
            count += 1
    return count


def _tenant_agent_row(
    tenant: Tenant,
    memberships: list[tuple[Membership, User]],
    connections: list[WhatsAppConnection],
    meta_health: dict | None,
    contact_count: int,
    message_count: int,
) -> dict:
    primary_user = memberships[0][1] if memberships else None
    return {
        "tenant_id": str(tenant.id),
        "tenant_name": tenant.name,
        "tenant_slug": tenant.slug,
        "setup_status": tenant.setup_status,
        "created_at": tenant.created_at.isoformat(),
        "agent_email": primary_user.email if primary_user else None,
        "agent_full_name": primary_user.full_name if primary_user else None,
        "agent_is_active": primary_user.is_active if primary_user else None,
        "users": [
            {
                "email": user.email,
                "full_name": user.full_name,
                "role": membership.role,
                "is_active": user.is_active,
            }
            for membership, user in memberships
        ],
        "contact_count": contact_count,
        "message_count": message_count,
        "whatsapp_connections": len(connections),
        "meta_health": meta_health,
    }


@router.get("/summary")
async def platform_summary(
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
) -> dict:
    agent_rows = await _agent_tenants_with_memberships(db)
    agent_tenants = [tenant for tenant, _ in agent_rows]

    agents_total = len(agent_tenants)
    agents_active = sum(1 for t in agent_tenants if t.setup_status == SETUP_ACTIVE)
    agents_pending = agents_total - agents_active
    agents_disabled = 0
    for _, memberships in agent_rows:
        agent = _primary_agent_user(memberships)
        if agent and not agent.is_active:
            agents_disabled += 1
    agent_tenant_ids = [t.id for t in agent_tenants]
    agents_token_attention = await _count_token_attention(db, agent_tenant_ids)
    user_count = (
        db.query(func.count(User.id))
        .join(Membership, Membership.user_id == User.id)
        .filter(Membership.tenant_id.in_(agent_tenant_ids))
        .scalar()
        if agent_tenant_ids
        else 0
    )
    connection_count = (
        db.query(func.count(WhatsAppConnection.id))
        .filter(WhatsAppConnection.tenant_id.in_(agent_tenant_ids))
        .scalar()
        if agent_tenant_ids
        else 0
    )
    return {
        "agents_total": agents_total,
        "agents_active": agents_active,
        "agents_pending_meta": agents_pending,
        "agents_disabled": agents_disabled,
        "agents_token_attention": agents_token_attention,
        "users": user_count,
        "whatsapp_connections": connection_count,
        # Legacy keys for older UI
        "tenants": agents_total,
    }


@router.patch("/agents/{tenant_id}", response_model=AgentActionResponse)
def update_agent_status(
    tenant_id: UUID,
    payload: UpdateAgentRequest,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
) -> AgentActionResponse:
    tenant, agent = _resolve_agent_workspace(db, tenant_id)
    agent.is_active = payload.is_active
    db.commit()
    db.refresh(agent)
    detail = "Agent account enabled" if agent.is_active else "Agent account disabled"
    return AgentActionResponse(
        tenant_id=str(tenant.id),
        agent_email=agent.email,
        agent_is_active=agent.is_active,
        detail=detail,
    )


@router.get("/agents/{tenant_id}/overview")
async def get_agent_overview(
    tenant_id: UUID,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
) -> dict:
    tenant, agent = _resolve_agent_workspace(db, tenant_id)
    return await build_agent_overview(db, tenant, agent)


@router.get("/agents/{tenant_id}/conversations")
def get_agent_conversations(
    tenant_id: UUID,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
) -> dict:
    _resolve_agent_workspace(db, tenant_id)
    return list_agent_conversations(db, tenant_id, limit=limit, offset=offset)


@router.get("/agents/{tenant_id}/conversations/{conversation_id}/messages")
def get_agent_conversation_messages(
    tenant_id: UUID,
    conversation_id: UUID,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
    limit: int = Query(default=100, ge=1, le=500),
) -> list[dict]:
    _resolve_agent_workspace(db, tenant_id)
    return list_agent_conversation_messages(db, tenant_id, conversation_id, limit=limit)


@router.delete("/agents/{tenant_id}", response_model=DeleteAgentResponse)
def delete_agent(
    tenant_id: UUID,
    payload: DeleteAgentRequest,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
) -> DeleteAgentResponse:
    tenant, agent = _resolve_agent_workspace(db, tenant_id)
    if payload.confirm_slug.strip().lower() != tenant.slug.strip().lower():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Confirmation slug does not match this workspace. Type the exact workspace ID to delete.",
        )
    result = delete_agent_workspace(db, tenant)
    return DeleteAgentResponse(
        tenant_id=str(tenant_id),
        tenant_slug=result["tenant_slug"],
        deleted_user_emails=result["deleted_user_emails"],
        detail=f"Deleted workspace “{result['tenant_name']}” and all associated data.",
    )


@router.post("/agents/{tenant_id}/reset-password", response_model=AgentActionResponse)
def reset_agent_password(
    tenant_id: UUID,
    payload: ResetAgentPasswordRequest,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
) -> AgentActionResponse:
    tenant, agent = _resolve_agent_workspace(db, tenant_id)
    agent.password_hash = hash_password(payload.password)
    db.commit()
    return AgentActionResponse(
        tenant_id=str(tenant.id),
        agent_email=agent.email,
        agent_is_active=agent.is_active,
        detail="Password reset successfully",
    )


@router.post("/agents", response_model=CreateAgentResponse, status_code=status.HTTP_201_CREATED)
def create_agent(
    payload: CreateAgentRequest,
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
) -> CreateAgentResponse:
    email = payload.email.lower().strip()
    if is_super_admin_email(email):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use a different email for agent accounts — super-admin emails are platform operators only",
        )
    if db.query(User).filter(User.email == email).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Email already registered")
    slug = payload.tenant_slug.strip().lower()
    if db.query(Tenant).filter(Tenant.slug == slug).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Workspace ID already exists")

    user = User(
        email=email,
        full_name=payload.full_name,
        password_hash=hash_password(payload.password),
    )
    tenant = Tenant(name=payload.tenant_name.strip(), slug=slug, setup_status=SETUP_PENDING)
    db.add_all([user, tenant])
    db.flush()
    db.add(Membership(user_id=user.id, tenant_id=tenant.id, role="admin"))
    db.commit()
    db.refresh(tenant)

    return CreateAgentResponse(
        tenant_id=str(tenant.id),
        tenant_name=tenant.name,
        tenant_slug=tenant.slug,
        setup_status=tenant.setup_status,
        user_email=user.email,
        user_full_name=user.full_name,
    )


async def _list_agent_workspaces(db: Session, *, include_meta_health: bool) -> list[dict]:
    tenants = db.query(Tenant).order_by(Tenant.created_at.desc()).all()
    out: list[dict] = []

    for tenant in tenants:
        memberships = (
            db.query(Membership, User)
            .join(User, Membership.user_id == User.id)
            .filter(Membership.tenant_id == tenant.id)
            .all()
        )
        if _tenant_is_super_admin_workspace(memberships):
            continue
        connections = (
            db.query(WhatsAppConnection)
            .filter(WhatsAppConnection.tenant_id == tenant.id)
            .order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc())
            .all()
        )
        primary = connections[0] if connections else None
        meta_health = await evaluate_whatsapp_connection(primary) if include_meta_health else None
        contact_count = (
            db.query(func.count(Contact.id)).filter(Contact.tenant_id == tenant.id).scalar() or 0
        )
        message_count = (
            db.query(func.count(Message.id)).filter(Message.tenant_id == tenant.id).scalar() or 0
        )
        out.append(
            _tenant_agent_row(tenant, memberships, connections, meta_health, contact_count, message_count)
        )

    return out


@router.get("/agents")
async def platform_list_agents(
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
    include_meta_health: bool = Query(default=True),
) -> list[dict]:
    return await _list_agent_workspaces(db, include_meta_health=include_meta_health)


@router.get("/tenants")
async def platform_list_tenants(
    _: User = Depends(get_super_admin_user),
    db: Session = Depends(get_db),
    include_meta_health: bool = Query(default=True),
) -> list[dict]:
    return await _list_agent_workspaces(db, include_meta_health=include_meta_health)
