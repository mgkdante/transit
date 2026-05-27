"""Wipe accumulated silver.i3_alerts snapshot bloat — keep latest per alert.

Revision ID: 0017_wipe_i3_alert_snapshot_bloat
Revises: 0016_fix_current_i3_alerts_dedup
Create Date: 2026-05-27

Why:
    Until migration 0016 + the per-endpoint cadence gating shipped, the
    realtime worker captured i3 service-state alerts every 30 seconds. A
    single active alert produced ~2,800 snapshot rows per day in
    `silver.i3_alerts`; in production we observed 9.6M rows for one active
    alert (3,312 snapshots × ~2,900 informed-entity tuples).

    The view-layer fix in 0016 made `gold.current_i3_alerts` query-safe by
    deduping at read time. The cadence change in commit 991abd4 stopped
    the inflow. This migration disposes of the historic bloat so the VM
    isn't carrying redundant rows for 14 days of silver retention plus
    however long the matching raw snapshots live.

What it does:
    1. silver.i3_alerts:
       Keep the latest `captured_at_utc` per (provider_id, alert_id).
       Delete all earlier snapshot rows. This drops the snapshot-fanout
       multiplier without touching active alert state.

    2. silver.i3_alert_informed_entities:
       Delete rows whose (i3_alert_snapshot_id, alert_index) no longer
       matches any silver.i3_alerts row (orphans from step 1).

    3. raw.i3_alert_snapshots:
       Delete rows whose i3_alert_snapshot_id no longer matches any
       silver.i3_alerts row (orphans from step 1). The bronze R2 objects
       these point at are pruned separately by the standard 30-day
       bronze retention job — this migration only touches DB metadata.

    4. VACUUM ANALYZE on all three tables to reclaim disk + refresh
       planner statistics. Runs in an autocommit block (VACUUM is not
       valid inside a transaction).

Downgrade:
    Irreversible — once snapshots are deleted from silver.i3_alerts there
    is no way to reconstruct them. The downgrade() raises explicitly.
    Operators rolling back past 0017 should restore from a database
    backup taken before this upgrade.
"""

from __future__ import annotations

from alembic import op

revision = "0017_wipe_i3_alert_snapshot_bloat"
down_revision = "0016_fix_current_i3_alerts_dedup"
branch_labels = None
depends_on = None


_DELETE_DUPLICATE_SILVER_ALERTS = """
DO $$
DECLARE
    before_count bigint;
    after_count bigint;
    deleted_count bigint;
BEGIN
    SELECT count(*) INTO before_count FROM silver.i3_alerts;
    RAISE NOTICE 'silver.i3_alerts row count BEFORE dedup: %', before_count;

    WITH ranked AS (
        SELECT ctid,
               row_number() OVER (
                   PARTITION BY provider_id, alert_id
                   ORDER BY captured_at_utc DESC, i3_alert_snapshot_id DESC
               ) AS rn
        FROM silver.i3_alerts
    )
    DELETE FROM silver.i3_alerts
    WHERE ctid IN (SELECT ctid FROM ranked WHERE rn > 1);

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    SELECT count(*) INTO after_count FROM silver.i3_alerts;
    RAISE NOTICE 'silver.i3_alerts deleted %, remaining %', deleted_count, after_count;
END $$;
"""


_DELETE_ORPHAN_INFORMED_ENTITIES = """
DO $$
DECLARE
    before_count bigint;
    deleted_count bigint;
BEGIN
    SELECT count(*) INTO before_count FROM silver.i3_alert_informed_entities;
    RAISE NOTICE 'silver.i3_alert_informed_entities row count BEFORE orphan delete: %',
                 before_count;

    DELETE FROM silver.i3_alert_informed_entities e
    WHERE NOT EXISTS (
        SELECT 1 FROM silver.i3_alerts a
        WHERE a.i3_alert_snapshot_id = e.i3_alert_snapshot_id
          AND a.alert_index = e.alert_index
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'silver.i3_alert_informed_entities orphans deleted: %', deleted_count;
END $$;
"""


_DELETE_ORPHAN_RAW_SNAPSHOTS = """
DO $$
DECLARE
    before_count bigint;
    deleted_count bigint;
BEGIN
    SELECT count(*) INTO before_count FROM raw.i3_alert_snapshots;
    RAISE NOTICE 'raw.i3_alert_snapshots row count BEFORE orphan delete: %', before_count;

    DELETE FROM raw.i3_alert_snapshots s
    WHERE NOT EXISTS (
        SELECT 1 FROM silver.i3_alerts a
        WHERE a.i3_alert_snapshot_id = s.i3_alert_snapshot_id
    );

    GET DIAGNOSTICS deleted_count = ROW_COUNT;
    RAISE NOTICE 'raw.i3_alert_snapshots orphans deleted: %', deleted_count;
END $$;
"""


_VACUUM_TABLES = (
    "VACUUM ANALYZE silver.i3_alerts",
    "VACUUM ANALYZE silver.i3_alert_informed_entities",
    "VACUUM ANALYZE raw.i3_alert_snapshots",
)


def upgrade() -> None:
    op.execute(_DELETE_DUPLICATE_SILVER_ALERTS)
    op.execute(_DELETE_ORPHAN_INFORMED_ENTITIES)
    op.execute(_DELETE_ORPHAN_RAW_SNAPSHOTS)

    # VACUUM is not valid inside a transaction; use autocommit block.
    with op.get_context().autocommit_block():
        for stmt in _VACUUM_TABLES:
            op.execute(stmt)


def downgrade() -> None:
    raise NotImplementedError(
        "Migration 0017 deletes historic silver.i3_alerts snapshots that "
        "cannot be reconstructed from the remaining DB state. Roll back by "
        "restoring from a database backup taken before this upgrade."
    )
