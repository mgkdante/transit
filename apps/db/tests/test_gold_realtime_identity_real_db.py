"""Live projection follows exact verified captures, including empty and late cycles."""

from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from importlib import import_module
from threading import Event, current_thread

import pytest
from alembic.migration import MigrationContext
from alembic.operations import Operations
from google.transit import gtfs_realtime_pb2
from realtime_replay_fixtures import (
    PROVIDER,
    SNAPSHOTS,
    _build_trip_update_bytes,
    _seed_provider_and_static,
    _seed_raw_realtime_snapshots,
    _storage_path,
    _StubRegistry,
)
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError, IntegrityError
from test_gold_snapshot_replay_real_db import _change_archive, _gold_state, _prune_silver, _rows

from transit_ops.gold.marts import build_gold_marts
from transit_ops.gold.realtime import (
    initialize_realtime_serving,
    refresh_gold_realtime,
    refresh_gold_snapshots,
)
from transit_ops.silver.realtime_gtfs import load_realtime_to_silver


@pytest.fixture
def capture(engine, settings, bronze_root, seed_provider):
    with engine.begin() as conn:
        _seed_provider_and_static(conn, seed_provider)
    initialize_realtime_serving(PROVIDER, ["trip_updates"], engine=engine)
    base = datetime.now(UTC).replace(microsecond=0) + timedelta(seconds=10)

    def add(index, *, minutes=None, empty=False, historical=False, endpoint="trip_updates"):
        sid, run, obj, old_time, delay = SNAPSHOTS[index]
        captured = (
            old_time
            if historical
            else base + timedelta(minutes=index if minutes is None else minutes)
        )
        snapshot = (sid, run, obj, captured, delay)
        payload = _build_trip_update_bytes(captured_at=captured, delay_seconds=delay)
        (bronze_root / _storage_path(sid)).write_bytes(payload)
        with engine.begin() as conn:
            _seed_raw_realtime_snapshots(conn, (snapshot,))
        if endpoint == "vehicle_positions":
            with engine.begin() as conn:
                endpoint_id = conn.execute(
                    text(
                        "INSERT INTO core.feed_endpoints "
                        "(provider_id, endpoint_key, feed_kind, source_format) "
                        "VALUES (:p, 'vehicle_positions', 'vehicle_positions', "
                        "'gtfs_rt_vehicle_positions') RETURNING feed_endpoint_id"
                    ),
                    {"p": PROVIDER},
                ).scalar_one()
                conn.execute(
                    text(
                        "UPDATE raw.ingestion_runs SET feed_endpoint_id=:endpoint, "
                        "run_kind='vehicle_positions' WHERE ingestion_run_id=:run"
                    ),
                    {"endpoint": endpoint_id, "run": run},
                )
                conn.execute(
                    text(
                        "UPDATE raw.realtime_snapshot_index SET feed_endpoint_id=:endpoint "
                        "WHERE realtime_snapshot_id=:id"
                    ),
                    {"endpoint": endpoint_id, "id": sid},
                )
            initialize_realtime_serving(PROVIDER, [endpoint], engine=engine)
        if empty or endpoint == "vehicle_positions":
            message = gtfs_realtime_pb2.FeedMessage.FromString(payload)
            message.ClearField("entity")
            if not empty:
                entity = message.entity.add()
                entity.id = "vehicle"
                entity.vehicle.vehicle.id = "V_REPLAY"
                entity.vehicle.trip.trip_id = "T_REPLAY"
                entity.vehicle.trip.route_id = "51"
                entity.vehicle.position.latitude = 45.5
                entity.vehicle.position.longitude = -73.6
            _change_archive(engine, bronze_root, snapshot, message.SerializeToString())
        return load_realtime_to_silver(
            PROVIDER,
            endpoint,
            snapshot_id=sid,
            settings=settings,
            registry=_StubRegistry(),
            engine=engine,
        )

    return add


def _live(engine, settings, *receipts, **kwargs):
    return refresh_gold_realtime(
        PROVIDER,
        snapshots=receipts,
        engine=engine,
        settings=settings,
        registry=_StubRegistry(),
        **kwargs,
    )


