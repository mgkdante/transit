"""Make GTFS-optional silver columns nullable so any compliant feed loads.

The silver loader historically hard-required several columns that the GTFS spec
treats as optional or conditional, which spuriously rejected fully-compliant but
minimal feeds (single-agency feeds without agency_id, feeds whose feed_info.txt
omits the date range / version, stops that are generic nodes / boarding areas
without a stop_name). The loader relaxations land alongside this migration; the
columns must become nullable to store the honest NULLs:

- silver.stops.stop_name -- conditional (required only for location_type 0/1/2)
- silver.feed_info.feed_start_date / feed_end_date / feed_version -- optional

silver.agency.agency_id stays NOT NULL: the loader synthesizes a stable
surrogate from provider_id for single-agency feeds, so the column is never null.

Purely a constraint relaxation -- no data rewrite, no backfill.

Revision ID: 0054_gtfs_optional_columns_nullable
Revises: 0053_service_alerts_run_kind
Create Date: 2026-06-19
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0054_gtfs_optional_columns_nullable"
down_revision = "0053_service_alerts_run_kind"
branch_labels = None
depends_on = None


_NULLABLE_COLUMNS = (
    ("silver", "stops", "stop_name", sa.Text()),
    ("silver", "feed_info", "feed_start_date", sa.Date()),
    ("silver", "feed_info", "feed_end_date", sa.Date()),
    ("silver", "feed_info", "feed_version", sa.Text()),
)


def upgrade() -> None:
    for schema, table, column, column_type in _NULLABLE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=column_type,
            nullable=True,
            schema=schema,
        )


def downgrade() -> None:
    # Backfill is intentionally omitted: any feed loaded under the relaxed loader
    # may carry legitimate NULLs that have no spec-faithful non-null value. A
    # downgrade therefore re-imposes NOT NULL only if the data already satisfies
    # it (matching how the columns were created); callers must clean first.
    for schema, table, column, column_type in _NULLABLE_COLUMNS:
        op.alter_column(
            table,
            column,
            existing_type=column_type,
            nullable=False,
            schema=schema,
        )
