"""Clipper (S4): tabelas `media_assets` (mídia bruta no R2) e `media_transcripts`.

Revision ID: 20261008_media_assets
Revises: 20261001_onboarding
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261008_media_assets"
down_revision = "20261001_onboarding"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_assets",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("kind", sa.String(length=10), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("content_type", sa.String(length=100), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("r2_key", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("duration_s", sa.Float(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("r2_key"),
    )
    op.create_index(op.f("ix_media_assets_user_id"), "media_assets", ["user_id"], unique=False)
    op.create_index(op.f("ix_media_assets_status"), "media_assets", ["status"], unique=False)
    op.create_table(
        "media_transcripts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("media_id", sa.Integer(), nullable=False),
        sa.Column("segments_json", sa.Text(), nullable=False),
        sa.Column("language", sa.String(length=16), nullable=True),
        sa.Column("model", sa.String(length=100), nullable=False),
        sa.ForeignKeyConstraint(["media_id"], ["media_assets.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("media_id"),
    )


def downgrade() -> None:
    op.drop_table("media_transcripts")
    op.drop_index(op.f("ix_media_assets_status"), table_name="media_assets")
    op.drop_index(op.f("ix_media_assets_user_id"), table_name="media_assets")
    op.drop_table("media_assets")
