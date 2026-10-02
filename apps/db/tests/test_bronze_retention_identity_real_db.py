from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event
from time import monotonic, sleep

import pytest
from sqlalchemy import event, text
from test_bronze_prune_real_db import (
    NOW,
    PROVIDER,
    TU_FRESH,
    TU_OLD_A,
    TU_OLD_C,
    FakeBronzeStorage,
    _seed,
    _snapshot_exists,
)
from test_bronze_prune_real_db import conn as conn

from transit_ops.maintenance.bronze import prune_bronze_realtime_objects


def _prune(connection, storage, **kwargs):
    return prune_bronze_realtime_objects(
        connection,
        provider_id=PROVIDER,
        retention_days=30,
        bronze_storage=storage,
        now_utc=NOW,
        **kwargs,
    )


@pytest.mark.parametrize("equal_time", [False, True])
def test_bronze_keeps_capture_time_winner_instead_of_maximum_raw_id(conn, equal_time):
    winner = TU_OLD_C if equal_time else TU_OLD_A
    conn.execute(
        text(
            "UPDATE raw.realtime_snapshot_index SET captured_at_utc=:captured "
            "WHERE realtime_snapshot_id=:snapshot"
        ),
        [
            {"snapshot": TU_OLD_A[2], "captured": NOW - timedelta(days=31)},
            {"snapshot": TU_OLD_C[2], "captured": NOW - timedelta(days=31 if equal_time else 38)},
            {"snapshot": TU_FRESH[2], "captured": NOW - timedelta(days=50)},
        ],
    )
    storage = FakeBronzeStorage()
    _, dry_count, _, _ = _prune(conn, storage, dry_run=True)
    _, actual_count, _, _ = _prune(conn, storage)
    assert actual_count == dry_count == {"realtime": 3}
    assert _snapshot_exists(conn, winner[2])
    assert winner[5] not in storage.deleted
    assert TU_FRESH[5] in storage.deleted


@pytest.mark.parametrize(
    "table",
    [
        "fact_trip_delay_snapshot",
        "fact_vehicle_snapshot",
        "latest_trip_delay_snapshot",
        "latest_vehicle_snapshot",
    ],
)
def test_gold_referenced_archive_is_not_deleted_before_a_foreign_key_rejection(conn, table):
    _pin_gold(conn, table)
    storage = FakeBronzeStorage()
    _, dry_count, _, _ = _prune(conn, storage, dry_run=True)
    assert dry_count == {"realtime": 2}
    _, actual_count, _, _ = _prune(conn, storage)
    assert actual_count == dry_count
    assert TU_OLD_A[5] not in storage.deleted
    assert _snapshot_exists(conn, TU_OLD_A[2])


def test_known_empty_serving_marker_does_not_pin_an_expired_archive(conn):
    conn.execute(
        text(
            "INSERT INTO gold.realtime_serving_state "
            "(provider_id,endpoint_key,realtime_snapshot_id,captured_at_utc) "
            "VALUES (:provider,'trip_updates',:snapshot,:captured)"
        ),
        {"provider": PROVIDER, "snapshot": TU_OLD_A[2], "captured": TU_OLD_A[4]},
    )
    storage = FakeBronzeStorage()
    _prune(conn, storage)
    assert TU_OLD_A[5] in storage.deleted
    assert not _snapshot_exists(conn, TU_OLD_A[2])
    assert (
        conn.execute(
            text(
                "SELECT realtime_snapshot_id FROM gold.realtime_serving_state "
                "WHERE provider_id=:provider AND endpoint_key='trip_updates'"
            ),
            {"provider": PROVIDER},
        ).scalar_one()
        == TU_OLD_A[2]
    )


def _pin_gold(conn, table):
    extra_column = ", stop_time_update_count" if "trip_delay" in table else ""
    extra_value = ", 1" if extra_column else ""
    conn.execute(
        text(
            f"INSERT INTO gold.{table} "
            "(provider_id,realtime_snapshot_id,entity_index,snapshot_date_key,"
            f"snapshot_local_date,feed_timestamp_utc,captured_at_utc{extra_column}) "
            "VALUES (:provider,:snapshot,0,20260101,DATE '2026-01-01',"
            f":captured,:captured{extra_value})"
        ),
        {"provider": PROVIDER, "snapshot": TU_OLD_A[2], "captured": TU_OLD_A[4]},
    )


@pytest.fixture
def committed_source(real_db_engine, seed_provider):
    with real_db_engine.begin() as connection:
        _seed(connection, seed_provider)
    try:
        yield real_db_engine
    finally:
        with real_db_engine.begin() as connection:
            for table in (
                "gold.latest_trip_delay_snapshot",
                "gold.latest_vehicle_snapshot",
                "gold.fact_trip_delay_snapshot",
                "gold.fact_vehicle_snapshot",
                "silver.rt_trip_update_stop_times",
                "silver.rt_trip_updates",
                "silver.rt_vehicle_positions",
                "silver.rt_entities",
                "silver.rt_feed_snapshots",
                "raw.realtime_snapshot_index",
                "raw.ingestion_objects",
                "raw.ingestion_runs",
                "core.feed_endpoints",
                "core.providers",
            ):
                connection.execute(
                    text(f"DELETE FROM {table} WHERE provider_id=:provider"), {"provider": PROVIDER}
                )


