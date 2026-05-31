"""Static contract test for migration 0016: gold.current_i3_alerts dedup.

We can't easily exercise the view against a live database in CI without a
fixture, so this test asserts the migration text itself encodes the
deduplication shape: a DISTINCT ON per (provider_id, alert_id) latest
snapshot CTE before the informed-entity join.
"""

from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0016_fix_current_i3_alerts_dedup.py"
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

    assert 'revision = "0016_fix_current_i3_alerts_dedup"' in text
    assert 'down_revision = "0015_reporting_view_performance"' in text


def test_upgrade_dedupes_via_distinct_on_latest_snapshot() -> None:
    upgrade_sql = _sql_block("_CURRENT_I3_ALERTS_DEDUPED")

    # latest snapshot CTE name + structure
    assert "WITH latest_alert_snapshot AS" in upgrade_sql
    assert "DISTINCT ON (provider_id, alert_id)" in upgrade_sql
    assert "ORDER BY provider_id, alert_id, captured_at_utc DESC" in upgrade_sql

    # final SELECT must join CTE to informed entities, not raw silver.i3_alerts
    assert "FROM latest_alert_snapshot AS a" in upgrade_sql
    assert "LEFT JOIN silver.i3_alert_informed_entities AS e" in upgrade_sql

    # original buggy shape no longer present in upgrade SQL
    assert "FROM silver.i3_alerts AS a\nLEFT JOIN" not in upgrade_sql


def test_upgrade_preserves_active_window_filter() -> None:
    upgrade_sql = _sql_block("_CURRENT_I3_ALERTS_DEDUPED")

    # active-period filter moves into the CTE — must still be present and
    # use the same semantics (open-ended end_utc treated as far-future).
    assert (
        "COALESCE(active_period_start_utc, captured_at_utc) <= now()"
        in upgrade_sql
    )
    assert (
        "COALESCE(active_period_end_utc, now() + interval '100 years') >= now()"
        in upgrade_sql
    )


def test_upgrade_returns_canonical_alert_columns() -> None:
    upgrade_sql = _sql_block("_CURRENT_I3_ALERTS_DEDUPED")
    for column in (
        "a.provider_id",
        "a.alert_id",
        "a.alert_header_text",
        "a.description_text",
        "a.severity",
        "a.cause",
        "a.effect",
        "e.route_id",
        "e.stop_id",
        "e.trip_id",
        "e.area_id",
        "a.active_period_start_utc",
        "a.active_period_end_utc",
        "a.captured_at_utc",
    ):
        assert column in upgrade_sql, f"upgrade SQL missing column: {column}"


def test_downgrade_restores_legacy_snapshot_fanout_for_rollback() -> None:
    downgrade_sql = _sql_block("_CURRENT_I3_ALERTS_LEGACY")
    assert "FROM silver.i3_alerts AS a" in downgrade_sql
    assert "LEFT JOIN silver.i3_alert_informed_entities AS e" in downgrade_sql
    assert "DISTINCT ON" not in downgrade_sql
