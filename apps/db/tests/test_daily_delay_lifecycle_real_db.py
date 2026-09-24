"""Daily first builds and explicit repairs preserve dirty evidence."""

from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from threading import Event

import pytest
from sqlalchemy import event, text
from test_capture_day_rollups_real_db import DAY, PROVIDER, TransactionEngine, midnight, seed
from test_capture_day_rollups_real_db import conn as conn
from test_delay_days_real_db import metric, rows, watermark

from transit_ops.gold import delay_days, rollups
from transit_ops.settings import Settings


@pytest.fixture(autouse=True)
def clock(monkeypatch):
    now = midnight(DAY + timedelta(days=2))
    monkeypatch.setattr(rollups, "utc_now", lambda: now)
    monkeypatch.setattr(rollups, "materialization_time", lambda _: now)
    monkeypatch.setattr(rollups, "_PROVIDER_TODAY_LOCAL_SQL", text("SELECT DATE '2026-06-26'"))


def build(engine, *, available_days=None):
    return rollups._build_percentile_days(
        engine,
        provider_id=PROVIDER,
        rollup_kind="route_delay_spine",
        upsert=rollups.UPSERT_ROUTE_DELAY_SPINE,
        floor_key=20260624,
        today_key=20260625,
        now=midnight(DAY + timedelta(days=2)),
        select_missing=rollups.SELECT_MISSING_CAPTURE_DAYS,
        available_days=available_days,
    )


def repair(engine, *, kinds=None):
    return rollups.rebuild_warm_rollups(
        PROVIDER,
        engine=engine,
        settings=Settings.model_construct(),
        from_date=DAY,
        to_date=DAY,
        kinds=kinds or ["route_delay_spine"],
    )


def state(conn):
    return (
        {
            kind: rows(conn, table, PROVIDER)
            for kind, table in delay_days.DAILY_DELAY_TABLES.items()
        },
        rows(conn, "warm_rollup_periods", PROVIDER),
    )


@pytest.mark.parametrize("buffered", [False, True])
def test_ordinary_build_refuses_dirty_empty_day_missing_from_fact_calendar(conn, buffered):
    seed(conn, midnight(DAY), empty=True)
    watermark(conn, provider=PROVIDER, day=DAY, dirty=True)
    before = state(conn)
    with pytest.raises(ValueError, match="dirty day"):
        build(TransactionEngine(conn), available_days=[] if buffered else None)
    assert state(conn) == before


def test_explicit_repair_refuses_unrecorded_empty_day_and_preserves_dirty_history(conn):
    snapshot = seed(conn, midnight(DAY))
    metric(conn, "route_delay_spine", provider=PROVIDER, day=DAY)
    delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
    conn.execute(
        text("DELETE FROM gold.fact_trip_delay_snapshot WHERE provider_id=:p"), {"p": PROVIDER}
    )
    for table in (
        "silver.rt_trip_updates",
        "silver.rt_entities",
        "silver.rt_feed_snapshots",
        "raw.realtime_snapshot_index",
    ):
        conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": PROVIDER})
    before = state(conn)
    with pytest.raises(ValueError, match="complete recorded"):
        repair(TransactionEngine(conn))
    assert state(conn) == before


@pytest.mark.parametrize(
    "damage",
    [
        "DELETE FROM silver.rt_trip_updates",
        "UPDATE silver.rt_feed_snapshots SET manifest_json=NULL",
        "UPDATE raw.ingestion_objects SET checksum_sha256=repeat('b',64)",
        "DELETE FROM gold.fact_trip_delay_snapshot",
    ],
)
def test_incomplete_recorded_cohort_preserves_old_rows_and_dirty_flags(conn, damage):
    snapshot = seed(conn, midnight(DAY))
    metric(conn, "route_delay_spine", provider=PROVIDER, day=DAY)
    delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
    conn.execute(text(f"{damage} WHERE provider_id=:p"), {"p": PROVIDER})
    before = state(conn)
    with pytest.raises(ValueError, match="complete recorded"):
        repair(TransactionEngine(conn))
    assert state(conn) == before