def _state(engine):
    with engine.connect() as conn:
        return (
            conn.execute(
                text(
                    "SELECT * FROM gold.realtime_serving_state WHERE provider_id=:p "
                    "AND endpoint_key='trip_updates'"
                ),
                {"p": PROVIDER},
            )
            .mappings()
            .one()
        )


def _ids(engine, table):
    return [row["realtime_snapshot_id"] for row in _rows(engine, table)]


def test_projects_explicit_success_without_substituting_newer_silver(capture, engine, settings):
    first, second = capture(0), capture(1)
    result = _live(engine, settings, first)
    assert result.projected_snapshot_ids == (first.realtime_snapshot_id,)
    assert _ids(engine, "fact_trip_delay_snapshot") == [first.realtime_snapshot_id]
    assert _ids(engine, "latest_trip_delay_snapshot") == [first.realtime_snapshot_id]
    assert second.realtime_snapshot_id not in result.projected_snapshot_ids
    _live(engine, settings, second)
    assert set(_ids(engine, "fact_trip_delay_snapshot")) == {
        first.realtime_snapshot_id,
        second.realtime_snapshot_id,
    }


def test_mixed_endpoint_receipts_advance_independently(capture, engine, settings):
    trip = capture(0)
    vehicle = capture(1, endpoint="vehicle_positions")
    result = _live(engine, settings, trip, vehicle)
    assert result.advanced_snapshot_ids == (trip.realtime_snapshot_id, vehicle.realtime_snapshot_id)
    assert _ids(engine, "latest_trip_delay_snapshot") == [trip.realtime_snapshot_id]
    assert _ids(engine, "latest_vehicle_snapshot") == [vehicle.realtime_snapshot_id]
    before = _rows(engine, "latest_vehicle_snapshot")
    _live(engine, settings, trip)
    assert _rows(engine, "latest_vehicle_snapshot") == before


def test_every_endpoint_receipt_is_validated_before_any_projection(capture, engine, settings):
    trip = capture(0)
    vehicle = capture(1, endpoint="vehicle_positions")
    broken = replace(vehicle, row_counts=vehicle.row_counts | {"rt_vehicle_positions": 2})
    before = _gold_state(engine)
    with pytest.raises(ValueError, match="count mismatch"):
        _live(engine, settings, trip, broken)
    assert _gold_state(engine) == before
    with engine.connect() as conn:
        accepted = (
            conn.execute(
                text(
                    "SELECT realtime_snapshot_id FROM gold.realtime_serving_state "
                    "WHERE provider_id=:p"
                ),
                {"p": PROVIDER},
            )
            .scalars()
            .all()
        )
    assert accepted == [None, None]


@pytest.mark.parametrize("order", [(0, 1), (1, 0)])
def test_capture_time_wins_over_inverted_raw_id_order(capture, engine, settings, order):
    receipts = [capture(0, minutes=2), capture(1, minutes=1)]
    for index in order:
        _live(engine, settings, receipts[index])
    assert _state(engine)["realtime_snapshot_id"] == receipts[0].realtime_snapshot_id
    assert _ids(engine, "latest_trip_delay_snapshot") == [receipts[0].realtime_snapshot_id]
    assert len(_rows(engine, "fact_trip_delay_snapshot")) == 2


def test_equal_capture_timestamp_uses_id_tie_break(capture, engine, settings):
    first, second = capture(0, minutes=0), capture(1, minutes=0)
    _live(engine, settings, second)
    result = _live(engine, settings, first)
    assert result.advanced_snapshot_ids == ()
    assert _ids(engine, "latest_trip_delay_snapshot") == [second.realtime_snapshot_id]


