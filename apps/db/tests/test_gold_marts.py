from __future__ import annotations

from pathlib import Path

import pytest

from transit_ops.core.models import ProviderManifest
from transit_ops.gold.marts import (
    ACQUIRE_GOLD_BUILD_LOCK,
    ANALYZE_REALTIME_SILVER_TABLES,
    CLOSE_DIM_ROUTE_HISTORY,
    CLOSE_DIM_STOP_HISTORY,
    INSERT_DIM_ROUTE,
    INSERT_DIM_ROUTE_PATTERN,
    INSERT_FACT_TRIP_DELAY_SNAPSHOT,
    INSERT_FACT_VEHICLE_SNAPSHOT,
    INSERT_SCHEDULE_VERSION_SERVICE_SUMMARY,
    LOCK_GOLD_TABLES,
    OPEN_DIM_ROUTE_HISTORY,
    OPEN_DIM_STOP_HISTORY,
    SELECT_REALTIME_ANALYZE_AGE_SECONDS,
    UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST,
    build_gold_marts,
    refresh_gold_realtime,
    refresh_gold_static,
)
from transit_ops.settings import Settings

LEGACY_REALTIME_TABLES = (
    "silver.trip_updates",
    "silver.trip_update_stop_time_updates",
    "silver.vehicle_positions",
)
NORMALIZED_REALTIME_TABLES = (
    "silver.rt_feed_snapshots",
    "silver.rt_entities",
    "silver.rt_trip_updates",
    "silver.rt_trip_update_stop_times",
    "silver.rt_vehicle_positions",
)


class FakeScalarResult:
    def __init__(self, scalar_value=None) -> None:  # noqa: ANN001
        self.scalar_value = scalar_value

    def scalar_one(self):  # noqa: ANN201
        return self.scalar_value

    def scalar(self):  # noqa: ANN201
        return self.scalar_value


class FakeMappingResult:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def mappings(self):  # noqa: ANN201
        return self

    def one_or_none(self):  # noqa: ANN201
        return self.row


class RecordingConnection:
    def __init__(
        self,
        *,
        dataset_row: dict[str, object] | None,
        silver_routes_exists: bool = True,
        analyze_age_seconds: float | None = None,
    ) -> None:
        self.dataset_row = dataset_row
        self.silver_routes_exists = silver_routes_exists
        # Seconds since the realtime tables were last ANALYZEd, as the throttle
        # query (SELECT_REALTIME_ANALYZE_AGE_SECONDS) would report it. Default
        # None models "never analyzed" (fresh DB) → the ANALYZE is due.
        self.analyze_age_seconds = analyze_age_seconds
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))

        if "FROM core.dataset_versions" in sql_text:
            return FakeMappingResult(self.dataset_row)
        if "FROM pg_stat_user_tables" in sql_text:
            return FakeScalarResult(self.analyze_age_seconds)
        # Empty-silver guard (slice-9.1.1j): EXISTS over silver.routes for the
        # current version. Routed before the dim-history branches (which key on
        # gold.dim_*_history, not silver.routes) so it cannot be swallowed.
        if "SELECT EXISTS" in sql_text and "FROM silver.routes" in sql_text:
            return FakeScalarResult(self.silver_routes_exists)
        if (
            "SELECT max(source_realtime_snapshot_id)" in sql_text
            and "silver.rt_feed_snapshots" in sql_text
            and "endpoint_key = 'trip_updates'" in sql_text
        ):
            return FakeScalarResult(2)
        if (
            "SELECT max(source_realtime_snapshot_id)" in sql_text
            and "silver.rt_feed_snapshots" in sql_text
            and "endpoint_key = 'vehicle_positions'" in sql_text
        ):
            return FakeScalarResult(1)
        if "SELECT count(*)" in sql_text and "gold.dim_route_pattern" in sql_text:
            return FakeScalarResult(578)
        # history branches MUST precede their dim branches: 'gold.dim_route'
        # is a substring of 'gold.dim_route_history' (ditto stop).
        if "SELECT count(*)" in sql_text and "gold.dim_route_history" in sql_text:
            return FakeScalarResult(231)
        if "SELECT count(*)" in sql_text and "gold.dim_route" in sql_text:
            return FakeScalarResult(216)
        if "SELECT count(*)" in sql_text and "gold.dim_stop_history" in sql_text:
            return FakeScalarResult(9203)
        if "SELECT count(*)" in sql_text and "gold.dim_stop" in sql_text:
            return FakeScalarResult(8897)
        if "SELECT count(*)" in sql_text and "gold.dim_date" in sql_text:
            return FakeScalarResult(99)
        if "SELECT count(*)" in sql_text and "gold.fact_vehicle_snapshot" in sql_text:
            return FakeScalarResult(953)
        if "SELECT count(*)" in sql_text and "gold.fact_trip_delay_snapshot" in sql_text:
            return FakeScalarResult(1780)
        if "SELECT count(*)" in sql_text and "gold.latest_vehicle_snapshot" in sql_text:
            return FakeScalarResult(883)
        if "SELECT count(*)" in sql_text and "gold.latest_trip_delay_snapshot" in sql_text:
            return FakeScalarResult(1998)
        if "INSERT INTO gold.fact_vehicle_snapshot" in sql_text:
            return FakeScalarResult(0)
        if "INSERT INTO gold.fact_trip_delay_snapshot" in sql_text:
            return FakeScalarResult(0)
        return FakeScalarResult(0)


