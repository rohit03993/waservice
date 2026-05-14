from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import and_
from sqlalchemy.orm import Session

from app.core.phone import normalize_phone_e164
from app.models.contact import Contact
from app.models.contact_tag import ContactTag
from app.models.tag import Tag

_MAX_CONTACT_CSV_BYTES = 6 * 1024 * 1024
_PHONE_HEADERS = frozenset({"phone_e164", "phone", "mobile"})
_NAME_HEADERS = frozenset({"name"})


@dataclass
class ContactCsvImportResult:
    created_contacts: int
    updated_contacts: int
    tagged_contacts: int
    skipped_rows: int


def decode_contact_csv(content: bytes) -> str:
    if len(content) > _MAX_CONTACT_CSV_BYTES:
        max_mb = _MAX_CONTACT_CSV_BYTES // (1024 * 1024)
        raise ValueError(f"CSV too large (max {max_mb} MB)")
    try:
        return content.decode("utf-8-sig")
    except UnicodeDecodeError as error:
        raise ValueError("CSV file must be UTF-8 encoded") from error


def import_contacts_from_csv(
    *,
    db: Session,
    tenant_id: UUID,
    decoded: str,
    tag_ids: list[UUID],
) -> ContactCsvImportResult:
    reader = csv.DictReader(io.StringIO(decoded))
    if not reader.fieldnames:
        raise ValueError("CSV file is missing header row")

    header_map = {field.strip().lower(): field for field in reader.fieldnames if field}
    phone_col = next((header_map[key] for key in _PHONE_HEADERS if key in header_map), None)
    name_col = header_map.get("name")
    if not phone_col:
        raise ValueError("CSV must include phone_e164 column (or phone/mobile)")

    attribute_cols = [
        key
        for key in header_map
        if key not in _PHONE_HEADERS and key not in _NAME_HEADERS
    ]

    tags: list[Tag] = []
    if tag_ids:
        tags = db.query(Tag).filter(and_(Tag.tenant_id == tenant_id, Tag.id.in_(tag_ids))).all()
        tag_map = {tag.id: tag for tag in tags}
        missing = [tag_id for tag_id in tag_ids if tag_id not in tag_map]
        if missing:
            raise ValueError("One or more tags were not found")

    existing_contacts = db.query(Contact).filter(Contact.tenant_id == tenant_id).all()
    by_phone = {item.phone_e164: item for item in existing_contacts}

    created_contacts = 0
    updated_contacts = 0
    tagged_contacts = 0
    skipped_rows = 0

    for row in reader:
        raw_phone = (row.get(phone_col) or "").strip()
        if not raw_phone:
            skipped_rows += 1
            continue
        try:
            normalized_phone = normalize_phone_e164(raw_phone)
        except (ValueError, TypeError):
            skipped_rows += 1
            continue
        if not normalized_phone or not normalized_phone.startswith("+") or len(normalized_phone) < 10:
            skipped_rows += 1
            continue

        raw_name = (row.get(name_col) or "").strip() if name_col else ""
        row_attributes = {
            key: (row.get(header_map[key]) or "").strip()
            for key in attribute_cols
            if (row.get(header_map[key]) or "").strip()
        }

        contact = by_phone.get(normalized_phone)
        if not contact:
            contact = Contact(
                id=uuid4(),
                tenant_id=tenant_id,
                phone_e164=normalized_phone,
                name=raw_name or None,
                custom_attributes=row_attributes,
            )
            db.add(contact)
            db.flush()
            by_phone[normalized_phone] = contact
            created_contacts += 1
        else:
            updated = False
            if raw_name and (not contact.name or not str(contact.name).strip()):
                contact.name = raw_name
                updated = True
            if row_attributes:
                merged_attrs = dict(contact.custom_attributes or {})
                merged_attrs.update(row_attributes)
                contact.custom_attributes = merged_attrs
                updated = True
            if updated:
                updated_contacts += 1

        if tags:
            existing_tag_ids = {
                row.tag_id for row in db.query(ContactTag).filter(ContactTag.contact_id == contact.id).all()
            }
            applied = False
            for tag in tags:
                if tag.id not in existing_tag_ids:
                    db.add(ContactTag(contact_id=contact.id, tag_id=tag.id))
                    applied = True
            if applied:
                tagged_contacts += 1

    return ContactCsvImportResult(
        created_contacts=created_contacts,
        updated_contacts=updated_contacts,
        tagged_contacts=tagged_contacts,
        skipped_rows=skipped_rows,
    )
