"""Clipper: miniatura (`thumb_key`) de mídia e de corte, e título editável da mídia.

Revision ID: 20261010_media_thumbs
Revises: 20261009_user_glossary
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261010_media_thumbs"
down_revision = "20261009_user_glossary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_assets", sa.Column("title", sa.String(length=120), nullable=True))
    op.add_column("media_assets", sa.Column("thumb_key", sa.Text(), nullable=True))
    op.add_column("media_clips", sa.Column("thumb_key", sa.Text(), nullable=True))


def downgrade() -> None:
    op.drop_column("media_clips", "thumb_key")
    op.drop_column("media_assets", "thumb_key")
    op.drop_column("media_assets", "title")
