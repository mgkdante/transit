"""Allow NULL affected_route_count / affected_stop_count on citizen_accountability_daily.

Honesty fix (2026-06-20 truth-audit): the daily citizen-accountability (receipts)
rollup used COALESCE(..., 0) on the route_daily / stop_daily LEFT JOINs, which
turned a join-MISS (no delay telemetry for the date) into a fabricated "0 routes
/ 0 stops affected" — indistinguishable from an honest zero. The builder now lets
a join-miss flow through as NULL (the Receipt contract already types
affected_routes / affected_stops as int|None), but the gold table columns were
created NOT NULL (0014; affected_stop_count re-set NOT NULL in 0034 after a
backfill), so the honest-NULL INSERT raised NotNullViolation.

This migration drops the NOT NULL constraint on both count columns so the rollup
can publish NULL on a no-data date. rider_impact_score is already nullable
(0014), so no change is needed there. The server_default of 0 is left in place
(harmless — the UPSERT always supplies an explicit value, NULL or integer).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0057_citizen_accountability_null_affected"
down_revision = "0056_stop_occupancy_band_daily"
branch_labels = None
depends_on = None

_TABLE = "citizen_accountability_daily"
_SCHEMA = "gold"
_COLUMNS = ("affected_route_count", "affected_stop_count")


def upgrade() -> None:
    for column in _COLUMNS:
        op.alter_column(
            _TABLE,
            column,
            existing_type=sa.Integer(),
            existing_server_default=sa.text("0"),
            nullable=True,
            schema=_SCHEMA,
        )


def downgrade() -> None:
    # Restore NOT NULL — backfill the honest NULLs to 0 first so the constraint
    # can be re-applied (mirrors the 0034 affected_stop_count downgrade).
    for column in _COLUMNS:
        op.execute(
            f"""
            UPDATE {_SCHEMA}.{_TABLE}
            SET {column} = 0
            WHERE {column} IS NULL
            """
        )
        op.alter_column(
            _TABLE,
            column,
            existing_type=sa.Integer(),
            existing_server_default=sa.text("0"),
            nullable=False,
            schema=_SCHEMA,
        )
