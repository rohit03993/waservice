"""Contact last_inbound_at + template-based campaigns.

Revision ID: 20260513_0007
Revises: 20260513_0006
Create Date: 2026-05-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260513_0007"
down_revision: Union[str, None] = "20260513_0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("contacts", sa.Column("last_inbound_at", sa.DateTime(timezone=True), nullable=True))
    op.create_index("ix_contacts_last_inbound_at", "contacts", ["last_inbound_at"], unique=False)

    op.add_column("campaigns", sa.Column("template_name", sa.String(length=120), nullable=True))
    op.add_column("campaigns", sa.Column("template_language", sa.String(length=20), nullable=True))
    op.alter_column("campaigns", "message_text", existing_type=sa.String(length=1000), nullable=True)

    # Backfill last_inbound_at from stored inbound messages.
    op.execute(
        """
        UPDATE contacts c
        SET last_inbound_at = sub.max_ts
        FROM (
            SELECT contact_id, tenant_id, MAX(created_at) AS max_ts
            FROM messages
            WHERE direction = 'inbound'
            GROUP BY contact_id, tenant_id
        ) sub
        WHERE c.id = sub.contact_id AND c.tenant_id = sub.tenant_id
        """
    )


def downgrade() -> None:
    op.alter_column("campaigns", "message_text", existing_type=sa.String(length=1000), nullable=False)
    op.drop_column("campaigns", "template_language")
    op.drop_column("campaigns", "template_name")
    op.drop_index("ix_contacts_last_inbound_at", table_name="contacts")
    op.drop_column("contacts", "last_inbound_at")