class NoRealtimeSnapshotConnection(RecordingConnection):
    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        if "SELECT max(source_realtime_snapshot_id)" in sql_text:
            self.calls.append((sql_text, params))
            return FakeScalarResult(None)
        return super().execute(statement, params)


class _ContextManager:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def __enter__(self):  # noqa: ANN201
        return self.connection

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, ANN201
        return False


class FakeEngine:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def begin(self):  # noqa: ANN201
        return _ContextManager(self.connection)


class FakeRegistry:
    def __init__(self, manifest: ProviderManifest) -> None:
        self.manifest = manifest

    def get_provider(self, provider_id: str) -> ProviderManifest:
        assert provider_id == self.manifest.provider.provider_id
        return self.manifest


def _build_manifest() -> ProviderManifest:
    return ProviderManifest.model_validate(
        {
            "provider": {
                "provider_id": "stm",
                "display_name": "STM",
                "timezone": "America/Toronto",
                "is_active": True,
            },
            "feeds": {
                "static_schedule": {
                    "endpoint_key": "static_schedule",
                    "feed_kind": "static_schedule",
                    "source_format": "gtfs_schedule_zip",
                    "source_url": "https://example.com/static.zip",
                    "auth": {"auth_type": "none"},
                    "refresh_interval_seconds": 86400,
                },
                "gis_static": {
                    "endpoint_key": "gis_static",
                    "feed_kind": "gis_static",
                    "source_format": "stm_gis_zip",
                    "source_url": "https://example.com/gis.zip",
                    "auth": {"auth_type": "none"},
                    "refresh_interval_seconds": 86400,
                },
                "trip_updates": {
                    "endpoint_key": "trip_updates",
                    "feed_kind": "trip_updates",
                    "source_format": "gtfs_rt_trip_updates",
                    "source_url": "https://example.com/trip-updates.pb",
                    "auth": {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    },
                    "refresh_interval_seconds": 30,
                },
                "vehicle_positions": {
                    "endpoint_key": "vehicle_positions",
                    "feed_kind": "vehicle_positions",
                    "source_format": "gtfs_rt_vehicle_positions",
                    "source_url": "https://example.com/vehicle-positions.pb",
                    "auth": {
                        "auth_type": "api_key",
                        "credential_env_var": "STM_API_KEY",
                        "auth_header_name": "apiKey",
                    },
                    "refresh_interval_seconds": 30,
                },
            },
        }
    )


