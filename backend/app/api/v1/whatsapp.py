import hashlib
import hmac
import json
import re
import secrets
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session

from app.api.deps import get_admin_membership, get_admin_or_agent_membership
from app.core.phone import normalize_phone_e164
from app.core.rate_limit import check_rate_limit
from app.core.secrets import decrypt_secret, encrypt_secret
from app.db.session import get_db
from app.models.contact import Contact
from app.models.conversation import Conversation
from app.models.message import Message
from app.models.message_template import MessageTemplate
from app.models.membership import Membership
from app.models.whatsapp_connection import WhatsAppConnection
from app.schemas.whatsapp import (
    BodyVariableExample,
    TemplateItemResponse,
    WhatsAppConnectionResponse,
    WhatsAppConnectionUpsertRequest,
    WhatsAppTextReplyRequest,
    WhatsAppTemplateCreateRequest,
    WhatsAppTemplateCreateResponse,
    WhatsAppTemplateSendRequest,
    WhatsAppTemplateSendResponse,
    template_body_parameters_to_meta_components,
)
from app.services.audit import log_admin_action
from app.services.meta_client import MetaClient
from app.services.outbound_whatsapp import send_whatsapp_template_message
from app.services.template_preview import build_template_preview_from_stored

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])
webhook_router = APIRouter(tags=["webhook"])

_MEDIA_MESSAGE_TYPES = frozenset({"image", "document", "sticker", "video", "audio"})


def _extract_waba_media_id(message_type: str, payload: dict | None) -> str | None:
    if not payload or message_type not in _MEDIA_MESSAGE_TYPES:
        return None
    block = payload.get(message_type)
    if not isinstance(block, dict):
        return None
    mid = block.get("id")
    return mid.strip() if isinstance(mid, str) and mid.strip() else None


def _media_content_disposition(message_type: str, payload: dict | None) -> str | None:
    """Return Content-Disposition value or None to omit."""
    if message_type == "document" and payload:
        block = payload.get("document")
        if isinstance(block, dict):
            fn = block.get("filename")
            if isinstance(fn, str) and fn.strip():
                safe = fn.strip().replace('"', "").replace("\r", "").replace("\n", "")
                if safe:
                    return f'inline; filename="{safe}"'
    if message_type in ("image", "sticker", "video", "audio"):
        return "inline"
    return None


def _positional_placeholder_order(body_text: str) -> list[int]:
    """Unique {{n}} indices in order of first appearance left-to-right."""
    seen: set[int] = set()
    order: list[int] = []
    for m in re.finditer(r"\{\{\s*(\d+)\s*\}\}", body_text):
        n = int(m.group(1))
        if n not in seen:
            seen.add(n)
            order.append(n)
    return order


def _named_placeholder_order(body_text: str) -> list[str]:
    """Unique {{snake_case}} names in order of first appearance (Meta named-parameter style)."""
    seen: set[str] = set()
    order: list[str] = []
    for m in re.finditer(r"\{\{\s*([a-z][a-z0-9_]*)\s*\}\}", body_text):
        name = m.group(1)
        if name not in seen:
            seen.add(name)
            order.append(name)
    return order


def _reject_mixed_body_placeholders(body_text: str) -> None:
    has_numeric = bool(re.search(r"\{\{\s*\d+\s*\}\}", body_text))
    has_named = bool(re.search(r"\{\{\s*[a-z][a-z0-9_]*\s*\}\}", body_text))
    if has_numeric and has_named:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Do not mix {{1}} style variables with {{variable_name}} style in the same body.",
        )


def _rewrite_positional_body_to_named(body_text: str, order: list[int], variables: list[BodyVariableExample]) -> str:
    idx_to_name = {order[i]: variables[i].param_name for i in range(len(order))}

    def repl(match: re.Match[str]) -> str:
        n = int(match.group(1))
        if n not in idx_to_name:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Body contains {{{{}}}} for {{{{{n}}}}}, which is not covered by the variable list.",
            )
        return "{{" + idx_to_name[n] + "}}"

    return re.sub(r"\{\{\s*(\d+)\s*\}\}", repl, body_text)


