from datetime import UTC, date, datetime, timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from _sqlfakes import NamedQueryConn
from snapshot_storage_fixtures import MemorySnapshotStore
from test_partitioned_history_publish import _network_history_plan, _patch_minimal_historic
from test_snapshots_publish_parallel import _FakeEngine, _historic_dispatch_conn, _StaticResult

from transit_ops.snapshots import gate, publish, uploads
from transit_ops.snapshots import historic_run as historic
from transit_ops.snapshots.builders.historic.history_common import (
    HistorySourceScopes,
    history_partition_ref,
)
from transit_ops.snapshots.builders.historic.stop_history import (
    build_stop_history_plan,
    build_stop_history_plan_from_rows,
)
from transit_ops.snapshots.historic_streams import HistoricPlans, consume_history_children
from transit_ops.sql_registry import query_name


@pytest.fixture
def history():
    plan = build_stop_history_plan_from_rows(
        delay_rows=[
            {
                "stop_id": "S1",
                "local_date": "2026-07-01",
                "observation_count": 1,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": "2026-07-02T00:00:00Z",
            }
        ],
        percentile_rows=[],
        occupancy_rows=[],
        generated_utc="2026-08-11T00:00:00Z",
    )
    ref, partition = next(plan.iter_partition_items())
    run = historic._HistoricPublishRun(
        historic._HistoricPhaseLedger(),
        SimpleNamespace(
            GOLD_REPORTING_OPEN_WINDOW_DAYS=10,
            GOLD_FACT_RETENTION_DAYS=14,
            GOLD_WARM_ROLLUP_RETENTION_DAYS=730,
        ),
        "2026-08-11T00:00:00Z",
        False,
        32,
        today_local=date(2026, 8, 10),
        run_instant_utc=datetime(2026, 8, 11, tzinfo=UTC),
    )
    run.plans = {
        "network": SimpleNamespace(source_scopes=HistorySourceScopes(("",), "stm", "network")),
        "lines": SimpleNamespace(source_scopes=HistorySourceScopes((), "stm", "lines")),
        "stops": plan,
    }
    return run, plan, ref, partition


def test_phantom_scope_is_fatal(history):
    run, plan, ref, partition = history
    historic._observe_historic_partition(run, "stops", ref, partition, 0)
    plan.source_scopes.scopes.clear()
    with pytest.raises(historic.HistoricPartitionError, match="lack same-pass"):
        historic._finalize_historic_run(run)


def test_duplicate_emitted_month_is_fatal(history):
    run, _plan, ref, partition = history
    for _ in range(2):
        historic._observe_historic_partition(run, "stops", ref, partition, 0)
    with pytest.raises(historic.HistoricPartitionError, match="emitted duplicate"):
        historic._finalize_historic_run(run)


def test_duplicate_source_scope_is_fatal(history):
    run, plan, _ref, _partition = history
    plan.source_scopes.scopes *= 2
    with pytest.raises(historic.HistoricPartitionError, match="source contains duplicate"):
        historic._finalize_historic_run(run)


def test_duplicate_source_load_is_fatal():
    scopes = HistorySourceScopes(("S1",), "stm", "stops")
    rows = [{"stop_id": "S1", "local_date": "2026-07-01"}]
    scopes.observe_rows(rows, source=0, entity_field="stop_id")
    with pytest.raises(historic.HistoricPartitionError, match="duplicate source"):
        scopes.observe_rows(rows, source=0, entity_field="stop_id")


def test_out_of_month_day_is_fatal_with_force(history):
    run, _plan, ref, partition = history
    day = partition.days[0].model_copy(update={"date": "2026-06-30"})
    malformed = partition.model_copy(update={"days": [day]})
    plans = HistoricPlans(
        stops=SimpleNamespace(
            iter_partition_items=lambda: iter([(ref, malformed)]),
        )
    )
    with pytest.raises(historic.HistoricPartitionError, match="escape its month"):
        consume_history_children(
            plans, gate.new_report("stm", "historic", run.stamp), batch_size=1, force=True, run=run
        )