def test_proven_empty_capture_replaces_stale_rows_with_a_clean_empty_marker(conn):
    snapshot = seed(conn, midnight(DAY))
    metric(conn, "route_delay_spine", provider=PROVIDER, day=DAY)
    delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
    for table in ("gold.fact_trip_delay_snapshot", "silver.rt_trip_updates", "silver.rt_entities"):
        conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": PROVIDER})
    conn.execute(
        text("UPDATE raw.realtime_snapshot_index SET entity_count=0 WHERE provider_id=:p"),
        {"p": PROVIDER},
    )
    conn.execute(
        text(
            "UPDATE silver.rt_feed_snapshots "
            "SET manifest_json=jsonb_build_object('entity_count',0) WHERE provider_id=:p"
        ),
        {"p": PROVIDER},
    )

    result = repair(TransactionEngine(conn))

    assert result.rebuilt_day_counts == {"route_delay_spine": 1}
    assert rows(conn, "route_delay_spine", PROVIDER) == []
    assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", DAY) == "clean"
    assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == 0


def test_seven_selected_kinds_share_one_day_lock_and_one_complete_cohort_proof(conn):
    snapshots = [seed(conn, midnight(DAY) + timedelta(minutes=i)) for i in range(25)]
    for kind in delay_days.DAILY_DELAY_TABLES:
        metric(conn, kind, provider=PROVIDER, day=DAY)
    delay_days.invalidate_delay_days(conn, PROVIDER, snapshots)
    conn.execute(
        text("UPDATE gold.fact_trip_delay_snapshot SET delay_seconds=240 WHERE provider_id=:p"),
        {"p": PROVIDER},
    )
    calls = []

    def observe(connection, cursor, statement, parameters, context, executemany):
        calls.append(statement)

    event.listen(conn, "before_cursor_execute", observe)
    try:
        result = repair(TransactionEngine(conn), kinds=list(delay_days.DAILY_DELAY_TABLES))
    finally:
        event.remove(conn, "before_cursor_execute", observe)
    assert sum("q:rollup.trip_delay.complete_window\n" in sql for sql in calls) == 1
    assert sum("q:rollup.delay_day.lock\n" in sql for sql in calls) == 1
    assert result.rebuilt_day_counts == dict.fromkeys(delay_days.DAILY_DELAY_TABLES, 1)
    assert rows(conn, "route_delay_spine", PROVIDER)[0]["sum_delay_seconds"] == 25 * 240
    assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == 0


@pytest.mark.parametrize("failure_stage", ["second_kind", "watermark"])
def test_failed_multikind_repair_preserves_all_old_rows_and_flags(conn, failure_stage):
    snapshot = seed(conn, midnight(DAY))
    selected = ["route_delay_spine", "stop_delay_spine"]
    for kind in selected:
        metric(conn, kind, provider=PROVIDER, day=DAY)
    delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
    before = state(conn)
    failure = RuntimeError("daily replacement interrupted")

    def interrupt(connection, cursor, statement, parameters, context, executemany):
        needle = (
            "INSERT INTO gold.stop_delay_spine"
            if failure_stage == "second_kind"
            else "q:rollup.warm_period.upsert\n"
        )
        if needle in statement:
            raise failure

    event.listen(conn, "before_cursor_execute", interrupt)
    try:
        with pytest.raises(RuntimeError, match="daily replacement interrupted") as raised:
            repair(TransactionEngine(conn), kinds=selected)
    finally:
        event.remove(conn, "before_cursor_execute", interrupt)
    assert raised.value is failure
    assert state(conn) == before


@pytest.mark.parametrize("explicit", [False, True])
def test_expiry_during_projection_rolls_back_metric_marker_and_coordination(
    conn, monkeypatch, explicit
):
    snapshot = seed(conn, midnight(DAY))
    if explicit:
        metric(conn, "route_delay_spine", provider=PROVIDER, day=DAY)
        delay_days.invalidate_delay_days(conn, PROVIDER, [snapshot])
    before_state = state(conn)
    before = midnight(DAY) + timedelta(days=14) - timedelta(seconds=1)
    after = before + timedelta(seconds=2)
    current = [before]
    monkeypatch.setattr(rollups, "utc_now", lambda: before)
    monkeypatch.setattr(rollups, "materialization_time", lambda _: current[0])
    monkeypatch.setattr(rollups, "_PROVIDER_TODAY_LOCAL_SQL", text("SELECT DATE '2026-07-07'"))

    def finish_projection(connection, cursor, statement, parameters, context, executemany):
        if "INSERT INTO gold.route_delay_spine" in statement:
            current[0] = after

    event.listen(conn, "after_cursor_execute", finish_projection)
    try:
        with pytest.raises(ValueError, match="partially retained"):
            (repair if explicit else build)(TransactionEngine(conn))
    finally:
        event.remove(conn, "after_cursor_execute", finish_projection)
    assert current[0] == after
    assert state(conn) == before_state


