from contextlib import contextmanager
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import OperationalError

from transit_ops.gold import delay_periods
from transit_ops.gold.delay_cohorts import delay_period_is_complete
from transit_ops.gold.delay_hours import refresh_changed_delay_hours

PROVIDER = "delay_period_lifecycle"
PERIOD = datetime(2026, 9, 4, 11, 55, tzinfo=UTC)


@pytest.fixture(autouse=True)
def fixed_retention_clock(monkeypatch):
    monkeypatch.setattr(delay_periods, "utc_now", lambda: PERIOD + timedelta(days=1))


class TransactionEngine:
    def __init__(self, connection):
        self.connection = connection

    @contextmanager
    def begin(self):
        with self.connection.begin_nested():
            yield self.connection


@pytest.fixture
def conn(real_db_engine, seed_provider):
    with real_db_engine.connect() as connection, connection.begin() as transaction:
        seed_provider(connection, PROVIDER, display_name="Delay period lifecycle")
        try:
            yield connection
        finally:
            transaction.rollback()


def add_capture(conn, captured, delay=60, route="51"):
    snapshot_id = conn.execute(
        text("""
        WITH endpoint AS (
            INSERT INTO core.feed_endpoints
                (provider_id, endpoint_key, feed_kind, source_format)
            VALUES (:provider, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates')
            ON CONFLICT (provider_id, endpoint_key) DO UPDATE SET provider_id = EXCLUDED.provider_id
            RETURNING feed_endpoint_id
        ), run AS (
            INSERT INTO raw.ingestion_runs
                (provider_id, feed_endpoint_id, run_kind, status)
            SELECT :provider, feed_endpoint_id, 'trip_updates', 'succeeded' FROM endpoint
            RETURNING ingestion_run_id, feed_endpoint_id
        ), object AS (
            INSERT INTO raw.ingestion_objects
                (ingestion_run_id, provider_id, object_kind, storage_backend,
                 storage_path, checksum_sha256, byte_size)
            SELECT ingestion_run_id, :provider, 'trip_updates', 'local', :key, repeat('a', 64), 1
            FROM run RETURNING ingestion_object_id, ingestion_run_id
        ), snapshot AS (
            INSERT INTO raw.realtime_snapshot_index
                (provider_id, feed_endpoint_id, ingestion_run_id, ingestion_object_id,
                 feed_timestamp_utc, captured_at_utc, entity_count)
            SELECT :provider, feed_endpoint_id, ingestion_run_id, ingestion_object_id,
                   :captured, :captured, 1
            FROM run JOIN object USING (ingestion_run_id) RETURNING realtime_snapshot_id
        )
        INSERT INTO gold.fact_trip_delay_snapshot
            (provider_id, realtime_snapshot_id, entity_index, snapshot_date_key,
             snapshot_local_date, feed_timestamp_utc, captured_at_utc, entity_id,
             trip_id, route_id, delay_seconds, stop_time_update_count)
        SELECT :provider, realtime_snapshot_id, 0, :date_key, :day,
               :captured, :captured, 'entity', 'trip', :route, :delay, 1
        FROM snapshot RETURNING realtime_snapshot_id
        """),
        {
            "provider": PROVIDER,
            "key": captured.isoformat(),
            "captured": captured,
            "date_key": int(captured.strftime("%Y%m%d")),
            "day": captured.date(),
            "route": route,
            "delay": delay,
        },
    ).scalar_one()
    conn.execute(
        text("""
        WITH frame AS (
            INSERT INTO silver.rt_feed_snapshots
                (provider_id, feed_endpoint_id, ingestion_run_id, ingestion_object_id,
                 endpoint_key, feed_timestamp_utc, captured_at_utc, checksum_sha256,
                 byte_size, source_realtime_snapshot_id, manifest_json)
            SELECT provider_id, feed_endpoint_id, ingestion_run_id, ingestion_object_id,
                   'trip_updates', feed_timestamp_utc, captured_at_utc, repeat('a',64),
                   1, realtime_snapshot_id, jsonb_build_object('entity_count', 1)
            FROM raw.realtime_snapshot_index WHERE realtime_snapshot_id = :snapshot
            RETURNING rt_feed_snapshot_id
        ), entity AS (
            INSERT INTO silver.rt_entities
                (rt_feed_snapshot_id, entity_index, provider_id, entity_id, entity_kind)
            SELECT rt_feed_snapshot_id, 0, :provider, 'entity', 'trip_update' FROM frame
        )
        INSERT INTO silver.rt_trip_updates
            (rt_feed_snapshot_id, entity_index, provider_id, trip_id, route_id,
             feed_timestamp_utc, captured_at_utc)
        SELECT rt_feed_snapshot_id, 0, :provider, 'trip', :route, :captured, :captured FROM frame
        """),
        {"provider": PROVIDER, "snapshot": snapshot_id, "captured": captured, "route": route},
    )
    return snapshot_id