def test_ref_coverage_mismatch_is_fatal_with_force(history):
    run, _plan, ref, partition = history
    malformed = ref.model_copy(update={"coverage_end": "2026-07-02"})
    plans = HistoricPlans(
        stops=SimpleNamespace(
            iter_partition_items=lambda: iter([(malformed, partition)]),
        )
    )
    with pytest.raises(historic.HistoricPartitionError, match="does not match"):
        consume_history_children(
            plans, gate.new_report("stm", "historic", run.stamp), batch_size=1, force=True, run=run
        )


def test_artifact_path_entity_mismatch_is_fatal(history):
    run, _plan, ref, partition = history
    malformed = ref.model_copy(
        update={
            "path": "historic/history/stops/wrong/generations/x/2026-07.json",
        }
    )
    with pytest.raises(historic.HistoricPartitionError, match="entity path mismatch"):
        historic._observe_historic_partition(run, "stops", malformed, partition, 0)


def test_inventory_count_mismatch_is_fatal(history):
    run, plan, ref, partition = history
    historic._observe_historic_partition(run, "stops", ref, partition, 0)
    plan.source_scopes.entity_ids = ()
    with pytest.raises(historic.HistoricPartitionError, match="inventory cardinality"):
        historic._finalize_historic_run(run)


def test_source_only_scope_is_allowed_and_counted(history):
    run, plan, ref, partition = history
    plan.source_scopes.scopes.append(("S1", "2025-01"))
    historic._observe_historic_partition(run, "stops", ref, partition, 0)
    historic._finalize_historic_run(run)
    assert run.telemetry_fields(timing_complete=True)["source_only_scope_count"]["stops"] == 1


def test_scope_class_uses_provider_local_today_instead_of_utc_stamp(history):
    run, _plan, ref, partition = history
    historic._prepare_historic_run(
        run,
        tuple(run.plans.values()),
        provider_timezone="America/Toronto",
    )
    assert run.today_local == date(2026, 8, 10)
    assert historic._observe_historic_partition(run, "stops", ref, partition, 0) == "mutable_edge"


@pytest.mark.parametrize(
    "update", [{"days": []}, {"days": [7]}, {"month": "invalid"}, {"days": [{"date": "invalid"}]}]
)
def test_malformed_partition_is_fatal(history, update):
    run, _plan, ref, partition = history
    with pytest.raises(historic.HistoricPartitionError):
        historic._observe_historic_partition(
            run,
            "stops",
            ref,
            partition.model_copy(update=update),
            0,
        )


@pytest.fixture
def publisher(monkeypatch):
    store = MemorySnapshotStore()
    root_activation = Mock(wraps=store.activate_stable_json_outcome)
    compatibility_upload = Mock(wraps=uploads.put_stages)
    monkeypatch.setattr(store, "activate_stable_json_outcome", root_activation)
    monkeypatch.setattr(uploads, "put_stages", compatibility_upload)
    return (
        _FakeEngine(_historic_dispatch_conn()),
        SimpleNamespace(
            SNAPSHOT_PUBLISH_CONCURRENCY=1,
        ),
        store,
        root_activation,
        compatibility_upload,
    )


