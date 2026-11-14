from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
import revision_2_seed as seed
from _sqlfakes import NamedQueryConn
from snapshot_storage_fixtures import MemorySnapshotStore

from transit_ops.gold import rollups
from transit_ops.gold.reader import window
from transit_ops.snapshots import builders, historic_run, historic_tier
from transit_ops.snapshots.builders.historic import line_history, network_history, stop_history
from transit_ops.sql_registry import query_name


def test_resolve_as_of_reads_the_connection_clock(real_db_engine):
    with seed.pinned_engine(real_db_engine, seed.HISTORY_CLOCK) as pinned:
        with pinned.connect() as conn:
            assert window.resolve_as_of(conn, None) == seed.HISTORY_CLOCK


def test_naive_stamp_is_refused():
    with pytest.raises(ValueError, match="aware"):
        window.resolve_as_of(None, datetime(2025, 9, 2))


def test_explicit_stamp_needs_no_clock_read():
    assert window.resolve_as_of(None, seed.HISTORY_CLOCK) == seed.HISTORY_CLOCK


@pytest.mark.parametrize("family", ["network", "line", "stop"])
def test_one_plan_binds_one_connection_clock_through_lazy_reads(family):
    class ClockConnection(NamedQueryConn):
        def __init__(self):
            super().__init__(
                {
                    "history.build.as_of": [seed.HISTORY_CLOCK],
                    "history.lines.ids.inner": [{"route_id": "R1"}],
                    "history.stops.ids.inner": [{"stop_id": "S1"}],
                }
            )
            self.reads = []

        def execute(self, statement, params=None):
            self.reads.append((query_name(statement), params))
            return super().execute(statement, params)

    conn = ClockConnection()
    build = getattr(builders, f"build_{family}_history_plan")
    list(
        build(conn, provider_id="test", generated_utc="2025-09-02T00:00:00Z").iter_partition_items()
    )
    assert [name for name, _ in conn.reads if name == "history.build.as_of"] == [
        "history.build.as_of"
    ]
    assert all(params["as_of_utc"] == seed.HISTORY_CLOCK for _, params in conn.reads[1:])


def test_history_plans_follow_the_stamp_not_the_wall_clock(real_db_engine, tmp_path, monkeypatch):
    settings = seed.settings_for(tmp_path)
    monkeypatch.setattr(rollups, "PERCENTILE_LOOKBACK_DAYS", seed.RETENTION_DAYS - 1)
    build_settings = settings.model_copy(
        update={
            "GOLD_FACT_RETENTION_DAYS": 100,
            "GOLD_WARM_ROLLUP_RETENTION_DAYS": 100,
        }
    )
    for module in (network_history, line_history, stop_history):
        monkeypatch.setattr(module, "get_settings", lambda: build_settings)
    seed.delete_rows(real_db_engine)
    try:
        seed.seed_history(real_db_engine, settings, tmp_path)
        with seed.pinned_engine(real_db_engine, seed.HISTORY_CLOCK) as pinned:
            for provider_id in seed.PROVIDERS.values():
                for build in (
                    builders.build_network_history_plan,
                    builders.build_line_history_plan,
                    builders.build_stop_history_plan,
                ):
                    kwargs = dict(provider_id=provider_id, generated_utc="2025-09-02T00:00:00Z")
                    with pinned.connect() as conn:
                        expected = list(build(conn, **kwargs).iter_partition_items())
                    with real_db_engine.connect() as conn:
                        actual = list(
                            build(
                                conn, **kwargs, as_of_utc=seed.HISTORY_CLOCK
                            ).iter_partition_items()
                        )
                    assert expected
                    assert actual == expected
    finally:
        seed.delete_rows(real_db_engine)


@pytest.mark.parametrize("explicit", [False, True])
def test_one_publish_reads_one_instant(monkeypatch, explicit):
    from test_partitioned_history_publish import _patch_minimal_historic

    _patch_minimal_historic(monkeypatch)
    clock = Mock(side_effect=[seed.HISTORY_CLOCK, datetime(2030, 1, 1, tzinfo=UTC)])
    monkeypatch.setattr(historic_tier, "utc_now", clock)
    seen = []
    for name in (
        "build_network_history_plan",
        "build_line_history_plan",
        "build_stop_history_plan",
    ):
        original = getattr(builders, name)

        def record(*args, _build=original, **kwargs):
            seen.append((kwargs.get("as_of_utc"), kwargs["generated_utc"]))
            return _build(*args, **kwargs)

        monkeypatch.setattr(builders, name, record)
    settings = seed.settings_for(None)
    run = historic_run._HistoricPublishRun(
        historic_run._HistoricPhaseLedger(),
        settings,
        "2025-09-02T00:00:00Z",
        False,
        256,
        provider_id="stm",
    )
    kwargs = {"as_of_utc": seed.HISTORY_CLOCK} if explicit else {}
    historic_tier.publish(
        SimpleNamespace(execute=lambda *a, **k: None),
        MemorySnapshotStore(),
        provider_id="stm",
        settings=settings,
        _historic_run=run,
        force=True,
        **kwargs,
    )
    assert seen == [(seed.HISTORY_CLOCK, "2025-09-02T00:00:00Z")] * 3
    assert run.run_instant_utc == seed.HISTORY_CLOCK
    assert clock.call_count == (0 if explicit else 1)
