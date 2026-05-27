"""Static contract test for migration 0017: silver.i3_alerts bloat wipe."""
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


def test_silver_alerts_dedup_keeps_latest_per_provider_alert() -> None:
    sql = _sql_block("_DELETE_DUPLICATE_SILVER_ALERTS")

    assert "PARTITION BY provider_id, alert_id" in sql
    assert "ORDER BY captured_at_utc DESC" in sql
    assert "DELETE FROM silver.i3_alerts" in sql
    assert "rn > 1" in sql
    # Sanity: should NOT delete everything — only ranked > 1
    assert "rn = 1" not in sql or "rn > 1" in sql


def test_informed_entities_orphan_delete_matches_silver() -> None:
    sql = _sql_block("_DELETE_ORPHAN_INFORMED_ENTITIES")

    assert "DELETE FROM silver.i3_alert_informed_entities" in sql
    assert "NOT EXISTS" in sql
    assert "FROM silver.i3_alerts a" in sql
    assert "a.i3_alert_snapshot_id = e.i3_alert_snapshot_id" in sql
    assert "a.alert_index = e.alert_index" in sql


def test_raw_snapshots_orphan_delete_matches_silver() -> None:
    sql = _sql_block("_DELETE_ORPHAN_RAW_SNAPSHOTS")

    assert "DELETE FROM raw.i3_alert_snapshots" in sql
    assert "NOT EXISTS" in sql
    assert "FROM silver.i3_alerts a" in sql
    assert "a.i3_alert_snapshot_id = s.i3_alert_snapshot_id" in sql


def test_vacuum_runs_in_autocommit_block() -> None:
    text = _read()

    # VACUUM cannot run inside a transaction; must be wrapped.
    assert "autocommit_block()" in text
    assert "VACUUM ANALYZE silver.i3_alerts" in text
    assert "VACUUM ANALYZE silver.i3_alert_informed_entities" in text
    assert "VACUUM ANALYZE raw.i3_alert_snapshots" in text


def test_downgrade_refuses_with_helpful_message() -> None:
    text = _read()

    downgrade_marker = text.index("def downgrade")
    downgrade_body = text[downgrade_marker:]
    assert "raise NotImplementedError" in downgrade_body
    assert "restoring from a database backup" in downgrade_body