def _assert_no_legacy_realtime_sql(sql_text: str) -> None:
    assert not any(table_name in sql_text for table_name in LEGACY_REALTIME_TABLES)


def _assert_normalized_realtime_tables(sql_text: str) -> None:
    for table_name in NORMALIZED_REALTIME_TABLES:
        assert table_name in sql_text


def test_build_gold_marts_rebuilds_dimensions_and_facts() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    result = build_gold_marts(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    assert result.provider_id == "stm"
    assert result.provider_timezone == "America/Toronto"
    assert result.dataset_version_id == 2
    assert result.latest_trip_updates_snapshot_id == 2
    assert result.latest_vehicle_snapshot_id == 1
    assert result.row_counts == {
        "dim_route": 216,
        "dim_stop": 8897,
        "dim_date": 99,
        "dim_route_pattern": 578,
        "dim_route_history": 231,
        "dim_stop_history": 9203,
        "fact_vehicle_snapshot": 953,
        "fact_trip_delay_snapshot": 1780,
        "latest_vehicle_snapshot": 883,
        "latest_trip_delay_snapshot": 1998,
    }
    sql_calls = [call[0] for call in connection.calls]
    for sql in sql_calls:
        _assert_no_legacy_realtime_sql(sql)
    assert any("DELETE FROM gold.fact_trip_delay_snapshot" in sql for sql in sql_calls)
    assert any("INSERT INTO gold.dim_route" in sql for sql in sql_calls)
    fact_trip_insert = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO gold.fact_trip_delay_snapshot" in sql
    )
    assert fact_trip_insert["dataset_version_id"] == 2


def test_vehicle_snapshot_fact_reads_normalized_rt_vehicle_positions() -> None:
    sql = str(INSERT_FACT_VEHICLE_SNAPSHOT)

    _assert_no_legacy_realtime_sql(sql)
    assert "FROM silver.rt_vehicle_positions AS vp" in sql
    assert "INNER JOIN silver.rt_feed_snapshots AS rfs" in sql
    assert "LEFT JOIN silver.rt_entities AS rte" in sql
    assert "rfs.source_realtime_snapshot_id AS realtime_snapshot_id" in sql
    assert "vp.vehicle_timestamp_utc" in sql
    assert "position_timestamp_utc" in sql
    assert "rte.entity_id" in sql


def test_trip_delay_fact_backfills_vehicle_and_delay_from_normalized_rt_tables() -> None:
    sql = str(INSERT_FACT_TRIP_DELAY_SNAPSHOT)

    _assert_no_legacy_realtime_sql(sql)
    _assert_normalized_realtime_tables(sql)
    assert "rfs.source_realtime_snapshot_id AS realtime_snapshot_id" in sql
    assert "rte.entity_id" in sql
    assert "rtu.schedule_relationship AS trip_schedule_relationship" in sql
    assert "tdf.derived_delay_seconds" in sql
    assert "rtu.delay_seconds" not in sql
    assert "rtu.vehicle_id" not in sql
    assert "vpm.vehicle_id" in sql
    assert "LEFT JOIN LATERAL" in sql
    assert "silver.rt_vehicle_positions AS vp" in sql
    assert "silver.stop_times AS st" in sql
    assert "st.dataset_version_id = :dataset_version_id" in sql


def test_trip_delay_fact_attributes_delay_to_next_stop() -> None:
    sql = str(INSERT_FACT_TRIP_DELAY_SNAPSHOT)
    insert_columns = sql.split("INSERT INTO", 1)[1].split("SELECT", 1)[0]

    assert "COALESCE(stu.stop_id, st.stop_id) AS delay_stop_id" in sql
    assert "stu.stop_sequence AS delay_stop_sequence" in sql
    assert "delay_rank = 1" in sql
    assert "tdf.delay_stop_id" in sql
    assert "tdf.delay_stop_sequence" in sql
    assert "delay_stop_id" in insert_columns
    assert "delay_stop_sequence" in insert_columns


