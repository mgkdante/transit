from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0044_drop_unused_rt_feed_snapshots_index.py"
)


def _read() -> str:
    return MIGRATION.read_text(encoding="utf-8")


def test_migration_revision_metadata() -> None:
    text = _read()
    assert 'revision = "0044_drop_unused_rt_feed_snapshots_index"' in text
    assert 'down_revision = "0043_rt_feed_snapshots_hot_path_index"' in text


def test_upgrade_drops_index_concurrently_in_autocommit_block() -> None:
    text = _read()
    flat = re.sub(r"\s+", " ", text)
    assert (
        "DROP INDEX CONCURRENTLY IF EXISTS silver.ix_silver_rt_feed_snapshots_provider_endpoint_srsid"  # noqa: E501
        in flat
    )
    assert ".autocommit_block(" in text


def test_downgrade_recreates_the_partial_index() -> None:
    text = _read()
    flat = re.sub(r"\s+", " ", text)
    assert "def downgrade()" in flat
    assert (
        "CREATE INDEX CONCURRENTLY IF NOT EXISTS ix_silver_rt_feed_snapshots_provider_endpoint_srsid"  # noqa: E501
        in flat
    )
    assert (
        "ON silver.rt_feed_snapshots (provider_id, endpoint_key, source_realtime_snapshot_id DESC)"
        in flat
    )
    assert "WHERE source_realtime_snapshot_id IS NOT NULL" in flat
