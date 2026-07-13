"""Create the message-complete Gold alert archive.

Revision ID: 0080_alert_archive
Revises: 0079_alert_history_messages
Create Date: 2026-07-13

The existing Silver alert source is intentionally short-lived. This table is
the rebuildable Gold source for retained public alert history. The migration is
DDL-only: a bounded command performs the initial sync after upgrade, so Alembic
never hides a large backfill inside a deployment transaction.
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects.postgresql import ARRAY, JSONB

revision = "0080_alert_archive"
down_revision = "0079_alert_history_messages"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_archive_entry",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("alert_id", sa.Text(), nullable=False),
        sa.Column("archive_month", sa.Date(), nullable=False),
        sa.Column("header_text", sa.Text(), nullable=True),
        sa.Column("header_text_en", sa.Text(), nullable=True),
        sa.Column("description_text", sa.Text(), nullable=True),
        sa.Column("description_text_en", sa.Text(), nullable=True),
        sa.Column("severity", sa.Text(), nullable=True),
        sa.Column("cause", sa.Text(), nullable=True),
        sa.Column("effect", sa.Text(), nullable=True),
        sa.Column(
            "route_ids",
            ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column(
            "stop_ids",
            ARRAY(sa.Text()),
            nullable=False,
            server_default=sa.text("'{}'::text[]"),
        ),
        sa.Column("start_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("end_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "active_periods",
            JSONB(),
            nullable=False,
            server_default=sa.text("'[]'::jsonb"),
        ),
        sa.Column("url", sa.Text(), nullable=True),
        sa.Column("first_seen_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("last_seen_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("content_hash", sa.Text(), nullable=False),
        sa.Column(
            "updated_at_utc",
            sa.DateTime(timezone=True),
            nullable=False,
            server_default=sa.text("now()"),
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "alert_id",
            name="pk_gold_alert_archive_entry",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_alert_archive_entry_provider_id",
        ),
        sa.CheckConstraint(
            "archive_month = date_trunc('month', archive_month)::date",
            name="ck_gold_alert_archive_entry_month_start",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_alert_archive_entry_provider_month_start",
        "alert_archive_entry",
        [
            "provider_id",
            sa.text("archive_month DESC"),
            sa.text("start_utc DESC"),
            "alert_id",
        ],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_alert_archive_entry_provider_month_start",
        table_name="alert_archive_entry",
        schema="gold",
    )
    op.drop_table("alert_archive_entry", schema="gold")
