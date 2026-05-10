"""Add campaign recipient delivery tracking fields

Revision ID: 20260425_0002
Revises: 20260425_0001
Create Date: 2026-04-25 23:05:00
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = "20260425_0002"
down_revision: Union[str, None] = "20260425_0001"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("campaign_recipients", sa.Column("attempts", sa.Integer(), nullable=False, server_default="0"))
    op.add_column("campaign_recipients", sa.Column("last_error", sa.String(length=500), nullable=True))
    op.add_column("campaign_recipients", sa.Column("message_id", sa.String(length=255), nullable=True))
    op.add_column("campaign_recipients", sa.Column("next_retry_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaign_recipients", sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True))
    op.alter_column("campaign_recipients", "attempts", server_default=None)


def downgrade() -> None:
    op.drop_column("campaign_recipients", "sent_at")
    op.drop_column("campaign_recipients", "next_retry_at")
    op.drop_column("campaign_recipients", "message_id")
    op.drop_column("campaign_recipients", "last_error")
    op.drop_column("campaign_recipients", "attempts")
