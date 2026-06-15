"""Static contract test for migration 0043: rt_feed_snapshots hot-path index."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path("src/transit_ops/db/migrations/versions/0043_rt_feed_snapshots_hot_path_index.py")

def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")

def test_migration_revision_metadata() -> None:
    text = _read()
    assert 'revision = "0043_rt_feed_snapshots_hot_path_index"' in text
    assert 'down_revision = "0042_snapshot_publish_state"' in text

def test_upgrade_creates_partial_index_concurrently() -> None:
    flat = re.sub(r"\s+", " ", _read())
    assert "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_silver_rt_feed_snapshots_provider_endpoint_srsid" in flat  # noqa: E501
    assert "ON silver.rt_feed_snapshots (provider_id, endpoint_key, source_realtime_snapshot_id DESC)" in flat  # noqa: E501
    assert "WHERE source_realtime_snapshot_id IS NOT NULL" in flat

def test_runs_concurrently_in_autocommit_block() -> None:
    text = _read()
    assert ".autocommit_block(" in text
    assert "CONCURRENTLY" in text

def test_downgrade_drops_index_concurrently() -> None:
    flat = re.sub(r"\s+", " ", _read())
    assert "def downgrade()" in flat
    assert "DROP INDEX CONCURRENTLY IF EXISTS silver.ix_silver_rt_feed_snapshots_provider_endpoint_srsid" in flat  # noqa: E501

def test_does_not_duplicate_existing_indexes() -> None:
    text = _read()
    assert "ix_silver_rt_feed_snapshots_provider_endpoint_captured" not in text
    assert "feed_endpoint_id" not in text
