"""Rename 3 misnamed rolling reporting tables to honest grains.

S7 pipeline-consolidation cleanup (Gold Relation Catalog, 2026-06-25). These three are
full DELETE+rebuild reporting aggregates with NO date column, yet were named ``_daily`` —
which falsely implies append-only per-service-date history (the genuinely-daily tables ARE
append-only and DO carry provider_local_date). The names lied about the grain:

* route_headway_daily          (provider, route, shift)                  → route_headway_by_shift
* route_headway_direction_daily (provider, route, direction_id, shift, service_day_kind)
                                                                 → route_headway_by_direction_shift
* repeat_offender_daily         (provider, entity_kind, entity_id, route) → repeat_offender

Pure rename — the rows, the build (full DELETE+rebuild each cycle, correctly NOT registered
for time-based retention), and the /v1 output are byte-identical; only the relation + its
constraint/index names change. The companion code change updates the builder + the /v1
readers + tests. The catalog also marked repeat_offender_daily a future spine-fold candidate;
this honest name stands until that lands.

Revision ID: 0062_rename_misnamed_rolling_tables
Revises: 0061_drop_dead_5m_summaries
"""

from __future__ import annotations

from alembic import op

revision = "0062_rename_misnamed_rolling_tables"
down_revision = "0061_drop_dead_5m_summaries"
branch_labels = None
depends_on = None

# (old, new) — table, then its constraint/index renames keyed off the old/new stems.
_RENAMES = (
    ("route_headway_daily", "route_headway_by_shift", ()),
    (
        "route_headway_direction_daily",
        "route_headway_by_direction_shift",
        (("ix_gold_route_headway_direction_daily_provider_route", "ix_gold_route_headway_by_direction_shift_provider_route"),),
    ),
    (
        "repeat_offender_daily",
        "repeat_offender",
        (("ix_gold_repeat_offender_daily_route", "ix_gold_repeat_offender_route"),),
    ),
)


def _rename(old: str, new: str, indexes: tuple[tuple[str, str], ...]) -> None:
    op.execute(f"ALTER TABLE gold.{old} RENAME TO {new}")
    op.execute(f"ALTER TABLE gold.{new} RENAME CONSTRAINT pk_gold_{old} TO pk_gold_{new}")
    op.execute(
        f"ALTER TABLE gold.{new} RENAME CONSTRAINT fk_gold_{old}_provider_id "
        f"TO fk_gold_{new}_provider_id"
    )
    for old_ix, new_ix in indexes:
        op.execute(f"ALTER INDEX gold.{old_ix} RENAME TO {new_ix}")


def upgrade() -> None:
    for old, new, indexes in _RENAMES:
        _rename(old, new, indexes)


def downgrade() -> None:
    for old, new, indexes in _RENAMES:
        _rename(new, old, tuple((new_ix, old_ix) for old_ix, new_ix in indexes))