def _build_body_component_for_meta(payload: WhatsAppTemplateCreateRequest) -> tuple[dict, str | None]:
    """Return BODY component dict and Meta template parameter_format ('named' | 'positional') if variables exist."""
    body = payload.body_text.strip()
    _reject_mixed_body_placeholders(body)
    pos_order = _positional_placeholder_order(body)
    named_order = _named_placeholder_order(body)

    if pos_order:
        if payload.body_variables:
            if len(payload.body_variables) != len(pos_order):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"The body has {len(pos_order)} unique {{n}} variable(s) (indices in order: {pos_order}). "
                        f"Send the same number of body_variables entries."
                    ),
                )
            pnames = [v.param_name for v in payload.body_variables]
            if len(pnames) != len(set(pnames)):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="Each body_variables.param_name must be unique.",
                )
            rewritten = _rewrite_positional_body_to_named(body, pos_order, payload.body_variables)
            named_params = [{"param_name": v.param_name, "example": v.example} for v in payload.body_variables]
            return (
                {"type": "BODY", "text": rewritten, "example": {"body_text_named_params": named_params}},
                "named",
            )
        if payload.body_examples_csv and payload.body_examples_csv.strip():
            vals = [p.strip() for p in payload.body_examples_csv.split(",")]
            if len(vals) < len(pos_order):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=(
                        f"The body has {len(pos_order)} unique {{n}} variable(s); "
                        "provide at least that many comma-separated values in body_examples_csv (left-to-right order)."
                    ),
                )
            return (
                {"type": "BODY", "text": body, "example": {"body_text": [vals[: len(pos_order)]]}},
                "positional",
            )
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Body contains variables like {{1}}. Add a variable name and sample for each, or provide body_examples_csv.",
        )

    if named_order:
        if not payload.body_variables or len(payload.body_variables) != len(named_order):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"Body has {len(named_order)} named variable(s) {named_order}; "
                    "send body_variables with matching param_name values in that order, each with an example."
                ),
            )
        for i, expected in enumerate(named_order):
            if payload.body_variables[i].param_name != expected:
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail=f'body_variables[{i}].param_name must be "{expected}" to match the body text.',
                )
        named_params = [{"param_name": v.param_name, "example": v.example} for v in payload.body_variables]
        return ({"type": "BODY", "text": body, "example": {"body_text_named_params": named_params}}, "named")

    if payload.body_variables:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="body_variables was provided but the body has no {{variables}}.",
        )

    return ({"type": "BODY", "text": body}, None)


def _plain_verify_token(value: str | None) -> str:
    """Return plaintext verify token from encrypted or legacy stored value."""
    if not value:
        return ""
    plain = decrypt_secret(value)
    return (plain or "").strip()


def _resolve_connection(
    *,
    db: Session,
    tenant_id,
    connection_id: str | None = None,
    require_waba: bool = False,
) -> WhatsAppConnection:
    query = db.query(WhatsAppConnection).filter(WhatsAppConnection.tenant_id == tenant_id, WhatsAppConnection.is_active.is_(True))
    connection: WhatsAppConnection | None = None
    if connection_id:
        connection = query.filter(WhatsAppConnection.id == connection_id).first()
    if not connection:
        connection = query.filter(WhatsAppConnection.is_default.is_(True)).first()
    if not connection:
        connection = query.order_by(WhatsAppConnection.created_at.asc()).first()
    if not connection:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="No active WhatsApp connection configured")
    if require_waba and not connection.waba_id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Selected WhatsApp connection does not have WABA ID")
    return connection


def _connection_to_response(connection: WhatsAppConnection) -> WhatsAppConnectionResponse:
    access_token = decrypt_secret(connection.access_token) or ""
    token_preview = f"{access_token[:8]}...{access_token[-4:]}" if len(access_token) > 12 else "***"
    return WhatsAppConnectionResponse(
        id=str(connection.id),
        label=connection.label,
        phone_number_id=connection.phone_number_id,
        waba_id=connection.waba_id,
        verify_token_configured=bool(_plain_verify_token(connection.verify_token)),
        app_secret_configured=bool(connection.app_secret),
        access_token_preview=token_preview,
        is_default=connection.is_default,
        is_active=connection.is_active,
    )


@router.get("/connection", response_model=WhatsAppConnectionResponse | None)
def get_connection(
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> WhatsAppConnectionResponse | None:
    connection = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.tenant_id == membership.tenant_id)
        .order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc())
        .first()
    )
    if not connection:
        return None
    return _connection_to_response(connection)


