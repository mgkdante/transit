"""Static contract test for migration 0045: hot realtime autovacuum settings."""

from __future__ import annotations

from pathlib import Path

MIGRATION = Path("src/transit_ops/db/migrations/versions/0045_hot_realtime_autovacuum.py")


def _text() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_revision_metadata() -> None:
    text = _text()

    assert 'revision = "0045_hot_realtime_autovacuum"' in text
    assert 'down_revision = "0044_drop_unused_rt_feed_snapshots_index"' in text


def test_migration_sets_hot_table_autovacuum_reloptions() -> None:
    text = _text()

    for table_name in (
        "silver.rt_trip_update_stop_times",
        "silver.rt_trip_updates",
        "silver.rt_entities",
        "silver.rt_vehicle_positions",
        "silver.rt_feed_snapshots",
        "gold.fact_trip_delay_snapshot",
        "gold.fact_vehicle_snapshot",
    ):
        assert table_name in text

    assert "autovacuum_vacuum_scale_factor = 0.005" in text
    assert "autovacuum_vacuum_scale_factor = 0.01" in text
    assert "autovacuum_vacuum_threshold = 50000" in text
    assert "autovacuum_analyze_scale_factor = 0.02" in text
    assert "ALTER TABLE {table_name} SET" in text
    assert "ALTER TABLE {table_name} RESET" in text