def build(conn, now):
    return delay_periods.build_delay_periods(
        TransactionEngine(conn),
        provider_id=PROVIDER,
        since_utc=None,
        now=now,
        progress=delay_periods.PeriodBuildProgress(),
    )


def summaries(conn):
    return conn.execute(
        text("""
        SELECT period_start_utc, route_id, observation_count, usable_delay_sum_seconds
        FROM gold.trip_delay_summary_5m
        WHERE provider_id = :provider ORDER BY period_start_utc, route_id
        """),
        {"provider": PROVIDER},
    ).all()


def test_open_interval_remains_unfinalized_until_its_closing_boundary(conn):
    add_capture(conn, PERIOD + timedelta(seconds=5))
    assert build(conn, PERIOD + timedelta(minutes=3)) == 0
    assert summaries(conn) == []
    assert (
        conn.execute(
            text("SELECT count(*) FROM gold.warm_rollup_periods WHERE provider_id = :provider"),
            {"provider": PROVIDER},
        ).scalar_one()
        == 0
    )
    add_capture(conn, PERIOD + timedelta(minutes=4, seconds=30), delay=120)
    assert build(conn, PERIOD + timedelta(minutes=5)) == 1
    assert summaries(conn) == [(PERIOD, "51", 2, 180)]


def test_run_cutoff_excludes_current_and_future_capture_intervals(conn):
    add_capture(conn, PERIOD - timedelta(seconds=30))
    add_capture(conn, PERIOD + timedelta(seconds=30))
    add_capture(conn, PERIOD + timedelta(minutes=10))
    assert build(conn, PERIOD + timedelta(minutes=2)) == 1
    assert summaries(conn) == [(PERIOD - timedelta(minutes=5), "51", 1, 60)]


def test_late_capture_invalidates_then_rebuilds_the_complete_interval(conn):
    add_capture(conn, PERIOD + timedelta(seconds=5))
    assert build(conn, PERIOD + timedelta(minutes=5)) == 1
    snapshot_id = add_capture(conn, PERIOD + timedelta(minutes=4), delay=120)
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    assert summaries(conn) == [(PERIOD, "51", 1, 60)]
    assert build(conn, PERIOD + timedelta(minutes=10)) == 1
    assert summaries(conn) == [(PERIOD, "51", 2, 180)]
    assert build(conn, PERIOD + timedelta(minutes=15)) == 0


def test_same_count_route_and_delay_correction_removes_the_obsolete_route(conn):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    conn.execute(
        text("""
        UPDATE gold.fact_trip_delay_snapshot SET route_id = '80', delay_seconds = -120
        WHERE provider_id = :provider AND realtime_snapshot_id = :snapshot
        """),
        {"provider": PROVIDER, "snapshot": snapshot_id},
    )
    assert build(conn, PERIOD + timedelta(minutes=10)) == 1
    assert summaries(conn) == [(PERIOD, "80", 1, -120)]


def test_removed_capture_rebuilds_an_empty_interval(conn):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id = :provider"),
        {"provider": PROVIDER},
    )
    with pytest.raises(ValueError, match="capture evidence is incomplete"):
        build(conn, PERIOD + timedelta(minutes=10))
    assert summaries(conn) == [(PERIOD, "51", 1, 60)]
    conn.execute(
        text("DELETE FROM silver.rt_trip_updates WHERE provider_id = :provider"),
        {"provider": PROVIDER},
    )
    conn.execute(
        text("UPDATE silver.rt_entities SET entity_kind = 'unknown' WHERE provider_id = :provider"),
        {"provider": PROVIDER},
    )
    assert build(conn, PERIOD + timedelta(minutes=10)) == 1
    assert summaries(conn) == []
    assert build(conn, PERIOD + timedelta(minutes=15)) == 0


def test_expired_raw_history_cannot_replace_retained_summaries(conn, monkeypatch):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id = :provider"),
        {"provider": PROVIDER},
    )
    later = PERIOD + timedelta(days=15)
    monkeypatch.setattr(delay_periods, "utc_now", lambda: later)
    assert build(conn, later) == 0
    assert summaries(conn) == [(PERIOD, "51", 1, 60)]


def test_retention_safety_is_rechecked_after_candidate_selection(conn, monkeypatch):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    monkeypatch.setattr(delay_periods, "utc_now", lambda: PERIOD + timedelta(days=14, minutes=1))
    assert build(conn, PERIOD + timedelta(minutes=10)) == 0
    assert summaries(conn) == [(PERIOD, "51", 1, 60)]