@pytest.fixture
def committed_engine(real_db_engine, seed_provider):
    with real_db_engine.begin() as conn:
        seed_provider(conn, PROVIDER, display_name="Daily lifecycle", timezone="America/Toronto")
        seed(conn, midnight(DAY))
    try:
        yield real_db_engine
    finally:
        with real_db_engine.begin() as conn:
            for table in (
                *(f"gold.{table}" for table in delay_days.DAILY_DELAY_TABLES.values()),
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
                conn.execute(text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": PROVIDER})


@pytest.mark.parametrize("dirty", [False, True])
def test_concurrent_first_build_rechecks_marker_after_day_lock(committed_engine, dirty):
    waiting = Event()
    projections = []

    def observe(connection, cursor, statement, parameters, context, executemany):
        if "q:rollup.delay_day.lock\n" in statement:
            waiting.set()
        if "INSERT INTO gold.route_delay_spine" in statement:
            projections.append(statement)

    with ThreadPoolExecutor(max_workers=1) as pool:
        with committed_engine.begin() as winner:
            delay_days.lock_delay_day(winner, PROVIDER, DAY)
            event.listen(committed_engine, "before_cursor_execute", observe)
            future = pool.submit(build, committed_engine)
            assert waiting.wait(5)
            metric(winner, "route_delay_spine", provider=PROVIDER, day=DAY)
            if dirty:
                watermark(winner, provider=PROVIDER, day=DAY, dirty=True)
        try:
            if dirty:
                with pytest.raises(ValueError, match="dirty day"):
                    future.result(timeout=5)
            else:
                assert future.result(timeout=5) == 0
        finally:
            event.remove(committed_engine, "before_cursor_execute", observe)
    assert len(projections) == 1
    with committed_engine.connect() as conn:
        assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", DAY) == (
            "dirty" if dirty else "clean"
        )


@pytest.mark.parametrize("day,hours", [(date(2026, 3, 8), 23), (date(2026, 11, 1), 25)])
def test_repair_proves_exact_local_day_across_dst_without_using_neighbor_evidence(
    conn, monkeypatch, day, hours
):
    start, end = midnight(day), midnight(day + timedelta(days=1))
    for hour in range(hours):
        seed(conn, start + timedelta(hours=hour))
    neighbors = [seed(conn, start - timedelta(seconds=1)), seed(conn, end)]
    conn.execute(
        text(
            "UPDATE silver.rt_feed_snapshots SET manifest_json=NULL "
            "WHERE source_realtime_snapshot_id = ANY(CAST(:ids AS bigint[]))"
        ),
        {"ids": neighbors},
    )
    now = midnight(day + timedelta(days=2))
    monkeypatch.setattr(rollups, "utc_now", lambda: now)
    monkeypatch.setattr(rollups, "materialization_time", lambda _: now)
    monkeypatch.setattr(
        rollups,
        "_PROVIDER_TODAY_LOCAL_SQL",
        text(f"SELECT DATE '{(day + timedelta(days=2)).isoformat()}'"),
    )

    result = rollups.rebuild_warm_rollups(
        PROVIDER,
        engine=TransactionEngine(conn),
        settings=Settings.model_construct(),
        from_date=day,
        to_date=day,
        kinds=["route_delay_spine"],
    )

    assert result.rebuilt_day_counts == {"route_delay_spine": 1}
    assert (
        sum(row["observation_count"] for row in rows(conn, "route_delay_spine", PROVIDER)) == hours
    )


def test_ordinary_build_reports_dirty_history_outside_lookback_without_rewriting_it(conn):
    seed(conn, midnight(DAY))
    old_day = DAY - timedelta(days=20)
    watermark(conn, provider=PROVIDER, day=old_day, dirty=True)
    result = rollups.build_warm_rollups(
        PROVIDER,
        engine=TransactionEngine(conn),
        settings=Settings.model_construct(),
        since_utc=midnight(DAY + timedelta(days=2)),
    )
    assert result.built_route_delay_spine_days == 1
    assert result.daily_delay_state == {
        "provider_id": PROVIDER,
        "dirty_day_count": 1,
        "dirty_days": [{"date": old_day.isoformat(), "kinds": ["route_delay_spine"]}],
    }
    assert result.display_dict()["daily_delay_state"] == result.daily_delay_state
    assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", old_day) == "dirty"


@pytest.mark.parametrize("buffered", [False, True])
def test_source_deleted_after_calendar_selection_skips_first_build_without_empty_marker(
    committed_engine, buffered
):
    calendar_selected, deletion_committed = Event(), Event()
    available = None
    if buffered:
        with committed_engine.begin() as conn:
            available = conn.execute(
                rollups.SELECT_AVAILABLE_CAPTURE_DAYS,
                {"provider_id": PROVIDER, "floor_key": 20260624, "today_key": 20260625},
            ).all()
        assert len(available) == 1
    paused_query = "q:rollup.daily.built_days\n" if buffered else "q:rollup.capture.missing_days\n"
    calls = []

    def pause_after_calendar(connection, cursor, statement, parameters, context, executemany):
        calls.append(statement)
        if paused_query in statement:
            if not buffered:
                assert cursor.rowcount == 1
            calendar_selected.set()
            assert deletion_committed.wait(5)

    event.listen(committed_engine, "after_cursor_execute", pause_after_calendar)
    try:
        with ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(build, committed_engine, available_days=available)
            try:
                assert calendar_selected.wait(5)
                with committed_engine.begin() as reset:
                    for table in (
                        "gold.fact_trip_delay_snapshot",
                        "silver.rt_trip_updates",
                        "silver.rt_entities",
                        "silver.rt_feed_snapshots",
                        "raw.realtime_snapshot_index",
                        "raw.ingestion_objects",
                        "raw.ingestion_runs",
                    ):
                        reset.execute(
                            text(f"DELETE FROM {table} WHERE provider_id=:p"), {"p": PROVIDER}
                        )
            finally:
                deletion_committed.set()
            assert future.result(timeout=5) == 0
    finally:
        event.remove(committed_engine, "after_cursor_execute", pause_after_calendar)

    assert not any("INSERT INTO gold.route_delay_spine" in sql for sql in calls)
    with committed_engine.connect() as conn:
        assert rows(conn, "route_delay_spine", PROVIDER) == []
        assert delay_days.delay_day_state(conn, PROVIDER, "route_delay_spine", DAY) == "missing"
        assert [row["rollup_kind"] for row in rows(conn, "warm_rollup_periods", PROVIDER)] == [
            delay_days.DAY_COORDINATION_KIND
        ]
        assert delay_days.daily_delay_status(conn, PROVIDER)["dirty_day_count"] == 0


@pytest.mark.parametrize("delay", [60, None, 4000])
def test_retained_source_still_completes_each_kind_even_when_every_delay_is_ineligible(conn, delay):
    seed(conn, midnight(DAY), delay=delay)
    for kind, table in delay_days.DAILY_DELAY_TABLES.items():
        spec = rollups.REBUILDABLE_KINDS[kind]
        built = rollups._build_percentile_days(
            TransactionEngine(conn),
            provider_id=PROVIDER,
            rollup_kind=kind,
            upsert=spec.upsert,
            floor_key=20260624,
            today_key=20260625,
            now=midnight(DAY + timedelta(days=2)),
            select_missing=spec.select_missing,
        )
        assert built == 1
        assert delay_days.delay_day_state(conn, PROVIDER, kind, DAY) == "clean"
        # Route spine retains the total-observation denominator; the other six
        # builders can legitimately reduce a present but unusable population to zero.
        assert bool(rows(conn, table, PROVIDER)) == (delay == 60 or kind == "route_delay_spine")