def test_trip_delay_latest_upsert_updates_delay_stop_attribution() -> None:
    sql = str(UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST)

    assert "delay_stop_id = EXCLUDED.delay_stop_id" in sql
    assert "delay_stop_sequence = EXCLUDED.delay_stop_sequence" in sql


def test_migration_0034_adds_delay_stop_columns_and_repairs_stop_history() -> None:
    migration_path = (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0034_trip_delay_stop_attribution.py"
    )
    source = migration_path.read_text()

    assert 'revision = "0034_trip_delay_stop_attribution"' in source
    assert 'down_revision = "0033_trip_delay_summary_severe_counts"' in source
    assert '"fact_trip_delay_snapshot"' in source
    assert '"latest_trip_delay_snapshot"' in source
    assert '"delay_stop_id"' in source
    assert '"delay_stop_sequence"' in source
    assert "_BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION" in source
    assert "_REBUILD_STOP_DELAY_HOURLY_FROM_FACT" in source
    assert "DELETE FROM gold.stop_delay_hourly" in source
    assert "FROM gold.fact_trip_delay_snapshot" in source
    assert "ABS(delay_seconds) <= 3600" in source
    assert "gold.stop_delay_weekly" in source
    assert "gold.stop_delay_monthly" in source
    assert "_DELETE_STOP_DELAY_WEEKLY" in source
    assert "_INSERT_STOP_DELAY_WEEKLY" in source
    assert "_DELETE_STOP_DELAY_MONTHLY" in source
    assert "_INSERT_STOP_DELAY_MONTHLY" in source
    assert "_DELETE_REPEATED_PROBLEM_ROUTE_STOP" in source
    assert "_INSERT_REPEATED_PROBLEM_ROUTE_STOP" in source
    # wave-2 prod hardening: the heavy pre-deploy fact backfill is DEFERRED
    # (unbounded 500M-row scan blew prod /dev/shm, 2h40m hang). The constants
    # stay defined (recovery) but must NOT be executed in upgrade(); ramp-in
    # only, per the car-5 reviewer-approved design. Guard against silent re-enable.
    assert "# op.execute(_BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION)" in source
    assert "\n    op.execute(_BACKFILL_FACT_TRIP_DELAY_STOP_ATTRIBUTION)" not in source
    assert "\n    op.execute(_BACKFILL_LATEST_TRIP_DELAY_STOP_ATTRIBUTION)" not in source


def test_trip_delay_latest_scopes_stop_time_counts_to_snapshot() -> None:
    """slice-9.1.1i: the per-cycle (latest_only) refresh must not aggregate the
    whole rt_trip_update_stop_times table inside stop_time_counts — prod
    measured ~252M rows / 29 GB, making the refresh ~691s instead of <30s."""
    latest_sql = str(UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST)
    full_sql = str(INSERT_FACT_TRIP_DELAY_SNAPSHOT)

    latest_counts_cte = latest_sql.split("stop_time_candidates AS")[0]
    assert "INNER JOIN silver.rt_feed_snapshots AS sfs" in latest_counts_cte
    assert "sfs.source_realtime_snapshot_id = :realtime_snapshot_id" in latest_counts_cte

    # The full-rebuild variant intentionally keeps the unscoped aggregate
    # (it repopulates every retained snapshot) and binds no latest param.
    full_counts_cte = full_sql.split("stop_time_candidates AS")[0]
    assert "INNER JOIN silver.rt_feed_snapshots AS sfs" not in full_counts_cte
    assert ":realtime_snapshot_id" not in full_sql


def test_trip_delay_scheduled_time_uses_noon_minus_12h_anchor() -> None:
    for sql in (str(INSERT_FACT_TRIP_DELAY_SNAPSHOT), str(UPSERT_FACT_TRIP_DELAY_SNAPSHOT_LATEST)):
        assert "timezone(" in sql
        assert "rtu.start_date::timestamp + interval '12 hours'" in sql
        assert "- interval '12 hours'" in sql
        assert "AT TIME ZONE" not in sql
        assert "hours => split_part(" in sql


