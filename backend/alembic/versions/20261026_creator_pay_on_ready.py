"""Criadores: guarda a autorização de pagamento e só cobra quando o vídeo fica pronto.

Revision ID: 20261026_creator_pay_on_ready
Revises: 20261024_creator_motion_start
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261026_creator_pay_on_ready"
down_revision = "20261024_creator_motion_start"
branch_labels = None
depends_on = None

_COLS = (
    ("payment_signature", sa.Text()),
    ("payment_to", sa.String(64)),
    ("payment_value", sa.BigInteger()),
    ("payment_valid_after", sa.BigInteger()),
    ("payment_valid_before", sa.BigInteger()),
)


def upgrade() -> None:
    for name, type_ in _COLS:
        op.add_column("creator_videos", sa.Column(name, type_, nullable=True))


def downgrade() -> None:
    for name, _ in reversed(_COLS):
        op.drop_column("creator_videos", name)
