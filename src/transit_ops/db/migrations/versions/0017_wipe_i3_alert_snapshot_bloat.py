"""Wipe accumulated silver.i3_alerts snapshot bloat + fix view for NULL alert_id.

Revision ID: 0017_wipe_i3_alert_snapshot_bloat
Revises: 0016_fix_current_i3_alerts_dedup
Create Date: 2026-05-27

Why this is reshaped from the first draft:
    Running the original migration revealed STM's i3 feed never populates
    `alert_id` — the column is NULL for every row in silver.i3_alerts
    (3.2M rows, all NULL). The natural per-alert key is actually
    `(provider_id, alert_index)` within a snapshot. STM returns ~941
    alerts per snapshot capture, and the worker had captured 3,503
    snapshots before the per-endpoint cadence gating shipped.

    Migration 0016's view used `DISTINCT ON (provider_id, alert_id)`
    which, with NULL alert_id, collapses everything to a single row. The
    view returns junk silently rather than the 941 active alerts.

What this migration does:
    1. CREATE OR REPLACE VIEW gold.current_i3_alerts to use
       latest-snapshot-per-provider logic (no alert_id dependency).
       After dedup, this is effectively "all alerts from the current
       snapshot LEFT JOIN their informed entities" — the correct grain.

    2. Wipe data so silver only retains the latest snapshot per provider.
       After dedup, silver.i3_alerts has ~941 rows (one per alert in the
       current snapshot), not 3.2M.

       Done in batched DELETEs of 100k rows per transaction inside an
       autocommit_block so:
         - WAL doesn't grow unbounded
         - Progress is visible
         - Each batch is short enough to coexist with the running worker

    3. Delete orphan rows in silver.i3_alert_informed_entities and
       raw.i3_alert_snapshots that no longer reference surviving silver
       alerts.

    4. VACUUM ANALYZE the three tables to reclaim disk + refresh planner
       statistics.

Downgrade:
    Irreversible — wiped historic snapshots cannot be reconstructed.
    Restore from a database backup taken before this upgrade to roll
    back past 0017.
"""

from __future__ import annotations

from alembic import op
from sqlalchemy import text

revision = "0017_wipe_i3_alert_snapshot_bloat"
down_revision = "0016_fix_current_i3_alerts_dedup"
branch_labels = None
depends_on = None


_FIX_GOLD_CURRENT_I3_ALERTS_VIEW = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH latest_snapshot AS (
    SELECT provider_id, max(i3_alert_snapshot_id) AS i3_alert_snapshot_id
    FROM silver.i3_alerts
    GROUP BY provider_id
)
SELECT
    a.provider_id,
    a.alert_id,
    a.alert_header_text,
    a.description_text,
    a.severity,
    a.cause,
    a.effect,
    e.route_id,
    e.stop_id,
    e.trip_id,
    e.area_id,
    a.active_period_start_utc,
    a.active_period_end_utc,
    a.captured_at_utc
FROM silver.i3_alerts AS a
INNER JOIN latest_snapshot AS ls
    ON ls.provider_id = a.provider_id
   AND ls.i3_alert_snapshot_id = a.i3_alert_snapshot_id
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
WHERE COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()
  AND COALESCE(a.active_period_end_utc, now() + interval '100 years') >= now()
"""

# Restored on downgrade for parity even though downgrade is normally disabled.
_LEGACY_CURRENT_I3_ALERTS_VIEW_FROM_0016 = """
CREATE OR REPLACE VIEW gold.current_i3_alerts AS
WITH latest_alert_snapshot AS (
    SELECT DISTINCT ON (provider_id, alert_id)
        provider_id, alert_id, alert_header_text, description_text,
        severity, cause, effect,
        active_period_start_utc, active_period_end_utc, captured_at_utc,
        i3_alert_snapshot_id, alert_index
    FROM silver.i3_alerts
    WHERE COALESCE(active_period_start_utc, captured_at_utc) <= now()
      AND COALESCE(active_period_end_utc, now() + interval '100 years') >= now()
    ORDER BY provider_id, alert_id, captured_at_utc DESC
)
SELECT
    a.provider_id, a.alert_id, a.alert_header_text, a.description_text,
    a.severity, a.cause, a.effect,
    e.route_id, e.stop_id, e.trip_id, e.area_id,
    a.active_period_start_utc, a.active_period_end_utc, a.captured_at_utc
FROM latest_alert_snapshot AS a
LEFT JOIN silver.i3_alert_informed_entities AS e
    ON e.i3_alert_snapshot_id = a.i3_alert_snapshot_id
   AND e.alert_index = a.alert_index
"""


_BATCH_SIZE = 100_000


_BUILD_KEEPER_SNAPSHOTS = """
CREATE TEMP TABLE i3_keep_snapshots AS
SELECT provider_id, max(i3_alert_snapshot_id) AS i3_alert_snapshot_id
FROM silver.i3_alerts
GROUP BY provider_id;

