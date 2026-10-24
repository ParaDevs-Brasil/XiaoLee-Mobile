"""Relatório de 30 dias do creator: tabela `creator_reports` (métricas do período + sugestões da IA).

Revision ID: 20261016_creator_reports
Revises: 20261010_media_thumbs
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261016_creator_reports"
down_revision = "20261010_media_thumbs"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "creator_reports",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("period_start", sa.DateTime(), nullable=False),
        sa.Column("period_end", sa.DateTime(), nullable=False),
        sa.Column("metrics_json", sa.Text(), nullable=False),
        sa.Column("summary", sa.Text(), nullable=False),
        sa.Column("suggestions_json", sa.Text(), nullable=False),
        sa.Column("lang", sa.String(length=8), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "period_start", name="uq_creator_report_period"),
    )
    op.create_index("ix_creator_reports_user_id", "creator_reports", ["user_id"])


def downgrade() -> None:
    op.drop_index("ix_creator_reports_user_id", table_name="creator_reports")
    op.drop_table("creator_reports")