def test_artifact_day_outside_source_bounds_is_fatal_under_force(monkeypatch, publisher):
    plan = _network_history_plan()
    items = list(plan.iter_partition_items())
    ref, partition = items[0]
    source_start, _source_end = plan.source_scopes.bounds[("", partition.month)]
    outside = source_start - timedelta(days=1)
    assert outside.strftime("%Y-%m") == partition.month
    day = partition.days[0].model_copy(update={"date": outside.isoformat()})
    malformed = partition.model_copy(update={"days": [day]})
    updated_ref = history_partition_ref(ref.path, malformed)
    updated_ref = updated_ref.model_copy(
        update={
            "path": (
                f"historic/history/network/generations/{updated_ref.sha256}/{malformed.month}.json"
            ),
        }
    )
    assert gate.check_network_history_partition_ref(updated_ref, malformed) == []
    items[0] = updated_ref, malformed
    bad_plan = SimpleNamespace(
        source_scopes=plan.source_scopes,
        iter_partition_items=lambda: iter(items),
        build_index=plan.build_index,
    )
    _patch_minimal_historic(monkeypatch, network_plan=bad_plan)
    engine, settings, store, root_activation, compatibility_upload = publisher
    with pytest.raises(
        historic.HistoricPartitionError,
        match="^network source dependency coverage must contain artifact coverage$",
    ):
        publish.publish_snapshot(
            "stm", tier="historic", engine=engine, settings=settings, storage=store, force=True
        )
    compatibility_upload.assert_not_called()
    root_activation.assert_not_called()


@pytest.mark.parametrize(
    "truncated_query, expected_error",
    [
        pytest.param(
            "history.stops.ids.inner",
            "history inventory row count mismatch",
            id="truncated-inventory",
        ),
        pytest.param(
            "history.stops.delay.inner",
            "history source scope row count mismatch",
            id="truncated-source-results",
        ),
    ],
)
def test_truncated_history_load_is_fatal_under_force_before_uploads(
    monkeypatch,
    publisher,
    truncated_query,
    expected_error,
):
    _patch_minimal_historic(monkeypatch)
    monkeypatch.setattr(publish.builders, "build_stop_history_plan", build_stop_history_plan)
    engine, settings, store, root_activation, compatibility_upload = publisher
    original_execute = engine._conn.execute
    rows = {
        "history.stops.ids.inner": [{"stop_id": "S1", "__history_inventory_count": 1}],
        "history.stops.delay.inner": [
            {
                "stop_id": "S1",
                "local_date": "2026-07-01",
                "observation_count": 1,
                "severe_count": 0,
                "sum_delay_seconds": 0,
                "source_generated_utc": "2026-07-02T00:00:00Z",
                "__history_scope_count": 1,
            }
        ],
    }
    count_column = (
        "__history_inventory_count"
        if truncated_query.endswith("ids.inner")
        else "__history_scope_count"
    )
    # SQL counted two rows, but the transport returned only the first one.
    rows[truncated_query][0][count_column] = 2

    def execute(statement, params=None):
        name = query_name(statement)
        if name in rows:
            return _StaticResult(rows[name])
        return original_execute(statement, params)

    monkeypatch.setattr(engine._conn, "execute", execute)
    with pytest.raises(historic.HistoricPartitionError, match=f"^{expected_error}$"):
        publish.publish_snapshot(
            "stm",
            tier="historic",
            engine=engine,
            settings=settings,
            storage=store,
            force=True,
        )
    compatibility_upload.assert_not_called()
    root_activation.assert_not_called()


def test_truncated_inventory_is_fatal():
    conn = NamedQueryConn(
        {
            "history.stops.ids.inner": [
                {"stop_id": "S1", "__history_inventory_count": 2},
            ]
        }
    )
    with pytest.raises(historic.HistoricPartitionError, match="inventory row count"):
        build_stop_history_plan(conn, generated_utc="2026-07-02T00:00:00Z")


def test_truncated_scope_load_is_fatal():
    conn = NamedQueryConn(
        {
            "history.stops.ids.inner": [{"stop_id": "S1"}],
            "history.stops.delay.inner": [
                {"stop_id": "S1", "local_date": "2026-07-01", "__history_scope_count": 2},
            ],
        }
    )
    plan = build_stop_history_plan(conn, generated_utc="2026-07-02T00:00:00Z")
    with pytest.raises(historic.HistoricPartitionError, match="scope row count"):
        list(plan.iter_partition_items())


@pytest.mark.parametrize("entity", [None, "", 17])
def test_invalid_inventory_id_is_fatal_before_normalization(entity):
    conn = NamedQueryConn(
        {
            "history.stops.ids.inner": [
                {"stop_id": entity, "__history_inventory_count": 1},
            ]
        }
    )
    with pytest.raises(historic.HistoricPartitionError, match="ID must be nonempty text"):
        build_stop_history_plan(conn, generated_utc="2026-07-02T00:00:00Z")


