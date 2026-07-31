"""Add pre-coalescing alert-language observations and retained measurements.

Revision ID: 0084_alert_language_coverage
Revises: 0083_snapshot_historic_receipts
Create Date: 2026-07-30
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0084_alert_language_coverage"
down_revision = "0083_snapshot_historic_receipts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "alert_language_observations",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("alert_logical_id", sa.Text(), nullable=False),
        sa.Column("observation_date", sa.Date(), nullable=False),
        sa.Column("has_explicit_fr", sa.Boolean(), nullable=False),
        sa.Column("has_explicit_en", sa.Boolean(), nullable=False),
        sa.Column("undetermined", sa.Boolean(), nullable=False),
        sa.Column("observed_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "alert_logical_id",
            "observation_date",
            name="pk_raw_alert_language_observations",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_raw_alert_language_observations_provider_id",
        ),
        sa.CheckConstraint(
            "undetermined = NOT (has_explicit_fr OR has_explicit_en)",
            name="ck_raw_alert_language_observations_bucket",
        ),
        schema="raw",
    )
    op.create_index(
        "ix_raw_alert_language_observations_window",
        "alert_language_observations",
        ["provider_id", "observation_date"],
        schema="raw",
    )

    # A successful empty feed has no per-alert rows. This daily capture row is
    # therefore the evidence that lets measurement distinguish "no alerts" from
    # "feed configured, but no observation available".
    op.create_table(
        "alert_feed_observations",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("observation_date", sa.Date(), nullable=False),
        sa.Column("alert_count", sa.Integer(), nullable=False),
        sa.Column("observed_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "observation_date",
            name="pk_raw_alert_feed_observations",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_raw_alert_feed_observations_provider_id",
        ),
        sa.CheckConstraint(
            "alert_count >= 0",
            name="ck_raw_alert_feed_observations_count",
        ),
        schema="raw",
    )

    op.create_table(
        "alert_language_coverage_samples",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("measurement_date", sa.Date(), nullable=False),
        sa.Column("window_days", sa.SmallInteger(), nullable=False),
        sa.Column("window_start", sa.Date(), nullable=False),
        sa.Column("window_end", sa.Date(), nullable=False),
        sa.Column("state", sa.Text(), nullable=False),
        sa.Column("explicit_en_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("explicit_fr_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("undetermined_pct", sa.Numeric(5, 2), nullable=True),
        sa.Column("denominator", sa.Integer(), nullable=False),
        sa.Column("alert_observation_count", sa.Integer(), nullable=False),
        sa.Column("feed_observation_days", sa.Integer(), nullable=False),
        sa.Column("measured_at_utc", sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "measurement_date",
            "window_days",
            name="pk_core_alert_language_coverage_samples",
        ),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_core_alert_language_coverage_samples_provider_id",
        ),
        sa.CheckConstraint(
            "window_days IN (7, 30)",
            name="ck_core_alert_language_coverage_samples_window",
        ),
        sa.CheckConstraint(
            "state IN ('available', 'no-alerts', 'unavailable', 'unsupported')",
            name="ck_core_alert_language_coverage_samples_state",
        ),
        sa.CheckConstraint(
            "window_start <= window_end AND measurement_date = window_end",
            name="ck_core_alert_language_coverage_samples_dates",
        ),
        sa.CheckConstraint(
            "denominator >= 0 AND alert_observation_count >= 0 "
            "AND feed_observation_days >= 0",
            name="ck_core_alert_language_coverage_samples_counts",
        ),
        sa.CheckConstraint(
            "(explicit_en_pct IS NULL OR explicit_en_pct BETWEEN 0 AND 100) "
            "AND (explicit_fr_pct IS NULL OR explicit_fr_pct BETWEEN 0 AND 100) "
            "AND (undetermined_pct IS NULL OR undetermined_pct BETWEEN 0 AND 100)",
            name="ck_core_alert_language_coverage_samples_percentages",
        ),
        schema="core",
    )
    op.create_index(
        "ix_core_alert_language_coverage_samples_measured",
        "alert_language_coverage_samples",
        ["measurement_date", "provider_id"],
        schema="core",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_core_alert_language_coverage_samples_measured",
        table_name="alert_language_coverage_samples",
        schema="core",
    )
    op.drop_table("alert_language_coverage_samples", schema="core")
    op.drop_table("alert_feed_observations", schema="raw")
    op.drop_index(
        "ix_raw_alert_language_observations_window",
        table_name="alert_language_observations",
        schema="raw",
    )
    op.drop_table("alert_language_observations", schema="raw")
