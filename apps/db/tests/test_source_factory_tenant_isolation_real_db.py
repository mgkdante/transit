"""Real-DB guard: a per-provider source-factory reset must not touch other providers.

Phase 1 (multi-provider). ``reset_source_factory_tables(connection, provider_id)``
DELETEs only that provider's rows, walking the reset list child-to-parent and
skipping shared seeds. This proves — against the REAL schema and its foreign
keys — that rebuilding provider A leaves provider B's rows intact, which the
offline fake-connection tests cannot verify (they can't see real FK ordering).

Seeds a shallow but FK-complete chain for two providers:
    core.providers -> core.feed_endpoints -> raw.ingestion_runs -> raw.ingestion_objects
``ingestion_objects`` (child) is deleted before ``ingestion_runs`` (parent) in the
reset order, so a passing run also confirms the child->parent walk is correct.

Runs ONLY with TRANSIT_TEST_DATABASE_URL pointing at a disposable Postgres at
head; CI/local-only, never production. Basic isolation cases roll back their
transaction. The serving-lifecycle case commits reset and initialization separately,
then removes only its two fixture providers.
"""

from __future__ import annotations

from collections.abc import Iterator
from datetime import UTC, datetime

import pytest
from sqlalchemy import Connection, text
from test_delay_days_real_db import DAY, capture, metric, rows, watermark

from transit_ops.gold import delay_days, rollups
from transit_ops.gold.realtime import initialize_realtime_serving
from transit_ops.settings import Settings
from transit_ops.source_factory.catalog import reset_source_factory_tables

PROVIDER_A = "mpp_iso_a"
PROVIDER_B = "mpp_iso_b"


def _seed_source_chain(connection: Connection, provider_id: str) -> None:
    feed_endpoint_id = connection.execute(
        text(
            "INSERT INTO core.feed_endpoints "
            "(provider_id, endpoint_key, feed_kind, source_format) "
            "VALUES (:pid, 'static_schedule', 'static_schedule', 'gtfs_schedule_zip') "
            "RETURNING feed_endpoint_id"
        ),
        {"pid": provider_id},
    ).scalar_one()
    ingestion_run_id = connection.execute(
        text(
            "INSERT INTO raw.ingestion_runs "
            "(provider_id, feed_endpoint_id, run_kind, status) "
            "VALUES (:pid, :feid, 'static_schedule', 'succeeded') "
            "RETURNING ingestion_run_id"
        ),
        {"pid": provider_id, "feid": feed_endpoint_id},
    ).scalar_one()
    connection.execute(
        text(
            "INSERT INTO raw.ingestion_objects "
            "(ingestion_run_id, provider_id, object_kind, storage_backend, storage_path) "
            "VALUES (:rid, :pid, 'gtfs_schedule_zip', 'local', :path)"
        ),
        {"rid": ingestion_run_id, "pid": provider_id, "path": f"{provider_id}/static/x.zip"},
    )


def _count(connection: Connection, table: str, provider_id: str) -> int:
    return connection.execute(
        text(f"SELECT count(*) FROM {table} WHERE provider_id = :pid"),
        {"pid": provider_id},
    ).scalar_one()


@pytest.fixture()
def conn(real_db_engine, seed_provider) -> Iterator[Connection]:  # noqa: ANN001
    with real_db_engine.connect() as connection:
        transaction = connection.begin()
        seed_provider(connection, PROVIDER_A, display_name=f"Isolation {PROVIDER_A}")
        seed_provider(connection, PROVIDER_B, display_name=f"Isolation {PROVIDER_B}")
        _seed_source_chain(connection, PROVIDER_A)
        _seed_source_chain(connection, PROVIDER_B)
        try:
            yield connection
        finally:
            transaction.rollback()


def test_per_provider_reset_leaves_other_providers_untouched(conn: Connection) -> None:
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == 1
    assert _count(conn, "raw.ingestion_objects", PROVIDER_A) == 1
    assert _count(conn, "raw.ingestion_runs", PROVIDER_B) == 1

    summary = reset_source_factory_tables(conn, PROVIDER_A)

    # provider A's rows are gone (child ingestion_objects before parent runs)...
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == 0
    assert _count(conn, "raw.ingestion_objects", PROVIDER_A) == 0
    # ...provider B is fully intact...
    assert _count(conn, "raw.ingestion_runs", PROVIDER_B) == 1
    assert _count(conn, "raw.ingestion_objects", PROVIDER_B) == 1
    # ...shared core config (not in the reset set) survives for both providers...
    assert _count(conn, "core.providers", PROVIDER_A) == 1
    assert _count(conn, "core.feed_endpoints", PROVIDER_A) == 1
    assert _count(conn, "core.providers", PROVIDER_B) == 1
    # ...and the shared seed table with no provider_id column is skipped, not deleted.
    assert summary["mode"] == "per_provider"
    assert "gold.report_labels" in summary["skipped_tables"]


