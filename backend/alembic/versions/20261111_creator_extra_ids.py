"""AI Creators: mais de um personagem por vídeo (Mimic/Swap).

Revision ID: 20261111_creator_extra_ids
Revises: 20261111_creator_video_thumb
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261111_creator_extra_ids"
down_revision = "20261111_creator_video_thumb"
branch_labels = None
depends_on = None


def upgrade() -> None:
    for table in ("creator_videos", "creator_previews"):
        op.add_column(table, sa.Column("extra_creator_ids", sa.Text(), nullable=True))


def downgrade() -> None:
    for table in ("creator_previews", "creator_videos"):
        op.drop_column(table, "extra_creator_ids")
