from datetime import UTC, date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest
import revision_2_seed as seed
import test_route_headway_real_db_regression as headways
from sqlalchemy import create_mock_engine, event, text
from sqlalchemy.exc import InvalidRequestError
from test_warm_rollups import FakeConnection, FakeEngine, ScalarResult

from transit_ops.gold import rollups
from transit_ops.sql_registry import query_name

TABLES = ("route_headway_by_shift", "route_headway_by_direction_shift", "repeat_offender")
headway_conn = headways.conn


@pytest.mark.parametrize("direction", [False, True])
def test_direct_headway_callers_bind_the_transaction_clock(direction):
    stamp = seed.HISTORY_CLOCK
    upserts = []

    def execute(statement, params=None):
        statement.compile().construct_params(params)
        if query_name(statement) in (
            "rollup.route_headway.upsert",
            "rollup.route_headway_direction.upsert",
        ):
            upserts.append(params)
        return ScalarResult(stamp)

    connection = create_mock_engine("postgresql://", execute)
    build = headways._run_direction_headway_rollup if direction else headways._run_headway_rollup
    build(connection)
    assert upserts and all(p["as_of_utc"] == stamp for p in upserts)


@pytest.mark.parametrize("table", TABLES)
def test_direct_rollup_without_stamp_fails_by_parameter_name(table):
    statement = rollups.REPORTING_AGGREGATE_UPSERTS[table]
    with pytest.raises(InvalidRequestError, match="bind parameter 'as_of_utc'"):
        statement.compile().construct_params(
            {
                "provider_id": "stamp-test",
                "built_at_utc": seed.HISTORY_CLOCK,
                "fact_retention_days": 14,
            }
        )


@pytest.mark.parametrize("table", TABLES[:2])
def test_headway_rows_match_legacy_sql_at_transaction_clock(headway_conn, table):
    stamp = headway_conn.execute(text("SELECT now()")).scalar_one()
    day = stamp.astimezone(headways.LOCAL_TZ).date() - timedelta(days=1)
    while day.weekday() >= 5:
        day -= timedelta(days=1)
    headways._seed_pattern(
        headway_conn,
        seq_start=1000,
        route_id="stamp-parity",
        service_date=day,
        direction_id=0,
        local_times=[(10, 0), (10, 2), (10, 12), (10, 22)],
    )
    params = {
        "provider_id": headways.PROVIDER,
        "built_at_utc": stamp,
        "fact_retention_days": 14,
        "as_of_utc": stamp,
    }
    statement = rollups.REPORTING_AGGREGATE_UPSERTS[table]
    legacy = text(
        str(statement).replace(
            "CAST(:as_of_utc AS timestamptz)\n              - make_interval",
            "now() - make_interval",
        )
    )
    select = text(f"SELECT * FROM gold.{table} WHERE provider_id = :provider_id ORDER BY route_id")
    headway_conn.execute(legacy, params)
    expected = headway_conn.execute(select, params).mappings().all()
    assert expected
    headway_conn.execute(rollups.DELETE_REPORTING_AGGREGATES[table], params)
    headway_conn.execute(statement, params)
    assert headway_conn.execute(select, params).mappings().all() == expected


class ClockConnection(FakeConnection):
    def __init__(self):
        super().__init__()
        self.calls = []

    def execute(self, statement, params=None):
        self.calls.append((query_name(statement), params))
        if query_name(statement) == "rollup.build.as_of":
            self.executed.append(str(statement))
            return ScalarResult(seed.HISTORY_CLOCK)
        return super().execute(statement, params)


def test_default_build_samples_python_clock_after_seed_check(monkeypatch):
    wall = [datetime(2026, 3, 26, 12, 4, 59, tzinfo=UTC)]

    def seeded(*args):
        wall[0] = datetime(2026, 3, 26, 12, 5, 1, tzinfo=UTC)
        return True

    monkeypatch.setattr(rollups, "utc_now", lambda: wall[0])
    monkeypatch.setattr(rollups, "provider_is_seeded", seeded)
    conn = ClockConnection()
    rollups.build_warm_rollups("stamp-test", engine=FakeEngine(conn))
    period = next(p for _, p in conn.calls if p and "closed_before" in p)
    assert period["closed_before"] == datetime(2026, 3, 26, 12, 5, tzinfo=UTC)
    calendar = next(p for _, p in conn.calls if p and "retained_since_utc" in p)
    assert calendar["retained_since_utc"] == wall[0] - timedelta(days=14)


@pytest.mark.parametrize("rebuild", [False, True])
def test_equivalent_stamps_keep_utc_bounds_across_dst(rebuild):
    local = datetime(2026, 3, 9, 12, tzinfo=ZoneInfo("America/Toronto"))
    bounds = []
    for stamp in (local.astimezone(UTC), local):
        conn = ClockConnection()
        kwargs = {"engine": FakeEngine(conn), "as_of_utc": stamp}
        if rebuild:
            rollups.rebuild_warm_rollups(
                "stamp-test",
                from_date=date(2026, 3, 20),
                to_date=date(2026, 3, 21),
                kinds=["route_occupancy_band_daily"],
                **kwargs,
            )
        else:
            rollups.build_warm_rollups("stamp-test", **kwargs)
        bounds.append(
            [
                {k: v.astimezone(UTC) for k, v in p.items() if isinstance(v, datetime)}
                for _, p in conn.calls
                if p
            ]
        )
    assert bounds[0] == bounds[1]


