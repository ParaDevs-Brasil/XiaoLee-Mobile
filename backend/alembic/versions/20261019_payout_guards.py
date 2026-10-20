"""Travas de pagamento: `paid_at` e `paid_wallet` em campaign_participants.

Revision ID: 20261019_payout_guards
Revises: 20261016_creator_reports
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261019_payout_guards"
down_revision = "20261018_social_accounts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column("campaign_participants", sa.Column("paid_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("campaign_participants", sa.Column("paid_wallet", sa.String(length=64), nullable=True))
    op.create_index("ix_campaign_participants_paid_at", "campaign_participants", ["paid_at"])


def downgrade() -> None:
    op.drop_index("ix_campaign_participants_paid_at", table_name="campaign_participants")
    op.drop_column("campaign_participants", "paid_wallet")
    op.drop_column("campaign_participants", "paid_at")
