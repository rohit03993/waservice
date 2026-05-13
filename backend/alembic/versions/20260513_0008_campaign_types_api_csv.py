"""campaign types and per-recipient template variables

Revision ID: 20260513_0008
Revises: 20260513_0007
Create Date: 2026-05-13
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "20260513_0008"
down_revision = "20260513_0007"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "campaigns",
        sa.Column("campaign_type", sa.String(length=20), nullable=False, server_default="contacts"),
    )
    op.add_column(
        "campaign_recipients",
        sa.Column("template_variables", postgresql.JSONB(astext_type=sa.Text()), nullable=True),
    )
    op.alter_column("campaigns", "campaign_type", server_default=None)


def downgrade() -> None:
    op.drop_column("campaign_recipients", "template_variables")
    op.drop_column("campaigns", "campaign_type")