def test_known_equal_receipt_repairs_values_without_advancing_identity(capture, engine, settings):
    receipt = capture(0)
    _live(engine, settings, receipt)
    before = dict(_state(engine))
    with engine.begin() as conn:
        for table in ("fact_trip_delay_snapshot", "latest_trip_delay_snapshot"):
            conn.execute(
                text(f"UPDATE gold.{table} SET delay_seconds=999 WHERE provider_id=:p"),
                {"p": PROVIDER},
            )
    result = _live(engine, settings, receipt)
    assert result.advanced_snapshot_ids == ()
    assert dict(_state(engine)) == before
    for table in ("fact_trip_delay_snapshot", "latest_trip_delay_snapshot"):
        assert [row["delay_seconds"] for row in _rows(engine, table)] == [60]


def test_known_empty_survives_late_cycle_and_source_retention(capture, engine, settings):
    first, empty = capture(0), capture(1, empty=True)
    _live(engine, settings, first)
    result = _live(engine, settings, empty)
    assert result.latest_trip_updates_snapshot_id == empty.realtime_snapshot_id
    assert not _rows(engine, "latest_trip_delay_snapshot")
    with engine.begin() as conn:
        _prune_silver(conn, empty.realtime_snapshot_id)
        conn.execute(
            text("DELETE FROM raw.realtime_snapshot_index WHERE realtime_snapshot_id=:id"),
            {"id": empty.realtime_snapshot_id},
        )
        conn.execute(
            text("DELETE FROM raw.ingestion_objects WHERE ingestion_object_id=:id"),
            {"id": empty.source_ingestion_object_id},
        )
        conn.execute(
            text("DELETE FROM raw.ingestion_runs WHERE ingestion_run_id=:id"),
            {"id": empty.source_ingestion_run_id},
        )
    engine.dispose()
    _live(engine, settings, first)
    assert _state(engine)["realtime_snapshot_id"] == empty.realtime_snapshot_id
    assert not _rows(engine, "latest_trip_delay_snapshot")


def test_cutoff_is_fixed_and_archive_bootstrap_is_explicit(capture, engine, settings):
    receipt = capture(0, historical=True)
    before = dict(_state(engine))
    initialize_realtime_serving(PROVIDER, ["trip_updates"], engine=engine)
    assert dict(_state(engine)) == before
    projected = _live(engine, settings, receipt)
    assert projected.projected_snapshot_ids == (receipt.realtime_snapshot_id,)
    assert projected.advanced_snapshot_ids == ()
    assert not _rows(engine, "latest_trip_delay_snapshot")
    assert _state(engine)["realtime_snapshot_id"] is None
    accepted = _live(engine, settings, receipt, bootstrap_from_archive=True)
    assert accepted.bootstrapped_snapshot_ids == (receipt.realtime_snapshot_id,)
    assert _ids(engine, "latest_trip_delay_snapshot") == [receipt.realtime_snapshot_id]
    repeated = _live(engine, settings, receipt, bootstrap_from_archive=True)
    assert repeated.bootstrapped_snapshot_ids == ()
    assert repeated.advanced_snapshot_ids == ()
    assert _ids(engine, "latest_trip_delay_snapshot") == [receipt.realtime_snapshot_id]


def test_archive_bootstrap_rejects_superseded_selection_before_writes(capture, engine, settings):
    first = capture(0, historical=True)
    capture(1, historical=True)
    before = _gold_state(engine)
    with pytest.raises(ValueError, match="no longer the latest"):
        _live(engine, settings, first, bootstrap_from_archive=True)
    assert _gold_state(engine) == before
    assert _state(engine)["realtime_snapshot_id"] is None


def test_archive_flag_preserves_normal_advancement_when_all_lanes_are_known(
    capture, engine, settings
):
    first, second = capture(0), capture(1)
    _live(engine, settings, first)
    newer = _live(engine, settings, second, bootstrap_from_archive=True)
    assert newer.advanced_snapshot_ids == (second.realtime_snapshot_id,)
    assert newer.bootstrapped_snapshot_ids == ()
    older = _live(engine, settings, first, bootstrap_from_archive=True)
    assert older.projected_snapshot_ids == (first.realtime_snapshot_id,)
    assert older.advanced_snapshot_ids == ()
    assert older.bootstrapped_snapshot_ids == ()
    assert _ids(engine, "latest_trip_delay_snapshot") == [second.realtime_snapshot_id]


