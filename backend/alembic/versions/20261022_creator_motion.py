"""Mimic/Swap: vídeo de movimento, direitos, áudio e prévia em creator_videos; tabela creator_previews.

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
    op.add_column("creator_videos", sa.Column("audio", sa.String(length=10), nullable=False, server_default="none"))
    op.add_column("creator_videos", sa.Column("preview_id", sa.Integer(), nullable=True))
    op.create_index("ix_creator_videos_preview_id", "creator_videos", ["preview_id"])
    op.create_table(
        "creator_previews",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("creator_id", sa.Integer(), nullable=False),
        sa.Column("motion_key", sa.Text(), nullable=False),
        sa.Column("frame_key", sa.Text(), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["creator_id"], ["synthetic_creators.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_creator_previews_user_id", "creator_previews", ["user_id"])
    op.create_index("ix_creator_previews_creator_id", "creator_previews", ["creator_id"])


def downgrade() -> None:
    op.drop_table("creator_previews")
    op.drop_index("ix_creator_videos_preview_id", table_name="creator_videos")
    op.drop_column("creator_videos", "preview_id")
    op.drop_column("creator_videos", "audio")
    op.drop_column("creator_videos", "motion_rights_at")
    op.drop_column("creator_videos", "motion_key")