@pytest.mark.parametrize(
    "generated_utc",
    [
        "2026-07-02T00:00:00+00:00",
        "2026-07-01T20:00:00-04:00",
        "2026-07-02 00:00:00Z",
    ],
    ids=["explicit-utc-offset", "non-utc-offset", "alternate-iso-format"],
)
def test_noncanonical_generated_utc_is_fatal_under_force_before_activation(
    monkeypatch,
    publisher,
    generated_utc,
):
    plan = _network_history_plan()
    items = list(plan.iter_partition_items())
    ref, partition = items[0]
    malformed = partition.model_copy(update={"generated_utc": generated_utc})
    items[0] = history_partition_ref(ref.path, malformed), malformed
    bad_plan = SimpleNamespace(
        source_scopes=plan.source_scopes,
        iter_partition_items=lambda: iter(items),
        build_index=plan.build_index,
    )
    _patch_minimal_historic(monkeypatch, network_plan=bad_plan)
    engine, settings, store, root_activation, compatibility_upload = publisher
    with pytest.raises(historic.HistoricPartitionError, match="canonical UTC"):
        publish.publish_snapshot(
            "stm", tier="historic", engine=engine, settings=settings, storage=store, force=True
        )
    compatibility_upload.assert_not_called()
    root_activation.assert_not_called()
    assert "historic/history/index.json" not in store.objects


@pytest.mark.parametrize("identity", ["provider_id", "family"])
def test_source_identity_mismatch_is_fatal(history, identity):
    run, plan, _ref, _partition = history
    setattr(plan.source_scopes, identity, "wrong")
    with pytest.raises(historic.HistoricPartitionError, match="identity mismatch"):
        historic._finalize_historic_run(run)


@pytest.mark.parametrize(
    "instant, expected_day, expected_bucket",
    [
        (datetime(2026, 8, 15, 17, tzinfo=UTC), date(2026, 8, 15), "settled_candidate"),
        (datetime(2026, 8, 15, 1, tzinfo=UTC), date(2026, 8, 14), "mutable_edge"),
    ],
    ids=["daytime-run", "utc-local-midnight-boundary"],
)
def test_scope_telemetry_captures_actual_run_instant_once(
    monkeypatch,
    instant,
    expected_day,
    expected_bucket,
):
    clock_calls = []

    class Clock:
        @staticmethod
        def now(timezone):
            clock_calls.append(timezone)
            return instant

    monkeypatch.setattr(historic, "datetime", Clock)
    run = historic._HistoricPublishRun(
        historic._HistoricPhaseLedger(),
        SimpleNamespace(),
        "2026-08-15T00:00:00Z",
        False,
        32,
    )
    plan = _network_history_plan()
    historic._prepare_historic_run(run, (plan, None, None), provider_timezone="America/Toronto")
    assert clock_calls == [UTC]
    assert run.run_instant_utc == instant
    assert run.today_local == expected_day
    ref, partition = list(plan.iter_partition_items())[-1]
    assert partition.month == "2026-07"
    assert (
        historic._observe_historic_partition(run, "network", ref, partition, 0) == expected_bucket
    )
    assert clock_calls == [UTC]


@pytest.mark.parametrize("timezone", [None, "invalid/timezone"])
def test_scope_telemetry_fallback_uses_stamp_date_instead_of_actual_instant(timezone):
    run = historic._HistoricPublishRun(
        historic._HistoricPhaseLedger(),
        SimpleNamespace(),
        "2026-08-15T00:00:00Z",
        False,
        32,
        run_instant_utc=datetime(2026, 8, 20, 17, tzinfo=UTC),
    )
    historic._prepare_historic_run(run, (None, None, None), provider_timezone=timezone)
    assert run.today_local == date(2026, 8, 15)
