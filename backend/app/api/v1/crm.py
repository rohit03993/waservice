from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import and_, or_
from sqlalchemy.orm import Session, joinedload

from app.api.deps import get_admin_or_agent_membership
from app.core.phone import normalize_phone_e164
from app.db.session import get_db
from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.membership import Membership
from app.models.tag import Tag
from app.services.contact_merge import find_contact_by_normalized_phone
from app.services.messaging_policy import build_messaging_window
from app.schemas.campaign import MessagingWindowResponse
from app.schemas.crm import (
    ContactCreateRequest,
    ContactFilterRequest,
    ContactResponse,
    ContactUpdateRequest,
    TagCreateRequest,
    TagResponse,
)

router = APIRouter(prefix="/crm", tags=["crm"])


def _tag_to_schema(tag: Tag) -> TagResponse:
    return TagResponse(id=tag.id, name=tag.name, created_at=tag.created_at)


def _contact_to_schema(contact: Contact, *, merged_with_existing: bool = False) -> ContactResponse:
    window = build_messaging_window(contact.last_inbound_at)
    return ContactResponse(
        id=contact.id,
        phone_e164=normalize_phone_e164(contact.phone_e164),
        name=contact.name,
        custom_attributes=contact.custom_attributes or {},
        tags=[_tag_to_schema(item.tag) for item in contact.tags],
        created_at=contact.created_at,
        updated_at=contact.updated_at,
        merged_with_existing=merged_with_existing,
        messaging_window=MessagingWindowResponse(**window),
    )


def _merge_create_payload_into_contact(
    db: Session,
    contact: Contact,
    payload: ContactCreateRequest,
    membership: Membership,
) -> None:
    contact.phone_e164 = normalize_phone_e164(payload.phone_e164)
    if payload.name and payload.name.strip():
        incoming = payload.name.strip()
        if not contact.name or not str(contact.name).strip():
            contact.name = incoming
        elif len(incoming) > len(str(contact.name).strip()):
            contact.name = incoming
    merged_attrs = dict(contact.custom_attributes or {})
    merged_attrs.update(payload.custom_attributes or {})
    contact.custom_attributes = merged_attrs

    if payload.tag_ids:
        tags = db.query(Tag).filter(and_(Tag.tenant_id == membership.tenant_id, Tag.id.in_(payload.tag_ids))).all()
        tag_map = {tag.id: tag for tag in tags}
        missing = [tag_id for tag_id in payload.tag_ids if tag_id not in tag_map]
        if missing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more tags were not found")
        existing_tag_ids = {row.tag_id for row in db.query(ContactTag).filter(ContactTag.contact_id == contact.id).all()}
        for tag in tags:
            if tag.id not in existing_tag_ids:
                db.add(ContactTag(contact_id=contact.id, tag_id=tag.id))


@router.get("/tags", response_model=list[TagResponse])
def list_tags(membership: Membership = Depends(get_admin_or_agent_membership), db: Session = Depends(get_db)) -> list[TagResponse]:
    tags = db.query(Tag).filter(Tag.tenant_id == membership.tenant_id).order_by(Tag.name.asc()).all()
    return [_tag_to_schema(tag) for tag in tags]


