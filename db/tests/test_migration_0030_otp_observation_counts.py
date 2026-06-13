import importlib.util
import inspect
import pathlib


def _load():
    p = (
        pathlib.Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0030_otp_observation_counts.py"
    )
    spec = importlib.util.spec_from_file_location("m0030", p)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def _source() -> str:
    return inspect.getsource(_load())


def test_0030_chain():
    m = _load()
    assert m.revision == "0030_otp_observation_counts"
    assert m.down_revision == "0029_dim_name_history"
    assert callable(m.upgrade) and callable(m.downgrade)


def test_0030_adds_on_time_columns():
    src = _source()
    assert '"trip_delay_summary_5m"' in src
    assert '"on_time_observation_count", sa.Integer(), nullable=True' in src

    for table_name in (
        "route_delay_hourly",
        "route_reliability_weekly",
        "route_reliability_monthly",
    ):
        assert f'"{table_name}"' in src
    assert '"delay_observation_count"' in src
    assert "nullable=False" in src
    assert src.count('"on_time_observation_count", sa.Integer(), nullable=True') == 2
    assert 'server_default=sa.text("0")' in src


def test_0030_backfill_scoped_to_band_and_joins_on_pk():
    m = _load()
    sql = m._BACKFILL_5M_ON_TIME
    assert "UPDATE gold.trip_delay_summary_5m AS s" in sql
    assert "COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer" in sql
    assert "COALESCE(route_id, '__unrouted__') AS route_id" in sql
    assert "DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01')" in sql
    assert "s.provider_id = f.provider_id" in sql
    assert "s.period_start_utc = f.period_start_utc" in sql
    assert "s.route_id = f.route_id" in sql


def test_0030_backfills_persisted_hourly_rollups_from_5m():
    m = _load()
    sql = m._BACKFILL_HOURLY_OTP_OBSERVATIONS
    compact = " ".join(sql.split())

    assert "UPDATE gold.route_delay_hourly AS rd" in sql
    assert "FROM gold.trip_delay_summary_5m" in sql
    assert "date_trunc('hour', period_start_utc) AS period_start_utc" in sql
    assert "SUM(delay_observation_count)::integer AS delay_observation_count" in sql
    assert (
        "CASE WHEN COUNT(*) = COUNT(on_time_observation_count) "
        "THEN SUM(on_time_observation_count)::integer END AS on_time_observation_count"
    ) in compact
    assert "rd.provider_id = h.provider_id" in sql
    assert "rd.period_start_utc = h.period_start_utc" in sql
    assert "rd.route_id = h.route_id" in sql


def test_0030_backfills_persisted_weekly_monthly_rollups_without_nulling_legacy_avg():
    m = _load()

    for attr, table_name, local_column, grain in (
        (
            "_BACKFILL_WEEKLY_OTP_OBSERVATIONS",
            "route_reliability_weekly",
            "week_start_local",
            "week",
        ),
        (
            "_BACKFILL_MONTHLY_OTP_OBSERVATIONS",
            "route_reliability_monthly",
            "month_start_local",
            "month",
        ),
    ):
        sql = getattr(m, attr)
        compact = " ".join(sql.split())

        assert f"UPDATE gold.{table_name} AS rr" in sql
        assert "FROM gold.route_delay_hourly AS rd" in sql
        assert "INNER JOIN gold.dim_provider AS dp" in sql
        assert (
            f"date_trunc('{grain}', timezone(dp.timezone, rd.period_start_utc))::date "
            f"AS {local_column}"
        ) in compact
        assert "SUM(rd.delay_observation_count)::integer AS delay_observation_count" in sql
        assert (
            "CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count) "
            "THEN SUM(rd.on_time_observation_count)::integer END AS on_time_observation_count"
        ) in compact
        assert "rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0)" in sql
        assert "WHEN b.delay_observation_count > 0 THEN b.avg_delay_seconds" in sql
        assert "ELSE rr.avg_delay_seconds" in sql
        assert f"rr.{local_column} = b.{local_column}" in sql


def test_0030_replaces_public_daily_view_appending_columns():
    m = _load()
    sql = m._CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY
    compact = " ".join(sql.split())
    expected_aliases = [
        "provider_id",
        "route_id",
        "provider_local_date",
        "stop_time_observation_count",
        "avg_delay_seconds",
        "severe_delay_observation_count",
        "delay_observation_count",
        "on_time_observation_count",
    ]
    positions = [
        (
            sql.find(f"AS {alias}")
            if alias not in {"provider_id", "route_id"}
            else sql.find(alias)
        )
        for alias in expected_aliases
    ]
    assert all(pos >= 0 for pos in positions)
    assert positions == sorted(positions)
    assert "SUM(rd.delay_observation_count)::integer AS delay_observation_count" in sql
    assert (
        "CASE WHEN COUNT(*) = COUNT(rd.on_time_observation_count) "
        "THEN SUM(rd.on_time_observation_count)::integer END AS on_time_observation_count"
    ) in compact
    assert "rd.avg_delay_seconds * NULLIF(rd.delay_observation_count, 0)" in sql


def test_0030_live_view_parity():
    m = _load()
    sql = m._CREATE_TRIP_DELAY_SUMMARY_5M_LIVE
    assert "CREATE OR REPLACE VIEW gold.trip_delay_summary_5m_live AS" in sql
    assert "now() AS built_at_utc" in sql
    assert "COUNT(*) FILTER (WHERE delay_seconds >= -60 AND delay_seconds < 300)::integer" in sql
    assert "AS on_time_observation_count" in sql
    assert sql.find("now() AS built_at_utc") < sql.find("AS on_time_observation_count")


def test_0030_downgrade_restores_prior_views_and_drops_columns():
    src = _source()
    assert "DROP VIEW IF EXISTS gold.public_route_reliability_daily" in src
    assert "DROP VIEW IF EXISTS gold.trip_delay_summary_5m_live" in src
    assert "_CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY_LEGACY" in src
    assert "_CREATE_TRIP_DELAY_SUMMARY_5M_LIVE_LEGACY" in src
    assert src.count("op.drop_column(") == 7
    assert src.find("_CREATE_PUBLIC_ROUTE_RELIABILITY_DAILY_LEGACY") < src.find(
        'op.drop_column("route_delay_hourly"'
    )
