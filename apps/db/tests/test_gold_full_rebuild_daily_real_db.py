"""Full rebuild corrects retained Silver cohorts and preserves frozen history."""

from collections import Counter
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from threading import Event

import pytest
from realtime_replay_fixtures import PROVIDER, _StubRegistry
from realtime_replay_fixtures import bronze_root as bronze_root
from realtime_replay_fixtures import engine as engine
from realtime_replay_fixtures import settings as settings
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError
from test_delay_days_real_db import capture as seed_other_capture
from test_delay_days_real_db import metric, rows, watermark
from test_gold_daily_invalidation_real_db import _build_daily, _correct_archive, _day
from test_gold_daily_invalidation_real_db import clean_daily_rows as clean_daily_rows
from test_gold_realtime_identity_real_db import _live, _state
from test_gold_realtime_identity_real_db import capture as capture
from test_gold_snapshot_replay_real_db import _gold_state, _prune_silver, _rows

from transit_ops.gold import delay_days
from transit_ops.gold.marts import build_gold_marts


def rebuild(engine, settings):
    return build_gold_marts(PROVIDER, settings=settings, registry=_StubRegistry(), engine=engine)


@pytest.mark.parametrize("frozen_dirty", [False, True])
def test_rebuild_dirties_only_retained_silver_ids_old_and_new_days(
    capture, engine, settings, frozen_dirty
):
    expired = capture(0, minutes=-5 * 1440)
    _live(engine, settings, expired, bootstrap_from_archive=True)
    _build_daily(engine, expired)
    selected = capture(1, minutes=-1440)
    _live(engine, settings, selected)
    _build_daily(engine, selected)
    moved_day = _day(selected) - timedelta(days=1)
    with engine.begin() as conn:
        _prune_silver(conn, expired.realtime_snapshot_id)
        conn.execute(
            text(
                "UPDATE gold.fact_trip_delay_snapshot "
                "SET captured_at_utc=captured_at_utc - INTERVAL '1 day', delay_seconds=999 "
                "WHERE provider_id=:p AND realtime_snapshot_id=:id"
            ),
            {"p": PROVIDER, "id": selected.realtime_snapshot_id},
        )
        metric(conn, "route_delay_spine", provider=PROVIDER, day=moved_day)
        watermark(conn, provider=PROVIDER, day=_day(expired), dirty=frozen_dirty)
    before_rows = _rows(engine, "route_delay_spine")
    before_latest = _rows(engine, "latest_trip_delay_snapshot")
    before_serving = dict(_state(engine))
    frozen_markers = [
        row
        for row in _rows(engine, "warm_rollup_periods")
        if row["period_start_utc"].startswith(_day(expired).isoformat())
    ]

    result = rebuild(engine, settings)

    assert result.row_counts["fact_trip_delay_snapshot"] == 1
    facts = _rows(engine, "fact_trip_delay_snapshot")
    assert facts[0]["realtime_snapshot_id"] == selected.realtime_snapshot_id
    assert facts[0]["delay_seconds"] == 180
    assert _rows(engine, "route_delay_spine") == before_rows
    assert _rows(engine, "latest_trip_delay_snapshot") == before_latest
    assert dict(_state(engine)) == before_serving
    assert [
        row
        for row in _rows(engine, "warm_rollup_periods")
        if row["period_start_utc"].startswith(_day(expired).isoformat())
    ] == frozen_markers
    with engine.connect() as conn:
        for day in (moved_day, _day(selected)):
            assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", day) == "dirty"


def test_retained_empty_silver_frame_dirties_removed_facts_and_keeps_live_cache(
    capture, engine, settings, bronze_root
):
    receipt = capture(0)
    _live(engine, settings, receipt)
    _build_daily(engine, receipt)
    _correct_archive(engine, settings, bronze_root, receipt, empty=True)
    latest = _rows(engine, "latest_trip_delay_snapshot")
    serving = dict(_state(engine))

    result = rebuild(engine, settings)

    assert result.row_counts["fact_trip_delay_snapshot"] == 0
    assert _rows(engine, "latest_trip_delay_snapshot") == latest
    assert dict(_state(engine)) == serving
    with engine.connect() as conn:
        assert (
            delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", _day(receipt))
            == "dirty"
        )


