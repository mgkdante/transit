"""Append-only SCD-lite name history for gold.dim_route / gold.dim_stop.

Revision ID: 0029_dim_name_history
Revises: 0028_historic_promotion_marts
Create Date: 2026-06-11

Why this migration exists:
    gold.dim_route / gold.dim_stop are current-only: every static refresh
    DELETEs the provider's rows and re-inserts them from the current silver
    dataset version, and prune_static_silver_datasets removes old silver rows
    (and their core.dataset_versions row) within ~one realtime cycle of a GTFS
    edition flip. When STM retires or renumbers ids at a GTFS drop (the
    June-15 2026 edition retired 12 route_ids and 15 stop_ids that still live
    in the 365d gold rollups), historic /v1 surfaces lose every display name
    for those ids — the names exist nowhere in the database any more.

What this migration does:
    Creates gold.dim_route_history and gold.dim_stop_history — append-only
    name-history tables keyed (provider_id, natural_key, valid_from_utc) with
    at most one OPEN row (valid_to_utc IS NULL) per natural key, enforced by a
    partial unique index. Seeds both from the CURRENT dims so the names of the
    current GTFS edition are captured the moment the migration applies; the
    close-then-open writer in transit_ops.gold.marts maintains them on every
    subsequent dim refresh, and `transit-ops backfill-dim-history` heals ids
    whose names predate this migration from an archived GTFS zip.

    last_seen_dataset_version_id is a plain BIGINT breadcrumb on purpose: the
    per-cycle silver prune DELETEs old core.dataset_versions rows, so an FK
    from an append-only history table would either block the prune or force
    cascading edits.

Downgrade:
    Drops both tables (their indexes drop with them).
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0029_dim_name_history"
down_revision = "0028_historic_promotion_marts"
branch_labels = None
depends_on = None


_CREATE_OPEN_ROW_UNIQUE_INDEXES = """
CREATE UNIQUE INDEX uq_gold_dim_route_history_open
    ON gold.dim_route_history (provider_id, route_id)
    WHERE valid_to_utc IS NULL;
CREATE UNIQUE INDEX uq_gold_dim_stop_history_open
    ON gold.dim_stop_history (provider_id, stop_id)
    WHERE valid_to_utc IS NULL;
"""


_SEED_ROUTE_HISTORY_FROM_CURRENT_DIM = """
INSERT INTO gold.dim_route_history (
    provider_id,
    route_id,
    route_short_name,
    route_long_name,
    route_color,
    route_type,
    valid_from_utc,
    valid_to_utc,
    last_seen_dataset_version_id
)
SELECT
    provider_id,
    route_id,
    route_short_name,
    route_long_name,
    route_color,
    route_type,
    now(),
    NULL,
    dataset_version_id
FROM gold.dim_route
"""


_SEED_STOP_HISTORY_FROM_CURRENT_DIM = """
INSERT INTO gold.dim_stop_history (
    provider_id,
    stop_id,
    stop_name,
    stop_lat,
    stop_lon,
    valid_from_utc,
    valid_to_utc,
    last_seen_dataset_version_id
)
SELECT
    provider_id,
    stop_id,
    stop_name,
    stop_lat,
    stop_lon,
    now(),
    NULL,
    dataset_version_id
FROM gold.dim_stop
"""


def upgrade() -> None:
    op.create_table(
        "dim_route_history",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("route_short_name", sa.Text(), nullable=True),
        sa.Column("route_long_name", sa.Text(), nullable=True),
        sa.Column("route_color", sa.Text(), nullable=True),
        sa.Column("route_type", sa.Integer(), nullable=True),
        sa.Column("valid_from_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to_utc", sa.DateTime(timezone=True), nullable=True),
        # Plain BIGINT — no FK: the per-cycle silver prune deletes old
        # core.dataset_versions rows and must never be blocked by history.
        sa.Column("last_seen_dataset_version_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_route_history_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "valid_from_utc",
            name="pk_gold_dim_route_history",
        ),
        schema="gold",
    )

    op.create_table(
        "dim_stop_history",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("stop_id", sa.Text(), nullable=False),
        sa.Column("stop_name", sa.Text(), nullable=False),
        sa.Column("stop_lat", sa.Float(), nullable=True),
        sa.Column("stop_lon", sa.Float(), nullable=True),
        sa.Column("valid_from_utc", sa.DateTime(timezone=True), nullable=False),
        sa.Column("valid_to_utc", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_seen_dataset_version_id", sa.BigInteger(), nullable=True),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_stop_history_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "stop_id",
            "valid_from_utc",
            name="pk_gold_dim_stop_history",
        ),
        schema="gold",
    )

    # At most one open row (valid_to_utc IS NULL) per natural key.
    op.execute(_CREATE_OPEN_ROW_UNIQUE_INDEXES)

    # Seed from the current dims: ~230 routes + ~9k stops, no batching needed.
    op.execute(_SEED_ROUTE_HISTORY_FROM_CURRENT_DIM)
    op.execute(_SEED_STOP_HISTORY_FROM_CURRENT_DIM)


def downgrade() -> None:
    op.drop_table("dim_stop_history", schema="gold")
    op.drop_table("dim_route_history", schema="gold")
