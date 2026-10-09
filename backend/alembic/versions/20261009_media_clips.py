"""Clipper (S4, #29): tabela `media_clips` (cortes verticais legendados de um MediaAsset).

Revision ID: 20261009_media_clips
Revises: 20261008_media_assets
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261009_media_clips"
down_revision = "20261008_media_assets"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_clips",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("media_id", sa.Integer(), nullable=False),
        sa.Column("rank", sa.Integer(), nullable=False),
        sa.Column("start_s", sa.Float(), nullable=False),
        sa.Column("end_s", sa.Float(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("reason", sa.String(length=300), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("r2_key", sa.Text(), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["media_id"], ["media_assets.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_media_clips_user_id"), "media_clips", ["user_id"], unique=False)
    op.create_index(op.f("ix_media_clips_media_id"), "media_clips", ["media_id"], unique=False)
    op.create_index(op.f("ix_media_clips_status"), "media_clips", ["status"], unique=False)


def downgrade() -> None:
    op.drop_index(op.f("ix_media_clips_status"), table_name="media_clips")
    op.drop_index(op.f("ix_media_clips_media_id"), table_name="media_clips")
    op.drop_index(op.f("ix_media_clips_user_id"), table_name="media_clips")
    op.drop_table("media_clips")
