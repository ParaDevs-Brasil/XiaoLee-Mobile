"""Mimic: vídeo de movimento e declaração de direitos em creator_videos.

Revision ID: 20261022_creator_motion
Revises: 20261021_onoff_ramp
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261022_creator_motion"
down_revision = "20261021_onoff_ramp"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("creator_videos", sa.Column("motion_key", sa.Text(), nullable=True))
    op.add_column("creator_videos", sa.Column("motion_rights_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("creator_videos", "motion_rights_at")
    op.drop_column("creator_videos", "motion_key")