@router.get("/connections", response_model=list[WhatsAppConnectionResponse])
def list_connections(
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> list[WhatsAppConnectionResponse]:
    rows = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.tenant_id == membership.tenant_id)
        .order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc())
        .all()
    )
    return [_connection_to_response(item) for item in rows]


@router.get("/connection-health")
async def connection_health(
    request: Request,
    connection_id: str | None = Query(default=None),
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"whatsapp:health:{membership.tenant_id}:{client_ip}", limit=30, window_seconds=60)

    base_query = db.query(WhatsAppConnection).filter(WhatsAppConnection.tenant_id == membership.tenant_id)
    connection: WhatsAppConnection | None = None
    if connection_id:
        connection = base_query.filter(WhatsAppConnection.id == connection_id).first()
    if not connection:
        connection = (
            base_query.order_by(WhatsAppConnection.is_default.desc(), WhatsAppConnection.created_at.asc()).first()
        )

    if not connection:
        return {
            "overall": "disconnected",
            "connection_configured": False,
            "waba_configured": False,
            "verify_token_configured": False,
            "app_secret_configured": False,
            "token_valid": False,
            "token_error": None,
            "webhook_ready": False,
            "connection_active": False,
            "hints": ["Save a WhatsApp connection in Settings."],
        }

    waba_ok = bool(connection.waba_id and str(connection.waba_id).strip())
    verify_ok = bool(_plain_verify_token(connection.verify_token))
    secret_ok = bool(connection.app_secret)
    token_plain = decrypt_secret(connection.access_token) or ""

    token_ok = False
    token_error: str | None = None
    if token_plain:
        token_ok, token_error = await MetaClient.verify_phone_number_access(
            phone_number_id=connection.phone_number_id,
            access_token=token_plain,
        )
    else:
        token_error = "Access token missing"

    webhook_ready = verify_ok and secret_ok
    hints: list[str] = []
    if not token_ok:
        hints.append("Meta access token is missing, expired, or not allowed for this phone number. Paste a fresh token and save.")
    if not waba_ok:
        hints.append("Add WABA ID to enable template sync from Meta.")
    if not webhook_ready:
        hints.append("Set verify token and app secret so inbound webhooks are verified securely.")
    if not connection.is_active:
        hints.append("Connection is inactive; enable it or pick another default.")

    if not connection.is_active or not token_ok or not waba_ok or not webhook_ready:
        overall = "attention"
    else:
        overall = "healthy"

    return {
        "overall": overall,
        "connection_configured": True,
        "waba_configured": waba_ok,
        "verify_token_configured": verify_ok,
        "app_secret_configured": secret_ok,
        "token_valid": token_ok,
        "token_error": token_error[:500] if token_error else None,
        "webhook_ready": webhook_ready,
        "connection_active": connection.is_active,
        "hints": hints,
    }


@router.put("/connection", response_model=WhatsAppConnectionResponse)
def upsert_connection(
    payload: WhatsAppConnectionUpsertRequest,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> WhatsAppConnectionResponse:
    normalized_access_token = (payload.access_token or "").strip()
    normalized_verify_token = (payload.verify_token or "").strip()
    connection = None
    if payload.connection_id:
        connection = (
            db.query(WhatsAppConnection)
            .filter(WhatsAppConnection.tenant_id == membership.tenant_id, WhatsAppConnection.id == payload.connection_id)
            .first()
        )
    if not connection:
        connection = (
            db.query(WhatsAppConnection)
            .filter(
                WhatsAppConnection.tenant_id == membership.tenant_id,
                WhatsAppConnection.phone_number_id == payload.phone_number_id.strip(),
            )
            .first()
        )

    if payload.is_default:
        db.query(WhatsAppConnection).filter(WhatsAppConnection.tenant_id == membership.tenant_id).update(
            {WhatsAppConnection.is_default: False}
        )

    if not connection:
        if not normalized_access_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Access token is required for new connection")
        if not normalized_verify_token:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Verify token is required for new connection")
        connection = WhatsAppConnection(
            tenant_id=membership.tenant_id,
            label=payload.label.strip(),
            phone_number_id=payload.phone_number_id.strip(),
            waba_id=payload.waba_id.strip() if payload.waba_id else None,
            access_token=encrypt_secret(normalized_access_token),
            verify_token=encrypt_secret(normalized_verify_token),
            app_secret=encrypt_secret(payload.app_secret.strip()) if payload.app_secret else None,
            is_default=payload.is_default,
            is_active=payload.is_active,
        )
        db.add(connection)
    else:
        connection.label = payload.label.strip()
        connection.phone_number_id = payload.phone_number_id.strip()
        connection.waba_id = payload.waba_id.strip() if payload.waba_id else None
        if normalized_access_token:
            connection.access_token = encrypt_secret(normalized_access_token)
        if normalized_verify_token:
            connection.verify_token = encrypt_secret(normalized_verify_token)
        if payload.app_secret is not None and payload.app_secret.strip():
            connection.app_secret = encrypt_secret(payload.app_secret.strip())
        connection.is_default = payload.is_default
        connection.is_active = payload.is_active
    db.commit()
    db.refresh(connection)
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="whatsapp.connection.upsert",
        resource_type="whatsapp_connection",
        resource_id=str(connection.id),
        details={
            "label": connection.label,
            "phone_number_id": connection.phone_number_id,
            "is_default": connection.is_default,
            "is_active": connection.is_active,
        },
    )
    db.commit()
    return _connection_to_response(connection)