def test_mixed_known_and_unknown_archive_selection_is_atomic(capture, engine, settings):
    trip = capture(0)
    _live(engine, settings, trip)
    vehicle = capture(1, endpoint="vehicle_positions", historical=True)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE gold.fact_trip_delay_snapshot SET delay_seconds=999 WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
    before = _gold_state(engine)
    with engine.connect() as conn:
        before_states = (
            conn.execute(
                text(
                    "SELECT * FROM gold.realtime_serving_state "
                    "WHERE provider_id=:p ORDER BY endpoint_key"
                ),
                {"p": PROVIDER},
            )
            .mappings()
            .all()
        )
    vehicle_copies = 0

    def fail_after_vehicle_copy(connection, cursor, statement, parameters, context, executemany):
        nonlocal vehicle_copies
        if "INSERT INTO gold.latest_vehicle_snapshot" in statement:
            vehicle_copies += 1
        if "INSERT INTO gold.latest_trip_delay_snapshot" in statement:
            raise RuntimeError("mixed cache copy interrupted")

    event.listen(engine, "before_cursor_execute", fail_after_vehicle_copy)
    try:
        with pytest.raises(RuntimeError, match="mixed cache copy interrupted"):
            _live(engine, settings, trip, vehicle, bootstrap_from_archive=True)
    finally:
        event.remove(engine, "before_cursor_execute", fail_after_vehicle_copy)
    assert vehicle_copies == 1
    assert _gold_state(engine) == before
    with engine.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT * FROM gold.realtime_serving_state "
                    "WHERE provider_id=:p ORDER BY endpoint_key"
                ),
                {"p": PROVIDER},
            )
            .mappings()
            .all()
            == before_states
        )

    result = _live(engine, settings, trip, vehicle, bootstrap_from_archive=True)
    assert result.projected_snapshot_ids == (
        trip.realtime_snapshot_id,
        vehicle.realtime_snapshot_id,
    )
    assert result.advanced_snapshot_ids == (vehicle.realtime_snapshot_id,)
    assert result.bootstrapped_snapshot_ids == (vehicle.realtime_snapshot_id,)
    assert _ids(engine, "latest_trip_delay_snapshot") == [trip.realtime_snapshot_id]
    assert [row["delay_seconds"] for row in _rows(engine, "latest_trip_delay_snapshot")] == [60]
    assert _ids(engine, "latest_vehicle_snapshot") == [vehicle.realtime_snapshot_id]


