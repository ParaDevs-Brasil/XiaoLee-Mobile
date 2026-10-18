"""Clipper: layout (`crop`/`fit`) usado em cada corte, para re-renderizar um corte editado sem nova chamada à IA.

Revision ID: 20261018_clip_layout
Revises: 20261016_creator_reports
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261018_clip_layout"
down_revision = "20261016_creator_reports"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("media_clips", sa.Column("layout", sa.String(length=8), nullable=True))


def downgrade() -> None:
    op.drop_column("media_clips", "layout")