def test_failed_full_projection_rolls_back_daily_evidence_dimensions_and_facts(
    capture, engine, settings
):
    receipt = capture(0)
    _live(engine, settings, receipt)
    _build_daily(engine, receipt)
    with engine.begin() as conn:
        conn.execute(
            text("UPDATE gold.fact_trip_delay_snapshot SET delay_seconds=999 WHERE provider_id=:p"),
            {"p": PROVIDER},
        )
    before = _gold_state(engine), _rows(engine, "route_delay_spine"), dict(_state(engine))
    dimensions = ("dim_route", "dim_route_pattern", "dim_stop", "dim_date")
    before_dimensions = {table: _rows(engine, table) for table in dimensions}
    failure = RuntimeError("full projection interrupted")
    calls = 0

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        nonlocal calls
        if "INSERT INTO gold.fact_trip_delay_snapshot" in statement:
            calls += 1
            raise failure

    event.listen(engine, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(RuntimeError, match="full projection interrupted") as raised:
            rebuild(engine, settings)
    finally:
        event.remove(engine, "before_cursor_execute", interrupt)
    assert raised.value is failure
    assert calls == 1
    assert (_gold_state(engine), _rows(engine, "route_delay_spine"), dict(_state(engine))) == before
    assert {table: _rows(engine, table) for table in dimensions} == before_dimensions
    rebuild(engine, settings)
    with engine.connect() as conn:
        assert (
            delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", _day(receipt))
            == "dirty"
        )


def test_full_build_retries_stale_day_snapshot_before_exclusive_fact_locks(
    capture, engine, settings
):
    receipt = capture(0)
    _live(engine, settings, receipt)
    waiting = Event()
    calls = Counter()
    order = []

    def observe(connection, cursor, statement, parameters, context, executemany):
        if "q:mart.rebuild.retained_trip_capture_ids\n" in statement:
            calls["selection"] += 1
        if "q:rollup.delay_day.lock\n" in statement:
            calls["day_lock"] += 1
            order.append("day")
            waiting.set()
        if "q:mart.gold_tables.lock\n" in statement:
            order.append("exclusive")
            calls["exclusive"] += 1

    with ThreadPoolExecutor(max_workers=1) as pool:
        with engine.begin() as builder:
            delay_days.lock_delay_day(builder, PROVIDER, _day(receipt))
            event.listen(engine, "before_cursor_execute", observe)
            future = pool.submit(rebuild, engine, settings)
            assert waiting.wait(5)
            metric(builder, "route_delay_spine", provider=PROVIDER, day=_day(receipt))
        try:
            future.result(timeout=5)
        finally:
            event.remove(engine, "before_cursor_execute", observe)
    assert calls == {"selection": 2, "day_lock": 2, "exclusive": 1}
    assert order == ["day", "day", "exclusive"]
    with engine.connect() as conn:
        assert (
            delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", _day(receipt))
            == "dirty"
        )


@pytest.mark.parametrize("sqlstate,attempts", [("40001", 3), ("40P01", 3), ("22012", 1)])
def test_full_build_retry_filter_preserves_original_error(
    capture, engine, settings, sqlstate, attempts
):
    capture(0)
    failures = []

    def fail(connection, cursor, statement, parameters, context, executemany):
        if "hashtext('gold_marts')" in statement:
            try:
                connection.exec_driver_sql(
                    "DO $$ BEGIN RAISE EXCEPTION 'full build transaction failure' "
                    f"USING ERRCODE='{sqlstate}'; END $$"
                )
            except DBAPIError as error:
                failures.append(error)
                raise

    event.listen(engine, "before_cursor_execute", fail)
    try:
        with pytest.raises(DBAPIError, match="full build transaction failure") as raised:
            rebuild(engine, settings)
    finally:
        event.remove(engine, "before_cursor_execute", fail)
    assert len(failures) == attempts
    assert raised.value is failures[-1]
    assert not _rows(engine, "fact_trip_delay_snapshot")
    assert not _rows(engine, "warm_rollup_periods")


def test_missing_silver_disposal_preserves_all_daily_evidence_and_live_identity(
    capture, engine, settings
):
    receipt = capture(0)
    _live(engine, settings, receipt)
    _build_daily(engine, receipt)
    with engine.begin() as conn:
        _prune_silver(conn, receipt.realtime_snapshot_id)
    before = (
        _rows(engine, "warm_rollup_periods"),
        _rows(engine, "route_delay_spine"),
        _rows(engine, "latest_trip_delay_snapshot"),
        dict(_state(engine)),
    )
    rebuild(engine, settings)
    assert _rows(engine, "fact_trip_delay_snapshot") == []
    assert (
        _rows(engine, "warm_rollup_periods"),
        _rows(engine, "route_delay_spine"),
        _rows(engine, "latest_trip_delay_snapshot"),
        dict(_state(engine)),
    ) == before


def test_full_rebuild_preserves_another_providers_facts_and_daily_state(
    capture, engine, settings, seed_provider
):
    receipt = capture(0)
    other = "gold_full_daily_other"
    with engine.begin() as conn:
        seed_provider(
            conn, other, display_name="Full rebuild isolation", timezone="America/Toronto"
        )
        seed_other_capture(conn, provider=other)
        metric(conn, "route_delay_spine", provider=other)
        watermark(conn, provider=other, dirty=True)
        tables = ("fact_trip_delay_snapshot", "route_delay_spine", "warm_rollup_periods")
        before = {table: rows(conn, table, other) for table in tables}
    try:
        rebuild(engine, settings)
        assert (
            _rows(engine, "fact_trip_delay_snapshot")[0]["realtime_snapshot_id"]
            == receipt.realtime_snapshot_id
        )
        with engine.connect() as conn:
            assert {table: rows(conn, table, other) for table in tables} == before
    finally:
        with engine.begin() as conn:
            for table in (
                "gold.route_delay_spine",
                "gold.warm_rollup_periods",
                "gold.fact_trip_delay_snapshot",
                "raw.realtime_snapshot_index",
                "raw.ingestion_runs",
                "core.feed_endpoints",
                "core.providers",
            ):
                conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": other})
