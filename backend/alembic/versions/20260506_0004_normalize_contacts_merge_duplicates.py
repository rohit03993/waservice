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
from sqlalchemy.orm import sessionmaker

# revision identifiers, used by Alembic.
revision: str = "20260506_0004"
down_revision: Union[str, None] = "20260506_0003"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    backend_root = Path(__file__).resolve().parents[2]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    bind = op.get_bind()
    session = sessionmaker(bind=bind)()

    from app.core.phone import normalize_phone_e164
    from app.models.contact import Contact
    from app.services.contact_merge import merge_contacts

    contacts = session.query(Contact).order_by(Contact.created_at.asc()).all()
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

    for c in session.query(Contact).all():
        c.phone_e164 = normalize_phone_e164(c.phone_e164)

    session.commit()


def downgrade() -> None:
    pass
