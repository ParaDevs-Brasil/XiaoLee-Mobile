"""onboarding_profile

Campos de perfil do onboarding em users (todos nullable).

Revision ID: 20261001_onboarding
Revises: 20260808_arc_transfers
Create Date: 2026-10-01
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20261001_onboarding"
down_revision = "20260808_arc_transfers"
branch_labels = None
depends_on = None

_COLUMNS = [
    ("full_name", sa.String(255)),
    ("state", sa.String(64)),
    ("city", sa.String(128)),
    ("bio", sa.Text()),
    ("social_links", sa.Text()),
    ("interest_profile", sa.Text()),
]


def upgrade() -> None:
    for name, type_ in _COLUMNS:
        op.add_column("users", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLUMNS):
        op.drop_column("users", name)
