"""Optional E.164 phone on users for SMS OTP login.

Revision ID: 20260513_0006
Revises: 20260507_0005
Create Date: 2026-05-13
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "20260513_0006"
down_revision: Union[str, None] = "20260507_0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("users", sa.Column("phone_e164", sa.String(length=20), nullable=True))
    op.create_index("ix_users_phone_e164", "users", ["phone_e164"], unique=True)


def downgrade() -> None:
    op.drop_index("ix_users_phone_e164", table_name="users")
    op.drop_column("users", "phone_e164")
