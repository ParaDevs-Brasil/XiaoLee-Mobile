"""usage_counters

Contador diário de mensagens que chegam na LLM (cota do plano grátis + disjuntor global).

Revision ID: 20261010_usage_counters
Revises: 20261010_media_glossary
Create Date: 2026-10-10
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa

revision = "20261010_usage_counters"
down_revision = "20261010_media_glossary"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "usage_counters",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("created_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("updated_at", sa.DateTime(), server_default=sa.func.now()),
        sa.Column("key", sa.String(255), nullable=False),
        sa.Column("day", sa.String(10), nullable=False),
        sa.Column("count", sa.Integer(), nullable=False, server_default="0"),
        sa.UniqueConstraint("key", "day", name="uq_usage_counters_key_day"),
    )
    op.create_index("ix_usage_counters_key", "usage_counters", ["key"])


def downgrade() -> None:
    op.drop_index("ix_usage_counters_key", table_name="usage_counters")
    op.drop_table("usage_counters")
