"""On/off-ramp: `onoff_intents`, `onoff_events` (auditoria append-only) e `onoff_kyc`.

Revision ID: 20261021_onoff_ramp
Revises: 20261020_synthetic_creators
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "20261021_onoff_ramp"
down_revision = "20261020_synthetic_creators"
branch_labels = None
depends_on = None


def _base() -> list[sa.Column]:
    return [
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
    ]


def upgrade() -> None:
    op.create_table(
        "onoff_intents",
        *_base(),
        sa.Column("intent_id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("direction", sa.String(length=10), nullable=False),
        sa.Column("method", sa.String(length=24), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("amount_usdc", sa.Numeric(20, 8), nullable=False),
        sa.Column("fiat_currency", sa.String(length=3), nullable=True),
        sa.Column("status", sa.String(length=24), nullable=False),
        sa.Column("provider_ref", sa.String(length=128), nullable=True),
        sa.Column("dest_network", sa.String(length=24), nullable=True),
        sa.Column("dest_address", sa.String(length=128), nullable=True),
        sa.Column("onchain_tx", sa.Text(), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index("ix_onoff_intents_intent_id", "onoff_intents", ["intent_id"], unique=True)
    op.create_index("ix_onoff_intents_user_id", "onoff_intents", ["user_id"])
    op.create_index("ix_onoff_intents_status", "onoff_intents", ["status"])
    op.create_index("ix_onoff_intents_provider_ref", "onoff_intents", ["provider_ref"])

    op.create_table(
        "onoff_events",
        *_base(),
        sa.Column("intent_id", sa.Integer(), nullable=False),
        sa.Column("from_status", sa.String(length=24), nullable=True),
        sa.Column("to_status", sa.String(length=24), nullable=False),
        sa.Column("actor", sa.String(length=16), nullable=False),
        sa.Column("event_id", sa.String(length=128), nullable=True),
        sa.Column("payload_hash", sa.String(length=64), nullable=True),
        sa.ForeignKeyConstraint(["intent_id"], ["onoff_intents.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("event_id"),
    )
    op.create_index("ix_onoff_events_intent_id", "onoff_events", ["intent_id"])

    op.create_table(
        "onoff_kyc",
        *_base(),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("provider", sa.String(length=32), nullable=False),
        sa.Column("level", sa.Integer(), nullable=False),
        sa.Column("status", sa.String(length=16), nullable=False),
        sa.Column("subject", sa.String(length=8), nullable=False),
        sa.Column("customer_ref", sa.String(length=128), nullable=True),
        sa.Column("verified_at", sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "provider", name="uq_onoff_kyc_user_provider"),
    )
    op.create_index("ix_onoff_kyc_user_id", "onoff_kyc", ["user_id"])


def downgrade() -> None:
    op.drop_table("onoff_kyc")
    op.drop_table("onoff_events")
    op.drop_table("onoff_intents")
