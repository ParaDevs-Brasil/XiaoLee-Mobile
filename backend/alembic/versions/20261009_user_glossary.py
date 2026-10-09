"""Glossário do creator em users (JSON, nullable): dica de vocabulário para a transcrição (#28).

Revision ID: 20261009_user_glossary
Revises: 20261009_media_clips
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261009_user_glossary"
down_revision = "20261009_media_clips"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("users", sa.Column("glossary", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "glossary")
