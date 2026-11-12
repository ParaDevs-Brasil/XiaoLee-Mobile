"""Mimic/Swap: segundo do vídeo de referência onde o trecho começa (corte estilo editor).

Revision ID: 20261024_creator_motion_start
Revises: 20261010_usage_counters
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261024_creator_motion_start"
down_revision = "20261010_usage_counters"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("creator_videos", "creator_previews"):
        op.add_column(table, sa.Column("motion_start_s", sa.Float(), nullable=False, server_default="0"))


def downgrade() -> None:
    for table in ("creator_previews", "creator_videos"):
        op.drop_column(table, "motion_start_s")
