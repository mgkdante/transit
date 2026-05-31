"""Static contract test for migration 0018: stale-trip filter on current_trip_delay_computed."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0018_current_trip_delay_exclude_stale.py"
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

    assert 'revision = "0018_current_trip_delay_exclude_stale"' in text
    assert 'down_revision = "0017_wipe_i3_alert_snapshot_bloat"' in text


def test_filtered_view_excludes_null_delays() -> None:
    sql = _sql_block("_FILTERED_VIEW")

    assert "delay_seconds IS NOT NULL" in sql


def test_filtered_view_caps_delay_at_one_hour() -> None:
    """3600s sanity bound — real transit delays virtually never exceed
    this; anything bigger is a stale-trip leak from STM."""
    sql = _sql_block("_FILTERED_VIEW")

    assert "abs(lts.delay_seconds) <= 3600" in sql


def test_filtered_view_excludes_stale_start_dates() -> None:
    """Trips older than yesterday (in provider local time) are stale."""
    sql = _sql_block("_FILTERED_VIEW")

    assert "provider_now" in sql
    assert "today_local" in sql
    assert "(now() AT TIME ZONE dp.timezone)::date" in sql
    assert "lts.start_date >= pn.today_local - INTERVAL '1 day'" in sql


def test_filtered_view_preserves_aggregation_columns() -> None:
    sql = _sql_block("_FILTERED_VIEW")

    for col in (
        "provider_id",
        "realtime_snapshot_id",
        "trip_id",
        "route_id",
        "direction_id",
        "captured_at_utc",
        "stop_time_observation_count",
        "avg_delay_seconds",
        "max_delay_seconds",
    ):
        assert col in sql, f"missing column: {col}"


def test_filtered_view_groups_by_trip_identity() -> None:
    sql = _sql_block("_FILTERED_VIEW")

    assert "GROUP BY lts.provider_id" in sql
    assert "lts.trip_id" in sql
    assert "lts.route_id" in sql
    assert "lts.direction_id" in sql


def test_downgrade_restores_legacy_unfiltered_view() -> None:
    sql = _sql_block("_LEGACY_VIEW")

    assert "CREATE OR REPLACE VIEW gold.current_trip_delay_computed" in sql
    # Legacy: no filters
    assert "WHERE" not in sql
    assert "delay_seconds IS NOT NULL" not in sql