@router.delete("/connections/{connection_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_connection(
    connection_id: str,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> None:
    connection = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.tenant_id == membership.tenant_id, WhatsAppConnection.id == connection_id)
        .first()
    )
    if not connection:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Connection not found")

    was_default = connection.is_default
    db.delete(connection)
    db.flush()

    if was_default:
        replacement = (
            db.query(WhatsAppConnection)
            .filter(WhatsAppConnection.tenant_id == membership.tenant_id, WhatsAppConnection.is_active.is_(True))
            .order_by(WhatsAppConnection.created_at.asc())
            .first()
        )
        if replacement:
            replacement.is_default = True
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="whatsapp.connection.delete",
        resource_type="whatsapp_connection",
        resource_id=connection_id,
        details={"was_default": was_default},
    )
    db.commit()


@router.post("/send-template-test", response_model=WhatsAppTemplateSendResponse)
async def send_template_test(
    payload: WhatsAppTemplateSendRequest,
    request: Request,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> WhatsAppTemplateSendResponse:
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"send:template:{membership.tenant_id}:{membership.user_id}:{client_ip}", limit=30, window_seconds=60)
    connection = _resolve_connection(db=db, tenant_id=membership.tenant_id, connection_id=payload.connection_id)
    comps = template_body_parameters_to_meta_components(payload.body_parameters)
    try:
        result = await send_whatsapp_template_message(
            db,
            membership.tenant_id,
            to_phone_e164=payload.to_phone_e164,
            template_name=payload.template_name,
            language_code=payload.language_code,
            connection_id=payload.connection_id,
            template_components=comps,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Meta send failed: {error}") from error

    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="whatsapp.template_test_send",
        resource_type="whatsapp_connection",
        resource_id=str(connection.id),
        details={
            "to_phone_e164": payload.to_phone_e164,
            "template_name": payload.template_name,
            "message_id": result.message_id,
        },
    )
    db.commit()
    return WhatsAppTemplateSendResponse(success=True, message_id=result.message_id)