def test_dim_route_exposes_beta_route_description_detail() -> None:
    sql = str(INSERT_DIM_ROUTE)

    assert "route_desc_detail" in sql


def test_dim_route_pattern_uses_beta_route_patterns_source() -> None:
    sql = str(INSERT_DIM_ROUTE_PATTERN)

    assert "INSERT INTO gold.dim_route_pattern" in sql
    assert "FROM silver.route_patterns" in sql
    assert "route_pattern_typicality" in sql


def test_gold_build_uses_provider_scoped_advisory_lock() -> None:
    sql = str(ACQUIRE_GOLD_BUILD_LOCK)

    assert "pg_advisory_xact_lock" in sql
    assert "hashtext('gold_marts')" in sql
    assert "hashtext(:provider_id)" in sql


def test_gold_build_locks_tables_before_rebuild() -> None:
    sql = str(LOCK_GOLD_TABLES)

    assert "LOCK TABLE" in sql
    assert "gold.dim_route" in sql
    assert "gold.fact_trip_delay_snapshot" in sql
    assert "gold.latest_trip_delay_snapshot" in sql
    assert "ACCESS EXCLUSIVE MODE" in sql


def test_refresh_gold_realtime_upserts_latest_snapshots_only() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    result = refresh_gold_realtime(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    assert result.latest_trip_updates_snapshot_id == 2
    assert result.latest_vehicle_snapshot_id == 1
    assert result.row_counts == {
        "fact_vehicle_snapshot_upserted": 0,
        "fact_trip_delay_snapshot_upserted": 0,
        "latest_vehicle_snapshot": 883,
        "latest_trip_delay_snapshot": 1998,
    }
    sql_calls = [call[0] for call in connection.calls]
    for sql in sql_calls:
        _assert_no_legacy_realtime_sql(sql)
    assert any("DELETE FROM gold.latest_vehicle_snapshot" in sql for sql in sql_calls)
    assert any("INSERT INTO gold.latest_vehicle_snapshot" in sql for sql in sql_calls)


def test_refresh_gold_realtime_analyzes_realtime_silver_before_gold_upserts() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    refresh_gold_realtime(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    sql_calls = [call[0] for call in connection.calls]
    analyze_index = next(
        index
        for index, sql in enumerate(sql_calls)
        if "ANALYZE silver.rt_feed_snapshots" in sql
    )
    first_gold_upsert_index = next(
        index
        for index, sql in enumerate(sql_calls)
        if "INSERT INTO gold.fact_vehicle_snapshot" in sql
        or "INSERT INTO gold.fact_trip_delay_snapshot" in sql
    )

    assert analyze_index < first_gold_upsert_index
    analyze_sql = sql_calls[analyze_index]
    _assert_no_legacy_realtime_sql(analyze_sql)
    _assert_normalized_realtime_tables(analyze_sql)
    assert str(ANALYZE_REALTIME_SILVER_TABLES) == analyze_sql


def test_refresh_gold_realtime_analyzes_even_when_no_realtime_snapshots() -> None:
    connection = NoRealtimeSnapshotConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    result = refresh_gold_realtime(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    sql_calls = [call[0] for call in connection.calls]

    assert result.latest_trip_updates_snapshot_id is None
    assert result.latest_vehicle_snapshot_id is None
    assert any("ANALYZE silver.rt_feed_snapshots" in sql for sql in sql_calls)
    for sql in sql_calls:
        _assert_no_legacy_realtime_sql(sql)
    assert not any("INSERT INTO gold.fact_vehicle_snapshot" in sql for sql in sql_calls)
    assert not any("INSERT INTO gold.fact_trip_delay_snapshot" in sql for sql in sql_calls)


def test_refresh_gold_realtime_skips_analyze_when_recently_analyzed() -> None:
    """The per-cycle realtime-silver ANALYZE is throttled (gold#2 / x-perf#0).

    The full ANALYZE (incl. the ~500M-row rt_trip_update_stop_times) took SHARE
    UPDATE EXCLUSIVE + heavy sampling I/O inside the advisory-locked gold-refresh
    TX and ran unconditionally ~1500x/day. When the realtime tables were analyzed
    less than GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS ago, the ANALYZE must be
    SKIPPED — the upserts filter on a constant rt_feed_snapshot_id, so stale
    stats barely move the plan.
    """
    connection = RecordingConnection(
        dataset_row={"dataset_version_id": 2},
        analyze_age_seconds=60.0,  # analyzed 60s ago, well inside the 1h window
    )
    engine = FakeEngine(connection)
    settings = Settings(
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS=3600,
    )

    refresh_gold_realtime(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    sql_calls = [call[0] for call in connection.calls]
    # The throttle was consulted...
    assert any("FROM pg_stat_user_tables" in sql for sql in sql_calls)
    # ...and the heavy ANALYZE was skipped this cycle.
    assert not any("ANALYZE silver.rt_feed_snapshots" in sql for sql in sql_calls)
    # The gold upserts still ran — throttling ANALYZE must not skip the refresh.
    assert any("INSERT INTO gold.fact_vehicle_snapshot" in sql for sql in sql_calls)


def test_refresh_gold_realtime_runs_analyze_when_stats_are_stale() -> None:
    """Once the realtime stats are older than the throttle interval, ANALYZE runs."""
    connection = RecordingConnection(
        dataset_row={"dataset_version_id": 2},
        analyze_age_seconds=7200.0,  # 2h old, past the 1h throttle window
    )
    engine = FakeEngine(connection)
    settings = Settings(
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS=3600,
    )

    refresh_gold_realtime(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    sql_calls = [call[0] for call in connection.calls]
    assert any("ANALYZE silver.rt_feed_snapshots" in sql for sql in sql_calls)


def test_refresh_gold_realtime_always_analyzes_when_throttle_disabled() -> None:
    """interval <= 0 disables the throttle — ANALYZE runs every cycle (escape hatch)."""
    connection = RecordingConnection(
        dataset_row={"dataset_version_id": 2},
        analyze_age_seconds=1.0,  # just analyzed, but throttle disabled
    )
    engine = FakeEngine(connection)
    settings = Settings(
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS=0,
    )

    refresh_gold_realtime(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    sql_calls = [call[0] for call in connection.calls]
    assert any("ANALYZE silver.rt_feed_snapshots" in sql for sql in sql_calls)
    # Throttle disabled — the staleness query is not even issued.
    assert not any("FROM pg_stat_user_tables" in sql for sql in sql_calls)


def test_realtime_analyze_age_query_targets_only_realtime_silver_tables() -> None:
    """SQL-marker: the throttle reads pg_stat_user_tables for the five rt tables.

    It must take the MIN age (max() over the most-recent analyze/autoanalyze per
    table, then now() - that) so a single stale table forces a refresh, and must
    return NULL (HAVING ... IS NOT NULL) when none has ever been analyzed so the
    fresh-DB bootstrap case still runs ANALYZE.
    """
    sql = str(SELECT_REALTIME_ANALYZE_AGE_SECONDS)

    assert "pg_stat_user_tables" in sql
    assert "schemaname = 'silver'" in sql
    for relname in (
        "rt_feed_snapshots",
        "rt_entities",
        "rt_trip_updates",
        "rt_trip_update_stop_times",
        "rt_vehicle_positions",
    ):
        assert relname in sql
    assert "last_analyze" in sql
    assert "last_autoanalyze" in sql
    # NULL when never analyzed → _realtime_analyze_is_due treats it as due.
    assert "IS NOT NULL" in sql


def test_build_gold_marts_requires_current_static_dataset() -> None:
    connection = RecordingConnection(dataset_row=None)
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    with pytest.raises(ValueError, match="Run load-static-silver before build-gold-marts"):
        build_gold_marts(
            "stm",
            settings=settings,
            registry=FakeRegistry(_build_manifest()),
            engine=engine,
        )


def test_refresh_gold_static_refreshes_only_dimensions() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    result = refresh_gold_static(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    assert result.provider_id == "stm"
    assert result.provider_timezone == "America/Toronto"
    assert result.dataset_version_id == 2
    assert result.row_counts == {
        "dim_route": 216,
        "dim_route_pattern": 578,
        "dim_stop": 8897,
        "dim_date": 99,
        "dim_route_history": 231,
        "dim_stop_history": 9203,
    }
    sql_calls = [call[0] for call in connection.calls]
    # Advisory lock acquired — serializes with realtime refresh
    assert any("pg_advisory_xact_lock" in sql for sql in sql_calls)
    # Dimension tables are refreshed
    assert any("DELETE FROM gold.dim_route" in sql for sql in sql_calls)
    assert any("DELETE FROM gold.dim_route_pattern" in sql for sql in sql_calls)
    assert any("INSERT INTO gold.dim_route" in sql for sql in sql_calls)
    assert any("INSERT INTO gold.dim_route_pattern" in sql for sql in sql_calls)
    assert any("DELETE FROM gold.dim_stop" in sql for sql in sql_calls)
    assert any("DELETE FROM gold.dim_date" in sql for sql in sql_calls)
    # Per-edition scheduled-service summary is captured (migration 0069).
    assert any(
        "INSERT INTO gold.schedule_version_service_summary" in sql for sql in sql_calls
    )
    # ACCESS EXCLUSIVE table lock is NOT acquired
    assert not any("LOCK TABLE" in sql for sql in sql_calls)
    # Fact and latest tables are NOT touched
    assert not any("fact_vehicle_snapshot" in sql for sql in sql_calls)
    assert not any("fact_trip_delay_snapshot" in sql for sql in sql_calls)
    assert not any("latest_vehicle_snapshot" in sql for sql in sql_calls)
    assert not any("latest_trip_delay_snapshot" in sql for sql in sql_calls)


def _assert_name_history_recorded(connection: RecordingConnection) -> None:
    sql_calls = [call[0] for call in connection.calls]

    # Close-then-open per entity: the UPDATE must run before the INSERT on the
    # same connection so a renamed id gets its old row closed first.
    for entity in ("route", "stop"):
        close_index = next(
            index
            for index, sql in enumerate(sql_calls)
            if f"UPDATE gold.dim_{entity}_history" in sql
        )
        open_index = next(
            index
            for index, sql in enumerate(sql_calls)
            if f"INSERT INTO gold.dim_{entity}_history" in sql
        )
        assert close_index < open_index
        assert connection.calls[close_index][1]["dataset_version_id"] == 2
        assert connection.calls[open_index][1]["dataset_version_id"] == 2

    # Append-only: no refresh path may ever delete history rows.
    assert not any("DELETE FROM gold.dim_route_history" in sql for sql in sql_calls)
    assert not any("DELETE FROM gold.dim_stop_history" in sql for sql in sql_calls)


def test_refresh_gold_static_records_name_history() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    refresh_gold_static(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    _assert_name_history_recorded(connection)


def test_build_gold_marts_records_name_history() -> None:
    connection = RecordingConnection(dataset_row={"dataset_version_id": 2})
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    build_gold_marts(
        "stm",
        settings=settings,
        registry=FakeRegistry(_build_manifest()),
        engine=engine,
    )

    _assert_name_history_recorded(connection)


def test_dim_history_statements_sql_contract() -> None:
    close_route = str(CLOSE_DIM_ROUTE_HISTORY)
    close_stop = str(CLOSE_DIM_STOP_HISTORY)
    open_route = str(OPEN_DIM_ROUTE_HISTORY)
    open_stop = str(OPEN_DIM_STOP_HISTORY)

    for close_sql in (close_route, close_stop):
        assert "valid_to_utc IS NULL" in close_sql
        # NULL-safe attribute comparison — plain '=' would treat NULL names as changed
        assert "IS NOT DISTINCT FROM" in close_sql
        assert "DELETE" not in close_sql
    for open_sql in (open_route, open_stop):
        assert "NOT EXISTS" in open_sql
        assert "valid_to_utc IS NULL" in open_sql
        assert "DELETE" not in open_sql

    # Diffed against NEW-version silver, never the (already pruned) old version.
    assert "silver.routes" in close_route and "silver.routes" in open_route
    assert "silver.stops" in close_stop and "silver.stops" in open_stop


def test_schedule_version_service_summary_insert_sql_contract() -> None:
    sql = str(INSERT_SCHEDULE_VERSION_SERVICE_SUMMARY)

    assert "INSERT INTO gold.schedule_version_service_summary" in sql
    # Reads the NEW edition's scheduled silver — never realtime facts.
    for silver_table in (
        "silver.calendar",
        "silver.trips",
        "silver.stop_times",
        "silver.calendar_dates",
    ):
        assert silver_table in sql
    assert ":dataset_version_id" in sql
    # day_type membership (not partition): weekday OR-of-weekday-booleans + the
    # explode VALUES over the three day_types.
    assert "(monday OR tuesday OR wednesday OR thursday OR friday)" in sql
    assert "'weekday'" in sql and "'saturday'" in sql and "'sunday'" in sql
    # service-seconds via split_part; overnight >24:00 preserved (no modulo 86400).
    assert "split_part" in sql
    assert "86400" not in sql
    # honest calendar_dates exception counts.
    assert "exception_type = 1" in sql and "exception_type = 2" in sql
    # fan-out-free: exceptions are pre-aggregated at (route_id, day_type) grain in
    # a dedicated CTE, then joined once — never summed on the per-trip trip_dep,
    # which would multiply each service's exc counts by its trip count into this
    # never-pruned permanent-history table.
    assert "route_day_exceptions AS (" in sql
    # exc is joined inside the dedicated CTE, before the final INSERT ... SELECT
    # FROM trip_dep (the LAST trip_dep reference), and never on trip_dep itself.
    exc_join_idx = sql.index("LEFT JOIN exc")
    final_trip_dep_idx = sql.rindex("FROM trip_dep AS td")
    assert exc_join_idx < final_trip_dep_idx
    assert "LEFT JOIN exc" not in sql[final_trip_dep_idx:]
    assert "LEFT JOIN route_day_exceptions AS rde" in sql
    # reserved headway columns are written NULL in v1.
    assert "scheduled_median_headway_min" in sql
    assert "scheduled_p10_headway_min" in sql
    assert "scheduled_p90_headway_min" in sql


def test_refresh_gold_static_raises_when_current_version_has_no_silver_rows() -> None:
    # Wedged prod state: is_current version exists but has zero silver.routes
    # rows. refresh_gold_static must hard-error BEFORE deleting any dim, so it
    # cannot wipe gold dims and INSERT zero rows (slice-9.1.1j guard).
    connection = RecordingConnection(
        dataset_row={"dataset_version_id": 2},
        silver_routes_exists=False,
    )
    engine = FakeEngine(connection)
    settings = Settings(DATABASE_URL="postgresql://user:pass@example.com/transit")

    with pytest.raises(ValueError, match="load-static-silver"):
        refresh_gold_static(
            "stm",
            settings=settings,
            registry=FakeRegistry(_build_manifest()),
            engine=engine,
        )

    sql_calls = [call[0] for call in connection.calls]
    assert not any("DELETE FROM gold.dim_" in sql for sql in sql_calls)


def test_refresh_gold_static_guard_checks_silver_routes_for_current_version() -> None:
    from transit_ops.gold.marts import SELECT_CURRENT_VERSION_HAS_SILVER_ROUTES

    sql = str(SELECT_CURRENT_VERSION_HAS_SILVER_ROUTES)
    assert "silver.routes" in sql
    assert ":provider_id" in sql
    assert ":dataset_version_id" in sql
    assert "EXISTS" in sql
