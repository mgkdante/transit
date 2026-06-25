"""Drop the dead Gold dimension gold.dim_direction.

S7 pipeline-consolidation cleanup (Gold Relation Catalog, 2026-06-25). dim_direction was
built every marts cycle (DELETE+INSERT from silver.directions) but had NO production
reader: /v1 direction naming now comes from silver.trips.trip_headsign (commit a4cf264,
"name directions by real HEADSIGN"). It carried no FK dependents, so the drop is clean; the
companion code change removes its marts.py builder (constants, the DELETE/INSERT calls in
both build paths, the LOCK-TABLE entry, the row-count reports, the _count whitelist entry)
and its source-factory catalog entries.

downgrade recreates the empty table + index (structure from migration 0009) for
reversibility; the marts builder no longer repopulates it.

Revision ID: 0060_drop_dead_dim_direction
Revises: 0059_drop_dead_map_alert_views
"""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0060_drop_dead_dim_direction"
down_revision = "0059_drop_dead_map_alert_views"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_index(
        "ix_gold_dim_direction_provider_direction",
        table_name="dim_direction",
        schema="gold",
    )
    op.drop_table("dim_direction", schema="gold")


def downgrade() -> None:
    op.create_table(
        "dim_direction",
        sa.Column("provider_id", sa.Text(), nullable=False),
        sa.Column("route_id", sa.Text(), nullable=False),
        sa.Column("direction_id", sa.Integer(), nullable=False),
        sa.Column("direction_label", sa.Text(), nullable=False),
        sa.ForeignKeyConstraint(
            ["provider_id"],
            ["core.providers.provider_id"],
            name="fk_gold_dim_direction_provider_id",
        ),
        sa.PrimaryKeyConstraint(
            "provider_id",
            "route_id",
            "direction_id",
            name="pk_gold_dim_direction",
        ),
        schema="gold",
    )
    op.create_index(
        "ix_gold_dim_direction_provider_direction",
        "dim_direction",
        ["provider_id", "direction_id"],
        schema="gold",
    )
