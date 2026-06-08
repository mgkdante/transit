"""Static contract test for migration 0019: gold.trip_delay_summary_5m_live view."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0019_trip_delay_summary_5m_live_view.py"
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

    assert 'revision = "0019_trip_delay_summary_5m_live_view"' in text
    assert 'down_revision = "0018_current_trip_delay_exclude_stale"' in text


def test_upgrade_creates_view_at_expected_name() -> None:
    sql = _sql_block("_CREATE_LIVE_VIEW")

    assert "CREATE OR REPLACE VIEW gold.trip_delay_summary_5m_live" in sql


def test_view_reads_from_fact_table_not_batch_mart() -> None:
    """The live view must read from the same source as the batch rollup
    (gold.fact_trip_delay_snapshot), not from the batch mart itself —
    otherwise it inherits the batch staleness."""
    sql = _sql_block("_CREATE_LIVE_VIEW")

    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "FROM gold.trip_delay_summary_5m" not in sql


def test_view_window_is_bounded_to_last_24h() -> None:
    """Window must be bounded so Power BI DirectQuery doesn't aggregate
    over all history on every refresh."""
    sql = _sql_block("_CREATE_LIVE_VIEW")

    assert "captured_at_utc >= now() - INTERVAL '24 hours'" in sql


def test_view_uses_same_5min_date_bin_as_batch_rollup() -> None:
    """Period buckets must align with the batch rollup so the two are
    comparable downstream."""
    sql = _sql_block("_CREATE_LIVE_VIEW")

    assert "DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')" in sql


def test_view_returns_same_column_shape_as_batch_mart() -> None:
    """Live view must mirror gold.trip_delay_summary_5m's columns so it's
    a drop-in source for any visual that already binds to the batch mart."""
    sql = _sql_block("_CREATE_LIVE_VIEW")

    for col in (
        "provider_id",
        "period_start_utc",
        "route_id",
        "trip_count",
        "observation_count",
        "delay_observation_count",
        "avg_delay_seconds",
        "avg_delay_seconds_capped",
        "max_delay_seconds",
        "min_delay_seconds",
        "delayed_trip_count",
        "outlier_count",
        "built_at_utc",
    ):
        assert col in sql, f"missing column: {col}"


def test_view_groups_by_provider_period_route() -> None:
    sql = _sql_block("_CREATE_LIVE_VIEW")

    assert "GROUP BY provider_id" in sql
    assert "COALESCE(route_id, '__unrouted__')" in sql


def test_downgrade_drops_view() -> None:
    text = _read()
    sql = _sql_block("_DROP_LIVE_VIEW")

    assert "DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live" in sql
    assert "def downgrade()" in text
    assert "op.execute(_DROP_LIVE_VIEW)" in text
