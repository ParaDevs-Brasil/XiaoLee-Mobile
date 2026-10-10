"""Clipper (S4, #28): tabela `media_glossaries` (termos do creator para a transcrição; fora de `users`).

Revision ID: 20261010_media_glossary
Revises: 20261009_media_clips
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261010_media_glossary"
down_revision = "20261009_media_clips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "media_glossaries",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("terms", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id"),
    )


def downgrade() -> None:
    op.drop_table("media_glossaries")
