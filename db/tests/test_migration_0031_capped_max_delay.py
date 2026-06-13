"""Static contract tests for migration 0031 capped historic max delay."""
from __future__ import annotations

import re
from pathlib import Path

MIGRATION = Path(
    "src/transit_ops/db/migrations/versions/0031_capped_max_delay_5m.py"
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

    assert 'revision = "0031_capped_max_delay_5m"' in text
    assert 'down_revision = "0030_otp_observation_counts"' in text


def test_upgrade_adds_nullable_capped_max_column() -> None:
    text = _read()

    assert '"trip_delay_summary_5m"' in text
    assert '"max_delay_seconds_capped"' in text
    assert "sa.Column" in text
    assert "sa.Integer()" in text
    assert "nullable=True" in text
    assert 'schema="gold"' in text


def test_backfill_copy_recovers_unsaturated_rows_tablewide() -> None:
    sql = _sql_block("_BACKFILL_COPY_SQL")

    assert "UPDATE gold.trip_delay_summary_5m" in sql
    assert "SET max_delay_seconds_capped = max_delay_seconds" in sql
    assert "max_delay_seconds IS NOT NULL" in sql
    assert "ABS(max_delay_seconds) <= 3600" in sql
    assert "gold.fact_trip_delay_snapshot" not in sql


def test_backfill_recompute_repairs_only_saturated_rows_from_fact_window() -> None:
    sql = _sql_block("_BACKFILL_RECOMPUTE_SQL")

    assert "UPDATE gold.trip_delay_summary_5m AS s" in sql
    assert "MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)" in sql
    assert "FROM gold.fact_trip_delay_snapshot" in sql
    assert "DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')" in sql
    assert "ABS(s.max_delay_seconds) > 3600" in sql


def test_live_view_preserves_0030_shape_and_appends_capped_max() -> None:
    sql = _sql_block("_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE")
    compact = " ".join(sql.split())

    assert "CREATE OR REPLACE VIEW gold.trip_delay_summary_5m_live" in sql
    assert "captured_at_utc >= now() - INTERVAL '24 hours'" in sql
    assert "COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer" in sql
    assert "AS on_time_observation_count" in sql
    assert "MAX(delay_seconds) FILTER (WHERE ABS(delay_seconds) <= 3600)" in sql
    expected_suffix = (
        "AS max_delay_seconds_capped FROM gold.fact_trip_delay_snapshot "
        "WHERE captured_at_utc >= now() - INTERVAL '24 hours' GROUP BY provider_id, "
        "DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01'), "
        "COALESCE(route_id, '__unrouted__')"
    )
    assert compact.endswith(expected_suffix)


def test_backfills_persisted_hourly_avg_max_and_fact_window_severe() -> None:
    avg_max_sql = _sql_block("_BACKFILL_HOURLY_CAPPED_AVG_MAX")
    severe_sql = _sql_block("_BACKFILL_HOURLY_CAPPED_SEVERE_FACT_WINDOW")
    weighted_expr = (
        "avg_delay_seconds_capped * NULLIF(delay_observation_count - outlier_count, 0)"
    )

    assert "UPDATE gold.route_delay_hourly AS rd" in avg_max_sql
    assert "FROM gold.trip_delay_summary_5m" in avg_max_sql
    assert weighted_expr in avg_max_sql
    assert "NULLIF(SUM(delay_observation_count - outlier_count), 0)" in avg_max_sql
    assert "MAX(max_delay_seconds_capped)" in avg_max_sql
    assert "UPDATE gold.route_delay_hourly AS rd" in severe_sql
    assert "FROM gold.fact_trip_delay_snapshot" in severe_sql
    assert "delay_seconds > 300 AND ABS(delay_seconds) <= 3600" in severe_sql


def test_backfills_persisted_weekly_and_monthly_from_capped_hourly() -> None:
    for constant in (
        "_BACKFILL_WEEKLY_CAPPED_DELAY_STATS",
        "_BACKFILL_MONTHLY_CAPPED_DELAY_STATS",
    ):
        sql = _sql_block(constant)

        assert "FROM gold.route_delay_hourly AS rd" in sql
        assert "SUM(rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0))" in sql
        assert "SUM(rd.severe_delay_count)::integer" in sql
        assert "avg_delay_seconds = CASE" in sql
        assert "severe_delay_count = b.severe_delay_count" in sql


def test_downgrade_restores_0030_view_and_drops_column() -> None:
    text = _read()
    sql = _sql_block("_RESTORE_0030_TRIP_DELAY_SUMMARY_5M_LIVE")

    assert "AS on_time_observation_count" in sql
    assert "max_delay_seconds_capped" not in sql
    drop_column = (
        'op.drop_column("trip_delay_summary_5m", "max_delay_seconds_capped", schema="gold")'
    )
    assert drop_column in text
