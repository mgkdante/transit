"""stop_delay_spine — finest-grain additive STOP-DELAY family (rollup_kind="stop_delay_spine").

Append-only, closed-day rollup of gold.fact_trip_delay_snapshot at the LEAN stop grain
(provider_id, stop_id, route_id, service_local_date) — NO hour, NO histogram (the hour+histogram
variant is a ~9-18x cardinality multiplier on the system's highest-cardinality table; the windowed
worst-N lollipop needs only per-(stop,route,date) additive counts). The GHOST clamp + stop/route
predicates live in the WHERE, so observation_count = COUNT(*) IS the in-clamp delay count (the
severe-rate denominator AND the pooled-avg n, over one row set). severe = delay_seconds > 300 AND
ABS(delay_seconds) <= 3600. ALL-DAYS (no ISODOW filter — the stop lineage is dow-agnostic, unlike
the headway builder). route_id is COALESCE'd to '__unrouted__' (NULL-route per-stop totals depend
on it; a real route read never matches the sentinel). NOT in REPORTING_AGGREGATE_TABLES — accrued
history is never DELETE+UPSERT wiped; pruned at GOLD_WARM_ROLLUP_RETENTION_DAYS (730d) via the
append-only retention lists in maintenance/gold.py. Clones the append-only lifecycle of 0063/0065.

Revision ID: 0066_stop_delay_spine
Revises: 0065_route_headway_shift_daily
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0066_stop_delay_spine"
down_revision = "0065_route_headway_shift_daily"
branch_labels = None
depends_on = None


def _built_at_column() -> sa.Column:
    return sa.Column(
        "built_at_utc",
        sa.DateTime(timezone=True),
        nullable=False,
        server_default=sa.text("now()"),
    )


def _provider_fk() -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["provider_id"],
        ["core.providers.provider_id"],
        name="fk_gold_stop_delay_spine_provider_id",
    )


def upgrade() -> None:
    op.create_table(
        "stop_delay_spine",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        # route_id is COALESCE'd to the '__unrouted__' sentinel by the builder (NOT NULL PK column).
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("service_local_date", sa.Date(), nullable=False),
        # observation_count = in-clamp delay count (the WHERE already clamps delay non-null +
        # |delay|<=3600): the severe-rate denominator AND the pooled-avg n, over ONE row set.
        sa.Column("observation_count", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("severe_delay_count", sa.Integer(), nullable=False, server_default="0"),
        # bigint: a windowed SUM of (in-clamp magnitude 3600 x obs) overflows int4.
        sa.Column("sum_delay_seconds", sa.BigInteger(), nullable=False, server_default="0"),
        _built_at_column(),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "stop_id",
            "route_id",
            "service_local_date",
            name="pk_gold_stop_delay_spine",
        ),
        _provider_fk(),
        schema="gold",
    )
    # Read-time recompose: the anchor (MAX(date) WHERE provider+route) and the windowed projector
    # (WHERE provider+route AND date BETWEEN, GROUP BY stop_id) both lead with (provider, route,
    # date) — the literal 0063 route_delay_spine index shape. The cold-build reads facts, not the
    # spine, so it needs no spine index.
    op.create_index(
        "ix_gold_stop_delay_spine_provider_route_date",
        "stop_delay_spine",
        ["provider_id", "route_id", "service_local_date"],
        schema="gold",
    )


def downgrade() -> None:
    op.drop_index(
        "ix_gold_stop_delay_spine_provider_route_date",
        table_name="stop_delay_spine",
        schema="gold",
    )
    op.drop_table("stop_delay_spine", schema="gold")