@router.get("/conversations")
def list_conversations(
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> list[dict]:
    conversations = (
        db.query(Conversation, Contact)
        .join(Contact, Contact.id == Conversation.contact_id)
        .filter(Conversation.tenant_id == membership.tenant_id)
        .order_by(Conversation.updated_at.desc())
        .all()
    )
    return [
        {
            "conversation_id": str(conversation.id),
            "contact_id": str(contact.id),
            "contact_name": contact.name,
            "phone_e164": contact.phone_e164,
            "updated_at": conversation.updated_at.isoformat(),
        }
        for conversation, contact in conversations
    ]


@router.get("/templates", response_model=list[TemplateItemResponse])
def list_templates(
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> list[TemplateItemResponse]:
    templates = (
        db.query(MessageTemplate)
        .filter(MessageTemplate.tenant_id == membership.tenant_id)
        .order_by(MessageTemplate.name.asc(), MessageTemplate.language.asc())
        .all()
    )
    return [
        TemplateItemResponse(
            id=str(item.id),
            name=item.name,
            language=item.language,
            category=item.category,
            status=item.status,
            preview_text=build_template_preview_from_stored(item.components),
        )
        for item in templates
    ]


@router.post("/templates/create", response_model=WhatsAppTemplateCreateResponse)
async def create_template(
    payload: WhatsAppTemplateCreateRequest,
    request: Request,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> WhatsAppTemplateCreateResponse:
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"template:create:{membership.tenant_id}:{membership.user_id}:{client_ip}", limit=10, window_seconds=300)
    connection = _resolve_connection(db=db, tenant_id=membership.tenant_id, require_waba=True)

    if payload.header_text and "{{" in payload.header_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Header variables are not supported in this form; use a plain header or create the template in Meta Business Manager.",
        )
    if payload.footer_text and "{{" in payload.footer_text:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Footer cannot include variables.",
        )

    components: list[dict] = []
    if payload.header_text and payload.header_text.strip():
        components.append(
            {
                "type": "HEADER",
                "format": "TEXT",
                "text": payload.header_text.strip(),
            }
        )
    body_comp, param_format = _build_body_component_for_meta(payload)
    components.append(body_comp)
    if payload.footer_text and payload.footer_text.strip():
        components.append({"type": "FOOTER", "text": payload.footer_text.strip()})

    meta_body: dict = {
        "name": payload.name.strip().lower(),
        "language": payload.language.strip(),
        "category": payload.category,
        "components": components,
    }
    if param_format:
        meta_body["parameter_format"] = param_format
    if payload.allow_category_change:
        meta_body["allow_category_change"] = True

    try:
        data = await MetaClient.create_message_template(
            waba_id=connection.waba_id or "",
            access_token=decrypt_secret(connection.access_token) or "",
            body=meta_body,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Meta template create failed: {error}") from error

    meta_id = data.get("id")
    meta_status = data.get("status")
    meta_category = data.get("category")
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="whatsapp.template.create",
        resource_type="whatsapp_connection",
        resource_id=str(connection.id),
        details={
            "template_name": payload.name.strip().lower(),
            "language": payload.language.strip(),
            "category": payload.category,
            "meta_id": str(meta_id) if meta_id else None,
            "meta_status": meta_status,
        },
    )
    db.commit()
    return WhatsAppTemplateCreateResponse(
        success=True,
        status=str(meta_status) if meta_status else None,
        category=str(meta_category) if meta_category else None,
    )


@router.post("/templates/sync", response_model=list[TemplateItemResponse])
async def sync_templates(
    request: Request,
    membership: Membership = Depends(get_admin_membership),
    db: Session = Depends(get_db),
) -> list[TemplateItemResponse]:
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"template:sync:{membership.tenant_id}:{membership.user_id}:{client_ip}", limit=20, window_seconds=60)
    connection = _resolve_connection(db=db, tenant_id=membership.tenant_id, require_waba=True)

    try:
        data = await MetaClient.list_templates(
            waba_id=connection.waba_id,
            access_token=decrypt_secret(connection.access_token) or "",
        )
    except RuntimeError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Template sync failed: {error}") from error

    template_items = data.get("data", []) if isinstance(data, dict) else []
    for item in template_items:
        name = (item.get("name") or "").strip()
        language = ((item.get("language") or "en_US")).strip()
        if not name:
            continue
        existing = (
            db.query(MessageTemplate)
            .filter(
                MessageTemplate.tenant_id == membership.tenant_id,
                MessageTemplate.name == name,
                MessageTemplate.language == language,
            )
            .first()
        )
        if not existing:
            existing = MessageTemplate(
                tenant_id=membership.tenant_id,
                name=name,
                language=language,
                category=item.get("category"),
                status=item.get("status"),
                components={"components": item.get("components", [])},
            )
            db.add(existing)
        else:
            existing.category = item.get("category")
            existing.status = item.get("status")
            existing.components = {"components": item.get("components", [])}
    db.commit()
    log_admin_action(
        db=db,
        tenant_id=membership.tenant_id,
        actor_user_id=membership.user_id,
        action="whatsapp.templates.sync",
        resource_type="whatsapp_connection",
        resource_id=str(connection.id),
        details={"template_count": len(template_items)},
    )
    db.commit()
    return list_templates(membership=membership, db=db)


