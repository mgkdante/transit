from datetime import UTC, date, datetime, timedelta

import pytest
import revision_2_seed as seed
from sqlalchemy import event, text
from test_warm_rollups import FakeConnection, FakeEngine, ScalarResult

from transit_ops.gold import rollups
from transit_ops.sql_registry import query_name

TABLES = ("route_headway_by_shift", "route_headway_by_direction_shift", "repeat_offender")


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
