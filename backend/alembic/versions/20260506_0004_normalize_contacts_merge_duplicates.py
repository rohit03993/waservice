"""Normalize contact phone_e164 and merge duplicates (same number, different formatting).

Revision ID: 20260506_0004
Revises: 20260506_0003
Create Date: 2026-05-06
"""

from collections import defaultdict
from pathlib import Path
import sys
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.orm import load_only, sessionmaker

# revision identifiers, used by Alembic.
revision: str = "20260506_0004"
down_revision: Union[str, None] = "20260506_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _contact_load_options():
    from app.models.contact import Contact

    # Schema at this revision has no last_inbound_at (added in 20260513_0007).
    return load_only(
        Contact.id,
        Contact.tenant_id,
        Contact.phone_e164,
        Contact.name,
        Contact.custom_attributes,
        Contact.created_at,
        Contact.updated_at,
    )


def upgrade() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    bind = op.get_bind()
    contact_count = bind.execute(sa.text("SELECT COUNT(*) FROM contacts")).scalar_one()
    if contact_count == 0:
        return

    session = sessionmaker(bind=bind)()

    from app.core.phone import normalize_phone_e164
    from app.models.contact import Contact
    from app.services.contact_merge import merge_contacts

    contact_opts = _contact_load_options()
    contacts = (
        session.query(Contact)
        .options(contact_opts)
        .order_by(Contact.created_at.asc())
        .all()
    )
    groups: dict = defaultdict(list)
    for c in contacts:
        key = (c.tenant_id, normalize_phone_e164(c.phone_e164))
        groups[key].append(c)

    for group in groups.values():
        if len(group) <= 1:
            continue
        keeper = group[0]
        for dup in group[1:]:
            merge_contacts(session, keeper=keeper, duplicate=dup)
        keeper.phone_e164 = normalize_phone_e164(keeper.phone_e164)

    for c in session.query(Contact).options(contact_opts).all():
        c.phone_e164 = normalize_phone_e164(c.phone_e164)

    session.commit()


def downgrade() -> None:
    pass