CREATE INDEX ON i3_keep_snapshots (provider_id, i3_alert_snapshot_id);
"""


def _delete_in_batches(bind, delete_sql: str, label: str) -> int:
    """Loop a LIMIT-bounded DELETE until 0 rows match. Returns total deleted."""
    total = 0
    batch_no = 0
    while True:
        batch_no += 1
        result = bind.execute(text(delete_sql))
        deleted = result.rowcount or 0
        total += deleted
        if deleted == 0:
            break
        print(f"  {label} batch {batch_no}: deleted {deleted:,} (total {total:,})")
    return total


def upgrade() -> None:
    # 1. Fix the gold view to use latest-snapshot logic (no alert_id dependency).
    op.execute(_FIX_GOLD_CURRENT_I3_ALERTS_VIEW)

    # The rest runs outside the alembic-managed transaction so each batch
    # commits independently. This keeps WAL size bounded on the small VM
    # and lets the realtime worker keep writing during the wipe.
    with op.get_context().autocommit_block():
        op.execute(_BUILD_KEEPER_SNAPSHOTS)

        bind = op.get_bind()

        print("Wiping silver.i3_alerts (keep latest snapshot per provider)...")
        before_silver = bind.execute(
            text("SELECT count(*) FROM silver.i3_alerts")
        ).scalar()
        print(f"  silver.i3_alerts before: {before_silver:,}")
        _delete_in_batches(
            bind,
            f"""
            DELETE FROM silver.i3_alerts
            WHERE ctid IN (
                SELECT a.ctid
                FROM silver.i3_alerts AS a
                LEFT JOIN i3_keep_snapshots AS k
                    ON k.provider_id = a.provider_id
                   AND k.i3_alert_snapshot_id = a.i3_alert_snapshot_id
                WHERE k.i3_alert_snapshot_id IS NULL
                LIMIT {_BATCH_SIZE}
            )
            """,
            "silver.i3_alerts",
        )
        after_silver = bind.execute(
            text("SELECT count(*) FROM silver.i3_alerts")
        ).scalar()
        print(f"  silver.i3_alerts after:  {after_silver:,}")

        print("Wiping silver.i3_alert_informed_entities orphans...")
        before_entities = bind.execute(
            text("SELECT count(*) FROM silver.i3_alert_informed_entities")
        ).scalar()
        print(f"  informed_entities before: {before_entities:,}")
        _delete_in_batches(
            bind,
            f"""
            DELETE FROM silver.i3_alert_informed_entities
            WHERE ctid IN (
                SELECT e.ctid
                FROM silver.i3_alert_informed_entities AS e
                LEFT JOIN i3_keep_snapshots AS k
                    ON k.i3_alert_snapshot_id = e.i3_alert_snapshot_id
                WHERE k.i3_alert_snapshot_id IS NULL
                LIMIT {_BATCH_SIZE}
            )
            """,
            "informed_entities",
        )
        after_entities = bind.execute(
            text("SELECT count(*) FROM silver.i3_alert_informed_entities")
        ).scalar()
        print(f"  informed_entities after:  {after_entities:,}")

        print("Wiping raw.i3_alert_snapshots orphans...")
        before_raw = bind.execute(
            text("SELECT count(*) FROM raw.i3_alert_snapshots")
        ).scalar()
        print(f"  raw.i3_alert_snapshots before: {before_raw:,}")
        _delete_in_batches(
            bind,
            f"""
            DELETE FROM raw.i3_alert_snapshots
            WHERE ctid IN (
                SELECT s.ctid
                FROM raw.i3_alert_snapshots AS s
                LEFT JOIN i3_keep_snapshots AS k
                    ON k.i3_alert_snapshot_id = s.i3_alert_snapshot_id
                WHERE k.i3_alert_snapshot_id IS NULL
                LIMIT {_BATCH_SIZE}
            )
            """,
            "raw.i3_alert_snapshots",
        )
        after_raw = bind.execute(
            text("SELECT count(*) FROM raw.i3_alert_snapshots")
        ).scalar()
        print(f"  raw.i3_alert_snapshots after:  {after_raw:,}")

        print("Reclaiming disk + refreshing planner statistics...")
        for stmt in (
            "VACUUM ANALYZE silver.i3_alerts",
            "VACUUM ANALYZE silver.i3_alert_informed_entities",
            "VACUUM ANALYZE raw.i3_alert_snapshots",
        ):
            print(f"  {stmt}")
            op.execute(stmt)


def downgrade() -> None:
    # Restore the previous view shape for parity (cheap).
    op.execute(_LEGACY_CURRENT_I3_ALERTS_VIEW_FROM_0016)
    raise NotImplementedError(
        "Migration 0017 deletes historic silver.i3_alerts snapshots that "
        "cannot be reconstructed. Restore from a DB backup taken before "
        "this upgrade to roll back past 0017."
    )