@pytest.mark.parametrize("writer", ["silver", "gold"])
def test_pruner_skips_a_snapshot_locked_by_a_cooperating_writer(committed_source, writer):
    storage = FakeBronzeStorage()
    with committed_source.connect() as owner, owner.begin() as transaction:
        if writer == "silver":
            owner.execute(
                text(
                    "SELECT realtime_snapshot_id FROM raw.realtime_snapshot_index "
                    "WHERE realtime_snapshot_id=:snapshot FOR NO KEY UPDATE"
                ),
                {"snapshot": TU_OLD_A[2]},
            )
        else:
            _pin_gold(owner, "fact_trip_delay_snapshot")
        with committed_source.begin() as contender:
            contender.execute(text("SET LOCAL statement_timeout='1s'"))
            _, deleted, _, _ = _prune(contender, storage)
        assert deleted == {"realtime": 2}
        assert TU_OLD_A[5] not in storage.deleted
        transaction.rollback()
    with committed_source.begin() as contender:
        _, retried, _, _ = _prune(contender, storage)
        assert retried == {"realtime": 1}
    assert TU_OLD_A[5] in storage.deleted


@pytest.mark.parametrize("isolation", ["REPEATABLE READ", "SERIALIZABLE", "AUTOCOMMIT"])
def test_archive_prune_refuses_transaction_modes_that_cannot_hold_and_recheck(
    real_db_engine, isolation
):
    storage = FakeBronzeStorage()
    with real_db_engine.connect().execution_options(isolation_level=isolation) as connection:
        with connection.begin(), pytest.raises(ValueError, match="READ COMMITTED"):
            _prune(connection, storage)
    assert storage.deleted == []


def test_archive_prune_requires_an_explicit_transaction(real_db_engine):
    storage = FakeBronzeStorage()
    with real_db_engine.connect() as connection:
        with pytest.raises(ValueError, match="READ COMMITTED"):
            _prune(connection, storage)
    assert storage.deleted == []


def test_fresh_recheck_protects_a_reference_committed_after_selection_snapshot(
    committed_source, monkeypatch
):
    from transit_ops.maintenance import bronze as bronze_module

    gate_key = 71462831
    original = bronze_module.SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS.text
    paused = original.replace(
        "ORDER BY rsi.captured_at_utc ASC",
        f"AND (SELECT true FROM pg_advisory_xact_lock({gate_key})) "
        "ORDER BY rsi.captured_at_utc ASC",
    )
    assert paused != original
    monkeypatch.setattr(bronze_module, "SELECT_ELIGIBLE_BRONZE_REALTIME_OBJECTS", text(paused))
    started = Event()
    backend = []
    locked_ids = []
    storage = FakeBronzeStorage()

    def observe_recheck(connection, cursor, statement, parameters, context, executemany):
        if "locked_snapshot_ids" in statement:
            locked_ids.extend(parameters["locked_snapshot_ids"])

    def prune():
        with committed_source.begin() as connection:
            connection.execute(text("SET LOCAL statement_timeout='3s'"))
            backend.append(connection.execute(text("SELECT pg_backend_pid()")).scalar_one())
            started.set()
            return _prune(connection, storage)

    event.listen(committed_source, "before_cursor_execute", observe_recheck)
    try:
        with committed_source.connect() as gate, ThreadPoolExecutor(max_workers=1) as pool:
            gate.execute(text("SELECT pg_advisory_lock(:key)"), {"key": gate_key})
            pending = pool.submit(prune)
            try:
                assert started.wait(2)
                deadline = monotonic() + 2
                while not gate.execute(
                    text("SELECT pg_backend_pid() = ANY(pg_blocking_pids(:pid))"),
                    {"pid": backend[0]},
                ).scalar_one():
                    assert monotonic() < deadline, "pruner did not reach its selection barrier"
                    sleep(0.005)
                with committed_source.begin() as writer:
                    _pin_gold(writer, "fact_trip_delay_snapshot")
            finally:
                gate.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": gate_key})
            _, deleted, _, _ = pending.result(timeout=4)
    finally:
        event.remove(committed_source, "before_cursor_execute", observe_recheck)

    assert TU_OLD_A[2] in locked_ids
    assert deleted == {"realtime": 2}
    assert TU_OLD_A[5] not in storage.deleted
    with committed_source.connect() as connection:
        assert _snapshot_exists(connection, TU_OLD_A[2])