@router.get("/conversations/{conversation_id}/messages")
def list_messages(
    conversation_id: UUID,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> list[dict]:
    messages = (
        db.query(Message)
        .filter(Message.tenant_id == membership.tenant_id, Message.conversation_id == conversation_id)
        .order_by(Message.created_at.asc())
        .all()
    )
    out: list[dict] = []
    for item in messages:
        payload = dict(item.payload or {})
        if item.type == "template" and not payload.get("preview_text"):
            name = payload.get("template_name")
            lang = payload.get("language_code")
            if isinstance(name, str) and isinstance(lang, str):
                row = (
                    db.query(MessageTemplate)
                    .filter(
                        MessageTemplate.tenant_id == membership.tenant_id,
                        MessageTemplate.name == name.strip(),
                        MessageTemplate.language == lang.strip(),
                    )
                    .first()
                )
                if row:
                    prev = build_template_preview_from_stored(row.components)
                    if prev:
                        payload["preview_text"] = prev
        out.append(
            {
                "id": str(item.id),
                "direction": item.direction,
                "wamid": item.wamid,
                "type": item.type,
                "status": item.status,
                "payload": payload,
                "created_at": item.created_at.isoformat(),
            }
        )
    return out


@router.get("/messages/{message_id}/media")
async def get_message_media(
    message_id: UUID,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> Response:
    msg = (
        db.query(Message)
        .filter(Message.id == message_id, Message.tenant_id == membership.tenant_id)
        .first()
    )
    if not msg:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Message not found")
    payload = dict(msg.payload) if isinstance(msg.payload, dict) else {}
    media_id = _extract_waba_media_id(msg.type, payload)
    if not media_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No media for this message")
    connection = _resolve_connection(db=db, tenant_id=membership.tenant_id)
    token = decrypt_secret(connection.access_token) or ""
    if not token:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="WhatsApp access token not configured")
    try:
        content, mime = await MetaClient.download_media(media_id=media_id, access_token=token)
    except RuntimeError as error:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="Could not download media from Meta",
        ) from error
    disp = _media_content_disposition(msg.type, payload)
    headers = {"Content-Disposition": disp} if disp else {}
    return Response(content=content, media_type=mime, headers=headers)


@router.post("/reply-text")
async def reply_text(
    payload: WhatsAppTextReplyRequest,
    request: Request,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"send:reply:{membership.tenant_id}:{membership.user_id}:{client_ip}", limit=60, window_seconds=60)
    connection = _resolve_connection(db=db, tenant_id=membership.tenant_id, connection_id=payload.connection_id)

    conversation = (
        db.query(Conversation)
        .filter(Conversation.tenant_id == membership.tenant_id, Conversation.id == payload.conversation_id)
        .first()
    )
    if not conversation:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found")

    try:
        data = await MetaClient.send_text_message(
            phone_number_id=connection.phone_number_id,
            access_token=decrypt_secret(connection.access_token) or "",
            to_phone_e164=normalize_phone_e164(payload.to_phone_e164),
            text=payload.text,
        )
    except RuntimeError as error:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Meta reply failed: {error}") from error

    message_id = None
    if isinstance(data.get("messages"), list) and data["messages"]:
        message_id = data["messages"][0].get("id")
    if message_id:
        db.add(
            Message(
                tenant_id=membership.tenant_id,
                conversation_id=conversation.id,
                contact_id=conversation.contact_id,
                direction="outbound",
                wamid=message_id,
                type="text",
                status="sent",
                payload={"text": payload.text, "meta_response": data},
            )
        )
        db.commit()
    return {"success": True, "message_id": message_id}


def _webhook_value_objects(payload: dict) -> list[dict]:
    values: list[dict] = []
    for entry in payload.get("entry", []):
        for change in entry.get("changes", []):
            value = change.get("value")
            if isinstance(value, dict):
                values.append(value)
    return values


def _webhook_phone_number_ids(values: list[dict]) -> list[str]:
    ids: list[str] = []
    for value in values:
        meta = value.get("metadata")
        if not isinstance(meta, dict):
            continue
        pid = meta.get("phone_number_id")
        if pid:
            ids.append(str(pid).strip())
    return ids


def _signature_matches_any_secret(*, body_bytes: bytes, signature_header: str | None, app_secrets: list[str]) -> bool:
    if not signature_header:
        return False
    for secret in app_secrets:
        expected = "sha256=" + hmac.new(secret.encode("utf-8"), body_bytes, hashlib.sha256).hexdigest()
        if hmac.compare_digest(signature_header, expected):
            return True
    return False