def test_all_providers_reset_truncates_every_provider(conn: Connection) -> None:
    summary = reset_source_factory_tables(conn, all_providers=True)

    assert summary["mode"] == "all_providers"
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == 0
    assert _count(conn, "raw.ingestion_runs", PROVIDER_B) == 0


def _daily_history(conn, provider):
    return {table: rows(conn, table, provider) for table in delay_days.DAILY_DELAY_TABLES.values()}


def _seed_daily_history(conn, provider):
    capture(conn, provider=provider)
    for index, kind in enumerate(delay_days.DAILY_DELAY_TABLES):
        metric(conn, kind, provider=provider)
        watermark(conn, provider=provider, kind=kind, dirty=index % 2 == 0)
    delay_days.lock_delay_day(conn, provider, DAY)
    watermark(conn, provider=provider, kind="trip_delay_summary_5m")


@pytest.mark.parametrize("all_providers", [False, True])
def test_reset_preserves_surviving_daily_metrics_and_dirty_coordination_state(conn, all_providers):
    for provider in (PROVIDER_A, PROVIDER_B):
        _seed_daily_history(conn, provider)
    histories = {provider: _daily_history(conn, provider) for provider in (PROVIDER_A, PROVIDER_B)}
    before = {provider: rows(conn, "warm_rollup_periods", provider) for provider in histories}

    result = reset_source_factory_tables(conn, PROVIDER_A, all_providers=all_providers)

    assert result["preserved_daily_state_kinds"] == list(delay_days.DAILY_DELAY_STATE_KINDS)
    for provider in histories:
        assert _daily_history(conn, provider) == histories[provider]
        reset = all_providers or provider == PROVIDER_A
        assert rows(conn, "warm_rollup_periods", provider) == [
            row
            for row in before[provider]
            if not reset or row["rollup_kind"] in delay_days.DAILY_DELAY_STATE_KINDS
        ]
        assert _count(conn, "gold.fact_trip_delay_snapshot", provider) == (0 if reset else 1)
    assert delay_days.daily_delay_status(conn, PROVIDER_A)["dirty_day_count"] == 1


def test_reset_does_not_turn_missing_source_into_repaired_daily_history(conn, monkeypatch):
    from test_capture_day_rollups_real_db import TransactionEngine

    _seed_daily_history(conn, PROVIDER_A)
    reset_source_factory_tables(conn, PROVIDER_A)
    before = _daily_history(conn, PROVIDER_A), rows(conn, "warm_rollup_periods", PROVIDER_A)
    now = datetime(2026, 6, 22, 12, tzinfo=UTC)
    monkeypatch.setattr(rollups, "utc_now", lambda: now)
    monkeypatch.setattr(rollups, "materialization_time", lambda _: now)
    monkeypatch.setattr(rollups, "_PROVIDER_TODAY_LOCAL_SQL", text("SELECT DATE '2026-06-22'"))

    with pytest.raises(ValueError, match="complete recorded"):
        rollups.rebuild_warm_rollups(
            PROVIDER_A,
            engine=TransactionEngine(conn),
            settings=Settings.model_construct(),
            from_date=DAY,
            to_date=DAY,
            kinds=["route_percentile_daily"],
        )

    assert (
        _daily_history(conn, PROVIDER_A),
        rows(conn, "warm_rollup_periods", PROVIDER_A),
    ) == before
    assert delay_days.delay_day_state(conn, PROVIDER_A, "route_percentile_daily", DAY) == "dirty"


@pytest.mark.parametrize("all_providers", [False, True])
def test_reset_remains_owned_by_callers_transaction_and_rolls_back(conn, all_providers):
    _seed_daily_history(conn, PROVIDER_A)
    before = _daily_history(conn, PROVIDER_A), rows(conn, "warm_rollup_periods", PROVIDER_A)
    original_sources = _count(conn, "raw.ingestion_runs", PROVIDER_A)
    with pytest.raises(RuntimeError, match="reset interrupted"):
        with conn.begin_nested():
            reset_source_factory_tables(conn, PROVIDER_A, all_providers=all_providers)
            raise RuntimeError("reset interrupted")
    assert _count(conn, "raw.ingestion_runs", PROVIDER_A) == original_sources
    assert _count(conn, "gold.fact_trip_delay_snapshot", PROVIDER_A) == 1
    assert (
        _daily_history(conn, PROVIDER_A),
        rows(conn, "warm_rollup_periods", PROVIDER_A),
    ) == before


