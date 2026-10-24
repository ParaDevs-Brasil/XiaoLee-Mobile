"""Contas sociais do creator e posts feitos pela Xiaolee: `social_accounts` e `post_publications`.

Revision ID: 20261018_social_accounts
Revises: 20261016_creator_reports
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261018_social_accounts"
down_revision = "20261018_clip_layout"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "social_accounts",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("platform", sa.String(length=20), nullable=False),
        sa.Column("external_id", sa.String(length=128), nullable=False),
        sa.Column("handle", sa.String(length=128), nullable=False),
        sa.Column("credentials_enc", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "platform", name="uq_social_account_platform"),
    )
    op.create_index("ix_social_accounts_user_id", "social_accounts", ["user_id"])
    op.create_table(
        "post_publications",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("clip_id", sa.Integer(), nullable=True),
        sa.Column("platform", sa.String(length=20), nullable=False),
        sa.Column("caption", sa.Text(), nullable=False),
        sa.Column("status", sa.String(length=20), nullable=False),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("external_post_id", sa.String(length=300), nullable=True),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("published_at", sa.DateTime(), nullable=True),
        sa.Column("metrics_json", sa.Text(), nullable=True),
        sa.Column("metrics_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["clip_id"], ["media_clips.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_post_publications_user_id", "post_publications", ["user_id"])
    op.create_index("ix_post_publications_platform", "post_publications", ["platform"])
    op.create_index("ix_post_publications_status", "post_publications", ["status"])


def downgrade() -> None:
    op.drop_table("post_publications")
    op.drop_table("social_accounts")