@pytest.mark.parametrize("mode", ["dry_run", "success", "abort"])
def test_rebuild_completion_and_preview_use_wall_clock(monkeypatch, mode):
    wall = datetime(2026, 11, 14, 12, tzinfo=UTC)
    monkeypatch.setattr(rollups, "utc_now", lambda: wall)
    previews = []

    def confirm(plan):
        previews.append(plan.completed_at_utc)
        return mode == "success"

    result = rollups.rebuild_warm_rollups(
        "stamp-test",
        engine=FakeEngine(ClockConnection()),
        from_date=date(2026, 3, 20),
        to_date=date(2026, 3, 21),
        kinds=["route_occupancy_band_daily"],
        dry_run=mode == "dry_run",
        confirm=confirm,
        as_of_utc=datetime(2026, 3, 26, 12, tzinfo=UTC),
    )
    assert previews == ([] if mode == "dry_run" else [wall])
    assert result.completed_at_utc == wall


@pytest.mark.parametrize("rebuild", [False, True])
def test_missing_stamp_reads_the_database_clock_once(rebuild):
    conn = ClockConnection()
    engine = FakeEngine(conn)
    if rebuild:
        rollups.rebuild_warm_rollups(
            "stamp-test",
            engine=engine,
            from_date=date(2026, 3, 20),
            to_date=date(2026, 3, 21),
            dry_run=True,
        )
    else:
        rollups.build_warm_rollups("stamp-test", engine=engine)
    assert [name for name, _ in conn.calls].count("rollup.build.as_of") == 1
    assert conn.calls[2][0] == "rollup.build.as_of"
    today_params = next(p for name, p in conn.calls if name == "rollup.provider.today_local")
    assert today_params["as_of_utc"] == seed.HISTORY_CLOCK


def test_an_explicit_stamp_drives_build_windows(monkeypatch):
    conn = ClockConnection()
    stamp = datetime(2026, 3, 26, 12, tzinfo=UTC)
    period_clocks = []
    monkeypatch.setattr(
        rollups, "build_delay_periods", lambda *a, now, **kw: period_clocks.append(now) or 0
    )
    rollups.build_warm_rollups("stamp-test", engine=FakeEngine(conn), as_of_utc=stamp)
    assert all(name != "rollup.build.as_of" for name, _ in conn.calls)
    assert period_clocks == [stamp]
    built_params = [p for _, p in conn.calls if p and "built_at_utc" in p]
    assert built_params
    assert all(p["built_at_utc"] == stamp for p in built_params)
    calendar = next(p for _, p in conn.calls if p and "retained_since_utc" in p)
    assert calendar["retained_since_utc"] == stamp - timedelta(days=14)


@pytest.fixture
def history(real_db_engine, tmp_path):
    settings = seed.settings_for(tmp_path)
    seed.delete_rows(real_db_engine)
    try:
        seed.seed_history(real_db_engine, settings, tmp_path)
        yield real_db_engine, settings, next(iter(seed.PROVIDERS.values()))
    finally:
        seed.delete_rows(real_db_engine)


def _rows(engine, provider_id):
    with engine.connect() as conn:
        return {
            table: sorted(
                (
                    dict(row)
                    for row in conn.execute(
                        text(
                            f"SELECT to_jsonb(t) - 'built_at_utc' AS body FROM gold.{table} t "
                            "WHERE provider_id = :p"
                        ),
                        {"p": provider_id},
                    ).scalars()
                ),
                key=lambda row: str(sorted(row.items())),
            )
            for table in TABLES
        }


def _clear(engine, provider_id):
    with engine.begin() as conn:
        for table in TABLES:
            conn.execute(
                text(f"DELETE FROM gold.{table} WHERE provider_id = :p"), {"p": provider_id}
            )


def test_explicit_stamp_builds_what_the_pinned_clock_built(history):
    engine, settings, provider_id = history
    with seed.pinned_engine(engine, seed.HISTORY_CLOCK) as pinned:
        rollups.build_warm_rollups(provider_id, engine=pinned, settings=settings)
    expected = _rows(engine, provider_id)
    assert any(expected.values())
    _clear(engine, provider_id)
    rollups.build_warm_rollups(
        provider_id, engine=engine, settings=settings, as_of_utc=seed.HISTORY_CLOCK
    )
    assert _rows(engine, provider_id) == expected


def test_an_explicit_stamp_also_sets_built_at(history):
    engine, settings, provider_id = history
    written = []

    def observe(conn, clause, multiparams, params, options):
        if "built_at_utc" in params:
            written.append(params["built_at_utc"])

    event.listen(engine, "before_execute", observe)
    try:
        rollups.build_warm_rollups(
            provider_id, engine=engine, settings=settings, as_of_utc=seed.HISTORY_CLOCK
        )
    finally:
        event.remove(engine, "before_execute", observe)
    assert written and all(value == seed.HISTORY_CLOCK for value in written)
    with engine.connect() as conn:
        stamps = (
            conn.execute(
                text("SELECT built_at_utc FROM gold.repeat_offender WHERE provider_id = :p"),
                {"p": provider_id},
            )
            .scalars()
            .all()
        )
    assert stamps and all(value == seed.HISTORY_CLOCK for value in stamps)


@pytest.mark.parametrize("rebuild", [False, True])
def test_naive_stamp_is_refused(rebuild):
    stamp = datetime(2025, 9, 2, 7)
    kwargs = {"from_date": stamp.date(), "to_date": stamp.date()} if rebuild else {}
    build = rollups.rebuild_warm_rollups if rebuild else rollups.build_warm_rollups
    with pytest.raises(ValueError, match="as_of_utc.*timezone-aware"):
        build("stamp-test", as_of_utc=stamp, **kwargs)