def test_late_cache_failure_rolls_back_identity_facts_and_invalidation(capture, engine, settings):
    receipt = capture(0)
    before = _gold_state(engine), dict(_state(engine))

    def fail_cache(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO gold.latest_trip_delay_snapshot" in statement:
            raise RuntimeError("cache copy interrupted")

    event.listen(engine, "before_cursor_execute", fail_cache)
    try:
        with pytest.raises(RuntimeError, match="cache copy interrupted"):
            _live(engine, settings, receipt)
    finally:
        event.remove(engine, "before_cursor_execute", fail_cache)
    assert (_gold_state(engine), dict(_state(engine))) == before
    _live(engine, settings, receipt)
    assert _ids(engine, "latest_trip_delay_snapshot") == [receipt.realtime_snapshot_id]


@pytest.mark.parametrize("sqlstate, expected_attempts", [("40001", 3), ("40P01", 3), ("22012", 1)])
def test_only_transaction_retry_states_are_retried_and_the_error_survives(
    capture, engine, settings, sqlstate, expected_attempts
):
    receipt = capture(0)
    failures = []

    def fail_lock(connection, cursor, statement, parameters, context, executemany):
        if "hashtext('gold_marts')" in statement:
            try:
                connection.exec_driver_sql(
                    "DO $$ BEGIN RAISE EXCEPTION 'injected transaction failure' "
                    f"USING ERRCODE = '{sqlstate}'; END $$"
                )
            except DBAPIError as error:
                failures.append(error)
                raise

    event.listen(engine, "before_cursor_execute", fail_lock)
    try:
        with pytest.raises(DBAPIError, match="injected transaction failure") as raised:
            _live(engine, settings, receipt)
    finally:
        event.remove(engine, "before_cursor_execute", fail_lock)
    assert len(failures) == expected_attempts
    assert raised.value is failures[-1]
    assert raised.value.orig.sqlstate == sqlstate
    assert _state(engine)["realtime_snapshot_id"] is None
    assert not _rows(engine, "fact_trip_delay_snapshot")


def test_due_analyze_runs_after_validation_and_before_projection(capture, engine, settings):
    receipt = capture(0)
    calls = []

    def record(connection, cursor, statement, parameters, context, executemany):
        calls.append(statement)

    event.listen(engine, "before_cursor_execute", record)
    try:
        _live(
            engine,
            settings.model_copy(update={"GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS": 0}),
            receipt,
        )
    finally:
        event.remove(engine, "before_cursor_execute", record)
    analyze = next(i for i, sql in enumerate(calls) if "ANALYZE silver.rt_feed_snapshots" in sql)
    fact = next(
        i for i, sql in enumerate(calls) if "INSERT INTO gold.fact_trip_delay_snapshot" in sql
    )
    assert analyze < fact


def test_interleaved_transactions_retry_stale_snapshot_without_rewinding(capture, engine, settings):
    first, second = capture(0), capture(1)
    newer_at_state = Event()
    older_at_lock = Event()
    release_newer = Event()
    older_attempts = 0

    def coordinate(connection, cursor, statement, parameters, context, executemany):
        nonlocal older_attempts
        if (
            current_thread().name.endswith("_0")
            and "UPDATE gold.realtime_serving_state" in statement
        ):
            newer_at_state.set()
            assert release_newer.wait(5), "older call did not reach its lock"
        if current_thread().name.endswith("_1") and "hashtext('gold_marts')" in statement:
            older_attempts += 1
            older_at_lock.set()

    event.listen(engine, "before_cursor_execute", coordinate)
    try:
        with ThreadPoolExecutor(max_workers=2, thread_name_prefix="gold-identity") as pool:
            newer = pool.submit(_live, engine, settings, second)
            try:
                assert newer_at_state.wait(5)
                older = pool.submit(_live, engine, settings, first)
                assert older_at_lock.wait(5)
            finally:
                release_newer.set()
            newer.result(timeout=5)
            result = older.result(timeout=5)
    finally:
        release_newer.set()
        event.remove(engine, "before_cursor_execute", coordinate)
    assert older_attempts == 2
    assert result.advanced_snapshot_ids == ()
    assert len(_rows(engine, "fact_trip_delay_snapshot")) == 2
    assert _ids(engine, "latest_trip_delay_snapshot") == [second.realtime_snapshot_id]


def test_full_build_and_replay_preserve_live_identity(capture, engine, settings):
    first, second = capture(0), capture(1)
    _live(engine, settings, first)
    before = _rows(engine, "latest_trip_delay_snapshot"), dict(_state(engine))
    build_gold_marts(PROVIDER, engine=engine, settings=settings, registry=_StubRegistry())
    refresh_gold_snapshots(
        PROVIDER,
        expected_rows={second.realtime_snapshot_id: second.row_counts},
        engine=engine,
        settings=settings,
        registry=_StubRegistry(),
    )
    assert (_rows(engine, "latest_trip_delay_snapshot"), dict(_state(engine))) == before


def test_cold_full_build_keeps_unknown_empty_lane(capture, engine, settings):
    capture(0)
    build_gold_marts(PROVIDER, engine=engine, settings=settings, registry=_StubRegistry())
    assert len(_rows(engine, "fact_trip_delay_snapshot")) == 1
    assert not _rows(engine, "latest_trip_delay_snapshot")
    assert _state(engine)["realtime_snapshot_id"] is None


def test_receipt_metadata_mismatch_and_missing_state_fail_without_writes(capture, engine, settings):
    receipt = capture(0)
    with pytest.raises(ValueError, match="receipt disagrees"):
        _live(
            engine,
            settings,
            replace(receipt, captured_at_utc=receipt.captured_at_utc + timedelta(seconds=1)),
        )
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM gold.realtime_serving_state WHERE provider_id=:p"), {"p": PROVIDER}
        )
    with pytest.raises(ValueError, match="Initialize serving"):
        _live(engine, settings, receipt)
    assert not _rows(engine, "fact_trip_delay_snapshot")