def test_watermark_failure_preserves_previous_summary_and_retryability(conn):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    conn.execute(
        text("UPDATE gold.fact_trip_delay_snapshot SET delay_seconds = 120 WHERE provider_id = :p"),
        {"p": PROVIDER},
    )

    def fail_watermark(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO gold.warm_rollup_periods" in statement:
            raise RuntimeError("watermark failure")

    event.listen(conn, "before_cursor_execute", fail_watermark)
    try:
        with pytest.raises(RuntimeError, match="watermark failure"):
            build(conn, PERIOD + timedelta(minutes=10))
    finally:
        event.remove(conn, "before_cursor_execute", fail_watermark)
    assert summaries(conn) == [(PERIOD, "51", 1, 60)]
    assert build(conn, PERIOD + timedelta(minutes=10)) == 1
    assert summaries(conn) == [(PERIOD, "51", 1, 120)]


def test_invalidation_locks_even_when_no_watermark_exists(real_db_engine, seed_provider):
    with real_db_engine.begin() as connection:
        seed_provider(connection, PROVIDER, display_name="Delay period lifecycle")
        snapshot_id = add_capture(connection, PERIOD + timedelta(seconds=5))
    try:
        with real_db_engine.begin() as writer:
            delay_periods.invalidate_delay_snapshot(writer, PROVIDER, snapshot_id)
            with real_db_engine.connect() as contender, contender.begin():
                contender.execute(text("SET LOCAL lock_timeout='100ms'"))
                with pytest.raises(OperationalError) as blocked:
                    delay_periods.lock_delay_period(contender, PROVIDER, PERIOD)
                assert blocked.value.orig.sqlstate == "55P03"
            writer.execute(
                text("""
                UPDATE gold.fact_trip_delay_snapshot SET delay_seconds = 120
                WHERE provider_id = :provider
                """),
                {"provider": PROVIDER},
            )
        result = delay_periods.build_delay_periods(
            real_db_engine,
            provider_id=PROVIDER,
            since_utc=None,
            now=PERIOD + timedelta(minutes=5),
            progress=delay_periods.PeriodBuildProgress(),
        )
        assert result == 1
        with real_db_engine.connect() as connection:
            assert summaries(connection) == [(PERIOD, "51", 1, 120)]
    finally:
        with real_db_engine.begin() as connection:
            for table in (
                "gold.trip_delay_summary_5m",
                "gold.warm_rollup_periods",
                "gold.fact_trip_delay_snapshot",
                "silver.rt_trip_updates",
                "silver.rt_entities",
                "silver.rt_feed_snapshots",
                "raw.realtime_snapshot_index",
                "raw.ingestion_objects",
                "raw.ingestion_runs",
                "core.feed_endpoints",
                "core.providers",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE provider_id = :provider"),
                    {"provider": PROVIDER},
                )


@pytest.mark.parametrize(
    "damage",
    [
        "UPDATE silver.rt_feed_snapshots SET manifest_json = NULL",
        "UPDATE silver.rt_feed_snapshots SET checksum_sha256 = repeat('b',64)",
        "UPDATE raw.realtime_snapshot_index SET entity_count = entity_count + 1",
        "UPDATE silver.rt_entities SET entity_kind = 'unknown'",
        "DELETE FROM silver.rt_trip_updates",
        "DELETE FROM gold.fact_trip_delay_snapshot",
        "UPDATE raw.ingestion_objects SET byte_size = NULL",
    ],
)
def test_incomplete_capture_evidence_cannot_authorize_replacement(conn, damage):
    add_capture(conn, PERIOD + timedelta(seconds=5))
    assert delay_period_is_complete(conn, PROVIDER, PERIOD)
    conn.execute(text(f"{damage} WHERE provider_id = :provider"), {"provider": PROVIDER})
    assert not delay_period_is_complete(conn, PROVIDER, PERIOD)


def test_matching_invalid_checksums_do_not_establish_capture_identity(conn):
    add_capture(conn, PERIOD + timedelta(seconds=5))
    for table in ("raw.ingestion_objects", "silver.rt_feed_snapshots"):
        conn.execute(
            text(f"UPDATE {table} SET checksum_sha256 = '' WHERE provider_id = :provider"),
            {"provider": PROVIDER},
        )
    assert not delay_period_is_complete(conn, PROVIDER, PERIOD)


def test_cross_provider_raw_provenance_does_not_establish_a_complete_cohort(conn, seed_provider):
    add_capture(conn, PERIOD + timedelta(seconds=5))
    other = PROVIDER + "_other"
    seed_provider(conn, other, display_name="Other capture owner")
    conn.execute(
        text("UPDATE raw.ingestion_objects SET provider_id = :other WHERE provider_id = :provider"),
        {"provider": PROVIDER, "other": other},
    )
    assert not delay_period_is_complete(conn, PROVIDER, PERIOD)


def test_premature_period_repair_previews_then_updates_parent_and_stops(conn):
    add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    engine = TransactionEngine(conn)
    assert refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1)) == 1
    add_capture(conn, PERIOD + timedelta(minutes=4), delay=120)
    for table in ("gold.trip_delay_summary_5m", "gold.warm_rollup_periods"):
        conn.execute(
            text(f"UPDATE {table} SET built_at_utc = :built WHERE provider_id = :provider"),
            {"provider": PROVIDER, "built": PERIOD + timedelta(minutes=3)},
        )
    params = dict(
        provider_id=PROVIDER,
        since_utc=PERIOD,
        until_utc=PERIOD + timedelta(minutes=5),
        now=PERIOD + timedelta(hours=1),
        repair_premature=True,
    )
    preview = delay_periods.PeriodBuildProgress()
    assert delay_periods.build_delay_periods(engine, **params, progress=preview, dry_run=True) == 1
    assert preview.committed_rows == 0
    assert summaries(conn) == [(PERIOD, "51", 1, 60)]
    assert delay_periods.build_delay_periods(engine, **params, progress=preview) == 1
    assert summaries(conn) == [(PERIOD, "51", 2, 180)]
    assert refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1)) == 1
    assert (
        conn.execute(
            text(
                "SELECT avg_delay_seconds FROM gold.public_route_reliability_daily "
                "WHERE provider_id=:p"
            ),
            {"p": PROVIDER},
        ).scalar_one()
        == 90
    )
    assert (
        delay_periods.build_delay_periods(
            engine, **params, progress=delay_periods.PeriodBuildProgress()
        )
        == 0
    )
    assert refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1)) == 0


