"""Criadores sintéticos: synthetic_creators + creator_videos.

Revision ID: 20261020_synthetic_creators
Revises: 20261019_payout_guards
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261020_synthetic_creators"
down_revision = "20261019_payout_guards"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "synthetic_creators",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("name", sa.String(length=60), nullable=False),
        sa.Column("voice_id", sa.String(length=64), nullable=False),
        sa.Column("ref_image_key", sa.Text(), nullable=False),
        sa.Column("ref_content_type", sa.String(length=50), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("ref_image_key"),
    )
    op.create_index("ix_synthetic_creators_user_id", "synthetic_creators", ["user_id"])
    op.create_table(
        "creator_videos",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("creator_id", sa.Integer(), nullable=False),
        sa.Column("quality", sa.String(length=20), nullable=False),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.Column("duration_s", sa.Integer(), nullable=False),
        sa.Column("script", sa.Text(), nullable=False),
        sa.Column("price_usdc", sa.Numeric(12, 6), nullable=False),
        sa.Column("payment_from", sa.String(length=64), nullable=False),
        sa.Column("payment_nonce", sa.String(length=80), nullable=False),
        sa.Column("payment_tx", sa.String(length=100), nullable=True),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("refund_due", sa.Boolean(), nullable=False),
        sa.Column("video_key", sa.Text(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["creator_id"], ["synthetic_creators.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("payment_nonce"),
    )
    op.create_index("ix_creator_videos_user_id", "creator_videos", ["user_id"])
    op.create_index("ix_creator_videos_creator_id", "creator_videos", ["creator_id"])
    op.create_index("ix_creator_videos_status", "creator_videos", ["status"])


def downgrade() -> None:
    op.drop_table("creator_videos")
    op.drop_table("synthetic_creators")
