"""Per-stop historic occupancy-band distribution (append-only daily reduction).

A clean MIRROR of gold.route_occupancy_band_daily (migration 0048) keyed by
stop_id instead of route_id. gold.fact_vehicle_snapshot already carries BOTH the
GTFS-RT VehiclePosition current/next stop_id (populated for STM) AND the
occupancy_status band, so a per-stop band-count reduction is a single read of the
same fact table grouped on stop_id.

  - stop_occupancy_band_daily: one APPEND-ONLY row per CLOSED provider-local day,
    per stop. observation_count = band-bearing pings (GTFS-RT OccupancyStatus
    codes 0-5, code 4 CRUSHED_STANDING folded into standing per the route mirror);
    the five band counts sum to it. Counts are additively composable, so the
    trailing-window band-SHARES are derived at read time (build_stop_reliability)
    without re-reading the pruned 14d fact window.

CRITICAL stop-vs-route difference: a VehiclePosition ping with NULL stop_id
cannot be attributed to a stop, so the upsert filters WHERE stop_id IS NOT NULL
and GROUPs BY stop_id. There is NO sentinel bucket (the route mirror COALESCEs
NULL route_id to '__unrouted__'; a NULL stop has no honest stop to attribute to,
so it is simply excluded).

Like its route sibling this table is deliberately OUT of the DELETE+UPSERT
reporting registry (a per-provider rebuild would wipe accrued history). It accrues
forward and is pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS via the append-only-daily
retention registry in maintenance/gold.py (registered there alongside
route_occupancy_band_daily, same provider_local_date retention column).

Alembic migration modules are independent — the _built_at_column / _provider_fk /
_occupancy_band_columns helpers are re-declared here rather than imported from
0048.

Revision ID: 0056_stop_occupancy_band_daily
Revises: 0055_provider_copy_identity
Create Date: 2026-06-20
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0056_stop_occupancy_band_daily"
down_revision = "0055_provider_copy_identity"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk(table_name: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name=f"fk_gold_{table_name}_provider_id",
    )


def _occupancy_band_columns() -> list[sa.Column]:
    return [
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("empty_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("many_seats_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("few_seats_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("standing_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("full_count", sa.Integer(), nullable=False, server_default="0"),
    ]


def upgrade() -> None:
    # Append-only daily occupancy-band reduction keyed by stop_id (mirror of
    # gold.route_occupancy_band_daily, route_id -> stop_id).
    op.create_table(
        "stop_occupancy_band_daily",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("provider_local_date", sa.Date(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        *_occupancy_band_columns(),
        _built_at_column(),
        _provider_fk("stop_occupancy_band_daily"),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "provider_local_date",
            "stop_id",
            name="pk_gold_stop_occupancy_band_daily",
        ),
        schema="gold",
    )
    # No secondary index. UNLIKE the route mirror (a per-route POINT read, so it
    # carries an (provider_id, route_id, provider_local_date) index), the stop read
    # (_STOP_OCCUPANCY_BAND_WINDOW_SQL) is a BATCHED reduction: filter on provider_id
    # + a trailing provider_local_date window, then GROUP BY stop_id. The PK's
    # (provider_id, provider_local_date, ...) leading prefix already serves that
    # range scan, so a (provider_id, stop_id, provider_local_date) secondary index
    # would be dead weight. We add none — the PK covers the only read.


def downgrade() -> None:
    # No dependents and no secondary index -> clean + reversible.
    op.drop_table("stop_occupancy_band_daily", schema="gold")