def test_initializer_reuses_exact_nonempty_cache_but_rejects_mixed_identity(
    capture, engine, settings
):
    first, second = capture(0), capture(1)
    _live(engine, settings, first)
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM gold.realtime_serving_state WHERE provider_id=:p"), {"p": PROVIDER}
        )
    initialize_realtime_serving(PROVIDER, ["trip_updates"], engine=engine)
    assert _state(engine)["realtime_snapshot_id"] == first.realtime_snapshot_id
    refresh_gold_snapshots(
        PROVIDER,
        expected_rows={second.realtime_snapshot_id: second.row_counts},
        engine=engine,
        settings=settings,
        registry=_StubRegistry(),
    )
    with engine.begin() as conn:
        conn.execute(
            text("DELETE FROM gold.realtime_serving_state WHERE provider_id=:p"), {"p": PROVIDER}
        )
        conn.execute(
            text(
                "INSERT INTO gold.latest_trip_delay_snapshot "
                "SELECT * FROM gold.fact_trip_delay_snapshot "
                "WHERE provider_id=:p AND realtime_snapshot_id=:id"
            ),
            {"p": PROVIDER, "id": second.realtime_snapshot_id},
        )
    with pytest.raises(ValueError, match="inconsistent Gold serving cache"):
        initialize_realtime_serving(PROVIDER, ["trip_updates"], engine=engine)


@pytest.mark.parametrize("served", [False, True])
def test_migration_seeds_only_exact_cache_identity(capture, engine, settings, monkeypatch, served):
    first = capture(0)
    capture(1)
    if served:
        _live(engine, settings, first)
    migration = import_module("transit_ops.db.migrations.versions.0089_realtime_serving_state")
    with engine.connect() as conn, conn.begin() as transaction:
        conn.execute(text("DROP TABLE gold.realtime_serving_state"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(conn)))
        migration.upgrade()
        state = (
            conn.execute(
                text("SELECT * FROM gold.realtime_serving_state WHERE provider_id=:p"),
                {"p": PROVIDER},
            )
            .mappings()
            .one()
        )
        assert state["realtime_snapshot_id"] == (first.realtime_snapshot_id if served else None)
        assert state["captured_at_utc"] == (first.captured_at_utc if served else None)
        assert state["initialized_at_utc"] is not None
        with pytest.raises(IntegrityError), conn.begin_nested():
            conn.execute(
                text(
                    "UPDATE gold.realtime_serving_state SET realtime_snapshot_id=NULL, "
                    "captured_at_utc=clock_timestamp() WHERE provider_id=:p"
                ),
                {"p": PROVIDER},
            )
        transaction.rollback()


def test_migration_refuses_mixed_cache_identity(capture, engine, settings, monkeypatch):
    first, second = capture(0), capture(1)
    _live(engine, settings, first)
    refresh_gold_snapshots(
        PROVIDER,
        expected_rows={second.realtime_snapshot_id: second.row_counts},
        engine=engine,
        settings=settings,
        registry=_StubRegistry(),
    )
    migration = import_module("transit_ops.db.migrations.versions.0089_realtime_serving_state")
    with engine.connect() as conn, conn.begin() as transaction:
        conn.execute(
            text(
                "INSERT INTO gold.latest_trip_delay_snapshot "
                "SELECT * FROM gold.fact_trip_delay_snapshot "
                "WHERE provider_id=:p AND realtime_snapshot_id=:id"
            ),
            {"p": PROVIDER, "id": second.realtime_snapshot_id},
        )
        conn.execute(text("DROP TABLE gold.realtime_serving_state"))
        monkeypatch.setattr(migration, "op", Operations(MigrationContext.configure(conn)))
        with pytest.raises(DBAPIError, match="inconsistent Gold serving caches"):
            migration.upgrade()
        transaction.rollback()