def test_provider_reset_reinitializes_only_its_selected_serving_lane(real_db_engine, seed_provider):
    provider_a, provider_b = "mpp_serving_reset_a", "mpp_serving_reset_b"
    old_cutoff = datetime(2000, 1, 1, tzinfo=UTC)

    def serving(provider_id):
        with real_db_engine.connect() as connection:
            return (
                connection.execute(
                    text(
                        "SELECT * FROM gold.realtime_serving_state "
                        "WHERE provider_id=:pid ORDER BY endpoint_key"
                    ),
                    {"pid": provider_id},
                )
                .mappings()
                .all()
            )

    with real_db_engine.begin() as connection:
        for provider_id in (provider_a, provider_b):
            seed_provider(connection, provider_id, display_name="Serving reset isolation")
            _seed_source_chain(connection, provider_id)
            connection.execute(
                text(
                    "INSERT INTO core.feed_endpoints "
                    "(provider_id, endpoint_key, feed_kind, source_format) VALUES "
                    "(:pid, 'trip_updates', 'trip_updates', 'gtfs_rt_trip_updates'), "
                    "(:pid, 'vehicle_positions', 'vehicle_positions', 'gtfs_rt_vehicle_positions')"
                ),
                {"pid": provider_id},
            )
            # Copied identities remain valid marker state after source retention.
            connection.execute(
                text(
                    "INSERT INTO gold.realtime_serving_state "
                    "(provider_id, endpoint_key, realtime_snapshot_id, captured_at_utc, "
                    "initialized_at_utc) VALUES "
                    "(:pid, 'trip_updates', :snapshot, :old, :old), "
                    "(:pid, 'vehicle_positions', NULL, NULL, :old)"
                ),
                {
                    "pid": provider_id,
                    "snapshot": 900001 if provider_id == provider_a else 900002,
                    "old": old_cutoff,
                },
            )
    try:
        other_markers = serving(provider_b)
        assert len(serving(provider_a)) == len(other_markers) == 2
        with real_db_engine.begin() as connection:
            summary = reset_source_factory_tables(connection, provider_a)
        assert summary["deleted_row_counts"]["gold.realtime_serving_state"] == 2
        assert serving(provider_a) == []
        assert serving(provider_b) == other_markers
        with real_db_engine.connect() as connection:
            assert _count(connection, "raw.ingestion_runs", provider_a) == 0
            assert _count(connection, "raw.ingestion_runs", provider_b) == 1
            assert _count(connection, "raw.ingestion_objects", provider_b) == 1
            for provider_id in (provider_a, provider_b):
                assert _count(connection, "core.providers", provider_id) == 1
                assert _count(connection, "core.feed_endpoints", provider_id) == 3
            before_initialize = connection.execute(text("SELECT clock_timestamp()")).scalar_one()

        initialize_realtime_serving(provider_a, ["trip_updates"], engine=real_db_engine)

        with real_db_engine.connect() as connection:
            after_initialize = connection.execute(text("SELECT clock_timestamp()")).scalar_one()
            assert _count(connection, "raw.realtime_snapshot_index", provider_a) == 0
        initialized = serving(provider_a)
        assert len(initialized) == 1
        assert initialized[0]["endpoint_key"] == "trip_updates"
        assert initialized[0]["realtime_snapshot_id"] is None
        assert initialized[0]["captured_at_utc"] is None
        cutoff = initialized[0]["initialized_at_utc"]
        assert old_cutoff < before_initialize <= cutoff <= after_initialize
        initialize_realtime_serving(provider_a, ["trip_updates"], engine=real_db_engine)
        assert serving(provider_a) == initialized
        assert serving(provider_b) == other_markers
    finally:
        with real_db_engine.begin() as connection:
            for provider_id in (provider_a, provider_b):
                reset_source_factory_tables(connection, provider_id)
                connection.execute(
                    text("DELETE FROM core.feed_endpoints WHERE provider_id=:pid"),
                    {"pid": provider_id},
                )
                connection.execute(
                    text("DELETE FROM core.providers WHERE provider_id=:pid"),
                    {"pid": provider_id},
                )
