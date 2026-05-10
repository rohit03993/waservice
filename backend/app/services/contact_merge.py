"""Merge CRM contacts that represent the same phone number (after normalization)."""

from uuid import UUID

from sqlalchemy.orm import Session

from app.core.phone import normalize_phone_e164
from app.models.campaign_recipient import CampaignRecipient
from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.conversation import Conversation
from app.models.message import Message


def find_contact_by_normalized_phone(db: Session, *, tenant_id: UUID, phone_e164: str) -> Contact | None:
    normalized = normalize_phone_e164(phone_e164)
    if not normalized:
        return None
    for row in db.query(Contact).filter(Contact.tenant_id == tenant_id).all():
        if normalize_phone_e164(row.phone_e164) == normalized:
            return row
    return None


def merge_contacts(db: Session, *, keeper: Contact, duplicate: Contact) -> None:
    if keeper.id == duplicate.id:
        return
    if keeper.tenant_id != duplicate.tenant_id:
        raise ValueError("Contacts must belong to the same tenant")

    conv_k = (
        db.query(Conversation)
        .filter(Conversation.tenant_id == keeper.tenant_id, Conversation.contact_id == keeper.id)
        .first()
    )
    conv_d = (
        db.query(Conversation)
        .filter(Conversation.tenant_id == duplicate.tenant_id, Conversation.contact_id == duplicate.id)
        .first()
    )

    if conv_d and conv_k:
        db.query(Message).filter(Message.conversation_id == conv_d.id).update(
            {Message.conversation_id: conv_k.id, Message.contact_id: keeper.id},
            synchronize_session=False,
        )
        db.delete(conv_d)
        db.flush()
    elif conv_d and not conv_k:
        conv_d.contact_id = keeper.id
        db.flush()

    db.query(Message).filter(Message.contact_id == duplicate.id).update({Message.contact_id: keeper.id}, synchronize_session=False)

    primary_conv = (
        db.query(Conversation)
        .filter(Conversation.tenant_id == keeper.tenant_id, Conversation.contact_id == keeper.id)
        .first()
    )
    if primary_conv:
        db.query(Message).filter(Message.contact_id == keeper.id, Message.conversation_id != primary_conv.id).update(
            {Message.conversation_id: primary_conv.id},
            synchronize_session=False,
        )

    recipients_d = db.query(CampaignRecipient).filter(CampaignRecipient.contact_id == duplicate.id).all()
    for r in recipients_d:
        exists = (
            db.query(CampaignRecipient)
            .filter(
                CampaignRecipient.campaign_id == r.campaign_id,
                CampaignRecipient.contact_id == keeper.id,
            )
            .first()
        )
        if exists:
            db.delete(r)
        else:
            r.contact_id = keeper.id

    keeper_tag_ids = {row.tag_id for row in db.query(ContactTag).filter(ContactTag.contact_id == keeper.id).all()}
    dup_tag_ids = {row.tag_id for row in db.query(ContactTag).filter(ContactTag.contact_id == duplicate.id).all()}
    for tid in dup_tag_ids:
        if tid not in keeper_tag_ids:
            db.add(ContactTag(contact_id=keeper.id, tag_id=tid))
            keeper_tag_ids.add(tid)
    db.query(ContactTag).filter(ContactTag.contact_id == duplicate.id).delete(synchronize_session=False)

    db.delete(duplicate)
    db.flush()
    keeper.phone_e164 = normalize_phone_e164(keeper.phone_e164)