@webhook_router.get("/api/v1/webhook/whatsapp")
def verify_webhook(
    mode: str = Query(alias="hub.mode"),
    token: str = Query(alias="hub.verify_token"),
    challenge: str = Query(alias="hub.challenge"),
    db: Session = Depends(get_db),
) -> Response:
    if mode != "subscribe":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook verification failed")
    connections = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.verify_token.is_not(None), WhatsAppConnection.is_active.is_(True))
        .all()
    )
    for connection in connections:
        expected = _plain_verify_token(connection.verify_token)
        if not expected:
            continue
        try:
            if secrets.compare_digest(expected.encode("utf-8"), token.encode("utf-8")):
                return Response(content=challenge, media_type="text/plain")
        except ValueError:
            continue
    raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook verification failed")


@webhook_router.post("/api/v1/webhook/whatsapp")
async def receive_webhook(request: Request, db: Session = Depends(get_db)) -> dict:
    client_ip = request.client.host if request.client else "unknown"
    check_rate_limit(key=f"webhook:ip:{client_ip}", limit=600, window_seconds=60)
    body_bytes = await request.body()
    try:
        payload = json.loads(body_bytes.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, ValueError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid JSON body") from None

    obj = payload.get("object")
    if obj is not None and obj != "whatsapp_business_account":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid webhook payload")

    value_objects = _webhook_value_objects(payload)
    phone_ids = _webhook_phone_number_ids(value_objects)
    if not phone_ids:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook verification failed")

    connections = (
        db.query(WhatsAppConnection)
        .filter(WhatsAppConnection.phone_number_id.in_(phone_ids), WhatsAppConnection.is_active.is_(True))
        .all()
    )
    if not connections:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook verification failed")

    app_secrets: list[str] = []
    seen: set[str] = set()
    for connection in connections:
        if not connection.app_secret:
            continue
        plain = decrypt_secret(connection.app_secret)
        if plain and plain not in seen:
            seen.add(plain)
            app_secrets.append(plain)
    if not app_secrets:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Webhook secret is required")

    signature = request.headers.get("X-Hub-Signature-256")
    if not _signature_matches_any_secret(body_bytes=body_bytes, signature_header=signature, app_secrets=app_secrets):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Invalid webhook signature")

    for value in value_objects:
        metadata = value.get("metadata", {})
        phone_number_id = metadata.get("phone_number_id")
        if not phone_number_id:
            continue

        connection = (
            db.query(WhatsAppConnection)
            .filter(WhatsAppConnection.phone_number_id == phone_number_id, WhatsAppConnection.is_active.is_(True))
            .first()
        )
        if not connection:
            continue

        tenant_id = connection.tenant_id

        for inbound in value.get("messages", []) or []:
            wa_id = (inbound.get("from") or "").strip()
            if not wa_id:
                continue
            normalized_phone = normalize_phone_e164(wa_id)
            contact = db.query(Contact).filter(Contact.tenant_id == tenant_id, Contact.phone_e164 == normalized_phone).first()
            if not contact:
                contact = Contact(tenant_id=tenant_id, phone_e164=normalized_phone, name=None, custom_attributes={})
                db.add(contact)
                db.flush()

            conversation = db.query(Conversation).filter(Conversation.tenant_id == tenant_id, Conversation.contact_id == contact.id).first()
            if not conversation:
                conversation = Conversation(tenant_id=tenant_id, contact_id=contact.id)
                db.add(conversation)
                db.flush()

            wamid = inbound.get("id")
            if not wamid:
                continue
            existing = db.query(Message).filter(Message.tenant_id == tenant_id, Message.wamid == wamid).first()
            if existing:
                continue
            msg = Message(
                tenant_id=tenant_id,
                conversation_id=conversation.id,
                contact_id=contact.id,
                direction="inbound",
                wamid=wamid,
                type=inbound.get("type", "text"),
                status="received",
                payload=inbound,
            )
            db.add(msg)

        for status_item in value.get("statuses", []) or []:
            wamid = status_item.get("id")
            if not wamid:
                continue
            existing = db.query(Message).filter(Message.tenant_id == tenant_id, Message.wamid == wamid).first()
            if existing:
                existing.status = status_item.get("status", existing.status)
                existing.payload = {**(existing.payload or {}), "status_event": status_item}

    db.commit()
    return {"success": True}
