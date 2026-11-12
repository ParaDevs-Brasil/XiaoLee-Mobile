"""AI Creators: quadro (miniatura) do vídeo pronto.

Revision ID: 20261111_creator_video_thumb
Revises: 20261026_creator_pay_on_ready
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261111_creator_video_thumb"
down_revision = "20261026_creator_pay_on_ready"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("creator_videos", sa.Column("thumb_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("creator_videos", "thumb_key")
