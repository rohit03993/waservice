"""tenant setup_status for agent onboarding (pending_meta -> active)"""

from alembic import op
import sqlalchemy as sa

revision = "20260612_0010"
down_revision = "20260513_0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "tenants",
        sa.Column("setup_status", sa.String(length=32), server_default="pending_meta", nullable=False),
    )
    # Workspaces that already have a WhatsApp connection are treated as active.
    op.execute(
        """
        UPDATE tenants t
        SET setup_status = 'active'
        WHERE EXISTS (
            SELECT 1 FROM whatsapp_connections w
            WHERE w.tenant_id = t.id AND w.phone_number_id IS NOT NULL AND w.phone_number_id <> ''
        )
        """
    )


def downgrade() -> None:
    op.drop_column("tenants", "setup_status")