@router.post("/tags", response_model=TagResponse, status_code=status.HTTP_201_CREATED)
def create_tag(
    payload: TagCreateRequest,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> TagResponse:
    existing = db.query(Tag).filter(and_(Tag.tenant_id == membership.tenant_id, Tag.name == payload.name.strip())).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Tag already exists")

    tag = Tag(tenant_id=membership.tenant_id, name=payload.name.strip())
    db.add(tag)
    db.commit()
    db.refresh(tag)
    return _tag_to_schema(tag)


@router.get("/contacts", response_model=list[ContactResponse])
def list_contacts(membership: Membership = Depends(get_admin_or_agent_membership), db: Session = Depends(get_db)) -> list[ContactResponse]:
    contacts = (
        db.query(Contact)
        .options(joinedload(Contact.tags).joinedload(ContactTag.tag))
        .filter(Contact.tenant_id == membership.tenant_id)
        .order_by(Contact.created_at.desc())
        .all()
    )
    return [_contact_to_schema(contact) for contact in contacts]


@router.post("/contacts", response_model=ContactResponse)
def create_contact(
    payload: ContactCreateRequest,
    response: Response,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> ContactResponse:
    normalized = normalize_phone_e164(payload.phone_e164)
    existing = find_contact_by_normalized_phone(db, tenant_id=membership.tenant_id, phone_e164=payload.phone_e164)
    if existing:
        _merge_create_payload_into_contact(db, existing, payload, membership)
        db.commit()
        merged = (
            db.query(Contact)
            .options(joinedload(Contact.tags).joinedload(ContactTag.tag))
            .filter(Contact.id == existing.id)
            .first()
        )
        response.status_code = status.HTTP_200_OK
        return _contact_to_schema(merged, merged_with_existing=True)

    contact = Contact(
        tenant_id=membership.tenant_id,
        phone_e164=normalized,
        name=payload.name.strip() if payload.name else None,
        custom_attributes=payload.custom_attributes or {},
    )
    db.add(contact)
    db.flush()

    if payload.tag_ids:
        tags = db.query(Tag).filter(and_(Tag.tenant_id == membership.tenant_id, Tag.id.in_(payload.tag_ids))).all()
        tag_map = {tag.id: tag for tag in tags}
        missing = [tag_id for tag_id in payload.tag_ids if tag_id not in tag_map]
        if missing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more tags were not found")
        for tag in tags:
            db.add(ContactTag(contact_id=contact.id, tag_id=tag.id))

    db.commit()
    created = (
        db.query(Contact)
        .options(joinedload(Contact.tags).joinedload(ContactTag.tag))
        .filter(Contact.id == contact.id)
        .first()
    )
    response.status_code = status.HTTP_201_CREATED
    return _contact_to_schema(created, merged_with_existing=False)


@router.put("/contacts/{contact_id}", response_model=ContactResponse)
def update_contact(
    contact_id: UUID,
    payload: ContactUpdateRequest,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> ContactResponse:
    contact = (
        db.query(Contact)
        .options(joinedload(Contact.tags).joinedload(ContactTag.tag))
        .filter(and_(Contact.id == contact_id, Contact.tenant_id == membership.tenant_id))
        .first()
    )
    if not contact:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")

    if payload.phone_e164 is not None:
        new_phone = normalize_phone_e164(payload.phone_e164)
        other = find_contact_by_normalized_phone(db, tenant_id=membership.tenant_id, phone_e164=payload.phone_e164)
        if other and other.id != contact.id:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="Another contact already uses this phone number",
            )
        contact.phone_e164 = new_phone
    if payload.name is not None:
        contact.name = payload.name.strip() if payload.name else None
    if payload.custom_attributes is not None:
        contact.custom_attributes = payload.custom_attributes

    if payload.tag_ids is not None:
        tags = db.query(Tag).filter(and_(Tag.tenant_id == membership.tenant_id, Tag.id.in_(payload.tag_ids))).all()
        tag_map = {tag.id: tag for tag in tags}
        missing = [tag_id for tag_id in payload.tag_ids if tag_id not in tag_map]
        if missing:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more tags were not found")

        db.query(ContactTag).filter(ContactTag.contact_id == contact.id).delete()
        for tag in tags:
            db.add(ContactTag(contact_id=contact.id, tag_id=tag.id))

    db.commit()
    updated = (
        db.query(Contact)
        .options(joinedload(Contact.tags).joinedload(ContactTag.tag))
        .filter(Contact.id == contact.id)
        .first()
    )
    return _contact_to_schema(updated)


@router.delete("/contacts/{contact_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_contact(
    contact_id: UUID,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> None:
    deleted = db.query(Contact).filter(and_(Contact.id == contact_id, Contact.tenant_id == membership.tenant_id)).delete()
    if not deleted:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Contact not found")
    db.commit()


@router.post("/contacts/filter", response_model=list[ContactResponse])
def filter_contacts(
    payload: ContactFilterRequest,
    membership: Membership = Depends(get_admin_or_agent_membership),
    db: Session = Depends(get_db),
) -> list[ContactResponse]:
    query = (
        db.query(Contact)
        .options(joinedload(Contact.tags).joinedload(ContactTag.tag))
        .filter(Contact.tenant_id == membership.tenant_id)
    )

    if payload.query:
        needle = f"%{payload.query.strip()}%"
        query = query.filter(or_(Contact.name.ilike(needle), Contact.phone_e164.ilike(needle)))

    if payload.custom_attribute_key and payload.custom_attribute_value is not None:
        query = query.filter(
            Contact.custom_attributes[payload.custom_attribute_key].astext == payload.custom_attribute_value
        )

    if payload.tag_ids:
        query = query.join(ContactTag, ContactTag.contact_id == Contact.id).filter(ContactTag.tag_id.in_(payload.tag_ids)).distinct()

    contacts = query.order_by(Contact.created_at.desc()).all()
    return [_contact_to_schema(contact) for contact in contacts]