def test_changed_hour_refresh_recovers_children_outside_the_reporting_window(conn):
    older_period = PERIOD - timedelta(days=11)
    add_capture(conn, older_period + timedelta(seconds=5), delay=120)
    assert build(conn, PERIOD + timedelta(minutes=5)) == 1
    assert (
        refresh_changed_delay_hours(
            TransactionEngine(conn), PROVIDER, PERIOD - timedelta(days=13), PERIOD
        )
        == 1
    )
    assert (
        conn.execute(
            text(
                "SELECT avg_delay_seconds FROM gold.public_route_reliability_daily "
                "WHERE provider_id=:p"
            ),
            {"p": PROVIDER},
        ).scalar_one()
        == 120
    )


def test_empty_hour_repair_survives_parent_failure_and_repeated_invalidation(conn):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    build(conn, PERIOD + timedelta(minutes=5))
    engine = TransactionEngine(conn)
    refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    for table in ("gold.fact_trip_delay_snapshot", "silver.rt_trip_updates"):
        conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": PROVIDER})
    conn.execute(
        text("UPDATE silver.rt_entities SET entity_kind='unknown' WHERE provider_id=:p"),
        {"p": PROVIDER},
    )
    assert build(conn, PERIOD + timedelta(minutes=10)) == 1
    assert summaries(conn) == []

    def fail_parent(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO gold.route_delay_hourly" in statement:
            raise RuntimeError("hourly repair interrupted")

    event.listen(conn, "before_cursor_execute", fail_parent)
    try:
        with pytest.raises(RuntimeError, match="hourly repair interrupted"):
            refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1))
    finally:
        event.remove(conn, "before_cursor_execute", fail_parent)
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    assert build(conn, PERIOD + timedelta(minutes=15)) == 1
    assert refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1)) == 1
    assert (
        conn.execute(
            text("SELECT count(*) FROM gold.route_delay_hourly WHERE provider_id=:p"),
            {"p": PROVIDER},
        ).scalar_one()
        == 0
    )
    assert refresh_changed_delay_hours(engine, PROVIDER, PERIOD, PERIOD + timedelta(hours=1)) == 0


def test_pending_empty_bin_with_missing_gold_cannot_be_finalized(conn):
    snapshot_id = add_capture(conn, PERIOD + timedelta(seconds=5))
    delay_periods.invalidate_delay_snapshot(conn, PROVIDER, snapshot_id)
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"), {"p": PROVIDER}
    )
    with pytest.raises(ValueError, match="capture evidence is incomplete"):
        build(conn, PERIOD + timedelta(minutes=5))
    assert summaries(conn) == []
    assert conn.execute(
        text(
            "SELECT invalidated_at_utc IS NOT NULL FROM gold.warm_rollup_periods "
            "WHERE provider_id=:p"
        ),
        {"p": PROVIDER},
    ).scalar_one()
