"""Static contract test for migration 0017: silver.i3_alerts bloat wipe + view fix."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0017_wipe_i3_alert_snapshot_bloat.py"
)


def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def _sql_block(constant_name: str) -> str:
    text = _read()
    match = re.search(
        rf'^{re.escape(constant_name)} = """(?P<sql>.*?)"""',
        text,
        flags=re.DOTALL | re.MULTILINE,
    )
    assert match is not None, f"could not find SQL constant {constant_name}"
    return match.group("sql")


def test_migration_revision_metadata() -> None:
    text = _read()

    assert 'revision = "0017_wipe_i3_alert_snapshot_bloat"' in text
    assert 'down_revision = "0016_fix_current_i3_alerts_dedup"' in text


def test_view_fix_uses_latest_snapshot_per_provider_not_alert_id() -> None:
    """STM's i3 feed never populates alert_id, so the 0016 DISTINCT ON
    (provider_id, alert_id) shape collapses everything to a single row.
    The corrected view groups by snapshot instead."""
    sql = _sql_block("_FIX_GOLD_CURRENT_I3_ALERTS_VIEW")

    assert "CREATE OR REPLACE VIEW gold.current_i3_alerts" in sql
    assert "latest_snapshot" in sql
    assert "max(i3_alert_snapshot_id)" in sql
    assert "GROUP BY provider_id" in sql
    assert "INNER JOIN latest_snapshot" in sql
    # The 0016 alert_id-based dedup is gone from the upgrade SQL.
    assert "DISTINCT ON (provider_id, alert_id)" not in sql
    # Active-window filter preserved.
    assert (
        "COALESCE(a.active_period_start_utc, a.captured_at_utc) <= now()" in sql
    )


def test_wipe_keeps_latest_snapshot_per_provider() -> None:
    text = _read()

    # The temp keeper table uses snapshot-per-provider not alert_id-per-row.
    assert "_BUILD_KEEPER_SNAPSHOTS" in text
    keeper_sql = _sql_block("_BUILD_KEEPER_SNAPSHOTS")
    assert "CREATE TEMP TABLE i3_keep_snapshots" in keeper_sql
    assert "max(i3_alert_snapshot_id)" in keeper_sql
    assert "GROUP BY provider_id" in keeper_sql


def test_wipe_uses_batched_deletes_with_limit() -> None:
    """Single 3.2M-row DELETE in one transaction is too WAL-heavy for the
    small VM (proven in production — first attempt ran 21 min and still
    hadn't finished). Batched 100k LIMIT keeps WAL bounded + visible
    progress."""
    text = _read()

    assert "_BATCH_SIZE = 100_000" in text
    assert "_delete_in_batches" in text
    # The autocommit_block makes each batch its own transaction.
    assert "autocommit_block()" in text
    # All three tables are batched.
    assert "DELETE FROM silver.i3_alerts" in text
    assert "DELETE FROM silver.i3_alert_informed_entities" in text
    assert "DELETE FROM raw.i3_alert_snapshots" in text


def test_wipe_uses_keeper_join_for_orphan_detection() -> None:
    """All three deletes reference i3_keep_snapshots to identify orphans,
    not separate NOT EXISTS subqueries."""
    text = _read()

    # Count LEFT JOIN i3_keep_snapshots references (one per table).
    join_count = text.count("LEFT JOIN i3_keep_snapshots")
    assert join_count == 3, f"expected 3 keeper JOINs, found {join_count}"


def test_vacuum_analyze_all_three_tables_with_parallel_zero() -> None:
    """VACUUM must use PARALLEL 0. The Docker postgres container ships with
    /dev/shm at 64MB by default, and default VACUUM tries to allocate
    parallel-worker shared memory beyond that ceiling, raising DiskFull on
    the Oracle A1 VM. Single-process VACUUM uses only maintenance_work_mem
    (private to the backend) and works fine."""
    text = _read()

    for stmt in (
        "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alerts",
        "VACUUM (PARALLEL 0, ANALYZE) silver.i3_alert_informed_entities",
        "VACUUM (PARALLEL 0, ANALYZE) raw.i3_alert_snapshots",
    ):
        assert stmt in text, f"missing VACUUM stmt: {stmt}"
    # Sanity: should NOT have plain VACUUM ANALYZE (which would crash on shm).
    assert "VACUUM ANALYZE silver.i3_alerts" not in text


def test_downgrade_restores_legacy_view_then_refuses() -> None:
    text = _read()

    # Even though downgrade refuses (can't unwipe), it should at least
    # restore the 0016 view shape for view-only parity.
    downgrade_marker = text.index("def downgrade")
    downgrade_body = text[downgrade_marker:]
    assert "_LEGACY_CURRENT_I3_ALERTS_VIEW_FROM_0016" in downgrade_body
    assert "raise NotImplementedError" in downgrade_body
    assert "restore" in downgrade_body.lower()


def test_legacy_view_constant_matches_0016_shape() -> None:
    sql = _sql_block("_LEGACY_CURRENT_I3_ALERTS_VIEW_FROM_0016")

    assert "DISTINCT ON (provider_id, alert_id)" in sql
    assert "latest_alert_snapshot" in sql
