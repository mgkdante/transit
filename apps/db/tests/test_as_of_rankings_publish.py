from __future__ import annotations

import hashlib
import re
from contextlib import contextmanager
from datetime import date, timedelta
from types import SimpleNamespace

import pytest
from test_partitioned_history_publish import (
    _line_history_plan,
    _network_history_plan,
    _patch_minimal_historic,
    _RecordingStore,
    _stop_history_plan,
)

from transit_ops.snapshots import gate, publish
from transit_ops.snapshots.builders.historic import history_common
from transit_ops.snapshots.contract import (
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricHotspotsDay,
    HistoricRepeatOffenderGrain,
    HistoricRepeatOffendersDay,
    HistorySelectionMode,
    Hotspot,
    HotspotGrain,
    Offender,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

STAMP = "2026-07-13T00:00:00Z"


@pytest.fixture(autouse=True)
def _ignore_historic_gc_mark_clearing(monkeypatch: pytest.MonkeyPatch) -> None:
    """Keep ranking/pointer tests focused on their in-memory publish seam."""

    monkeypatch.setattr(
        publish,
        "_clear_referenced_historic_gc_marks",
        lambda *args, **kwargs: None,
    )


def _hotspots_day(
    local_date: str = "2026-07-01",
    *,
    generated_utc: str = "2026-07-02T05:00:00Z",
) -> HistoricHotspotsDay:
    return HistoricHotspotsDay(
        generated_utc=generated_utc,
        methodology_version="reliability-1",
        publish_generation_id=None,
        date=local_date,
    )


def _repeat_day(
    local_date: str = "2026-07-01",
    *,
    generated_utc: str = "2026-07-02T06:00:00Z",
) -> HistoricRepeatOffendersDay:
    return HistoricRepeatOffendersDay(
        generated_utc=generated_utc,
        methodology_version="reliability-1",
        publish_generation_id=None,
        date=local_date,
    )


class _PointPlan:
    def __init__(self, *days: object) -> None:
        self.days = days

    def iter_days(self):  # noqa: ANN201
        yield from self.days


def _point_index(family: str, *days: object) -> tuple[object, HistoricCollectionIndex]:
    summary = history_common.PointHistorySummary(family)
    for payload in days:
        summary.observe(payload)
    return summary, summary.build_index(fallback_generated_utc=STAMP)


def _patch_points(monkeypatch: pytest.MonkeyPatch, *, hotspots=(), repeat=()) -> None:  # noqa: ANN001
    monkeypatch.setattr(
        publish.builders,
        "build_hotspots_history_plan",
        lambda *args, **kwargs: _PointPlan(*hotspots),
    )
    monkeypatch.setattr(
        publish.builders,
        "build_repeat_offenders_history_plan",
        lambda *args, **kwargs: _PointPlan(*repeat),
    )


def test_point_summary_uses_exact_final_bytes_and_honest_date_coverage() -> None:
    first = _hotspots_day("2026-07-01", generated_utc="2026-07-02T05:00:00Z")
    second = _hotspots_day("2026-07-03", generated_utc="2026-07-04T05:00:00Z")
    summary, index = _point_index("hotspots", first, second)

    assert [ref.coverage_start for ref in summary.refs] == ["2026-07-01", "2026-07-03"]
    assert [ref.coverage_end for ref in summary.refs] == ["2026-07-01", "2026-07-03"]
    assert [ref.count for ref in summary.refs] == [1, 1]
    for ref, payload in zip(summary.refs, (first, second), strict=True):
        raw = snapshot_json_bytes(payload)
        digest = hashlib.sha256(raw).hexdigest()
        assert ref.sha256 == digest
        assert ref.byte_size == len(raw)
        assert ref.path == f"historic/history/hotspots/generations/{digest}/{payload.date}.json"
    assert index.family == "hotspots"
    assert index.selection_mode.value == "date"
    assert index.available_dates == ["2026-07-01", "2026-07-03"]
    assert index.first_available_date == "2026-07-01"
    assert index.last_available_date == "2026-07-03"
    assert [(gap.start_date, gap.end_date) for gap in index.gaps] == [("2026-07-02", "2026-07-02")]
    assert index.generated_utc == "2026-07-04T05:00:00Z"
    assert index.collection_generation_id == history_common.history_index_generation_id(index)


def test_point_summary_keeps_published_empty_day_and_rejects_duplicate_or_wrong_family() -> None:
    empty = _repeat_day()
    summary, index = _point_index("repeat_offenders", empty)

    assert index.available_dates == [empty.date]
    assert len(summary.refs) == 1
    with pytest.raises(ValueError, match="duplicate"):
        summary.observe(empty)
    with pytest.raises(ValueError, match="family"):
        history_common.PointHistorySummary("network")


def test_point_ref_rejects_wrong_methodology_before_addressing() -> None:
    payload = _hotspots_day()
    payload.methodology_version = "history-1"

    with pytest.raises(ValueError, match="methodology"):
        history_common.history_point_ref("hotspots", payload)


@pytest.mark.parametrize(
    "mutation",
    [
        lambda ref, payload: setattr(ref, "sha256", "f" * 64),
        lambda ref, payload: setattr(ref, "byte_size", (ref.byte_size or 0) + 1),
        lambda ref, payload: setattr(ref, "coverage_end", "2026-07-02"),
        lambda ref, payload: setattr(
            ref,
            "path",
            ref.path.replace("/2026-07-01.json", "/2026-07-02.json"),
        ),
        lambda ref, payload: setattr(payload, "publish_generation_id", "mutable-run"),
    ],
)
def test_point_payload_ref_gate_rejects_wrong_digest_size_date_and_stamp(
    mutation,  # noqa: ANN001
) -> None:
    payload = _hotspots_day()
    summary, _index = _point_index("hotspots", payload)
    ref = summary.refs[0].model_copy(deep=True)
    changed = payload.model_copy(deep=True)
    mutation(ref, changed)

    findings = gate.check_point_history_day_ref(
        ref,
        changed,
        family="hotspots",
    )

    assert findings


def test_point_payload_ref_gate_rejects_mislabeled_or_duplicate_grains() -> None:
    hotspots = _hotspots_day()
    hotspots.by_grain = [HotspotGrain(grain="day", date=hotspots.date, window_end=hotspots.date)]
    hotspots.by_grain[0].grain = "nonsense"
    hotspot_ref = history_common.history_point_ref("hotspots", hotspots)

    repeat = _repeat_day()
    week = HistoricRepeatOffenderGrain(
        grain="week",
        date="2026-06-25",
        window_end=repeat.date,
        window_days=7,
    )
    repeat.by_grain = [week, week.model_copy(deep=True)]
    repeat_ref = history_common.history_point_ref("repeat_offenders", repeat)

    assert gate.check_point_history_day_ref(hotspot_ref, hotspots, family="hotspots")
    assert gate.check_point_history_day_ref(
        repeat_ref,
        repeat,
        family="repeat_offenders",
    )


@pytest.mark.parametrize(
    "mutation",
    [
        lambda index: setattr(index, "selection_mode", HistorySelectionMode.range),
        lambda index: setattr(index, "family", "network"),
        lambda index: index.available_dates.append("2026-07-02"),
        lambda index: setattr(index.partitions[0], "coverage_end", "2026-07-02"),
        lambda index: setattr(index.partitions[0], "sha256", "f" * 64),
        lambda index: setattr(index, "collection_generation_id", "wrong"),
    ],
)
def test_point_family_index_gate_rejects_wrong_identity_dates_refs_and_generation(
    mutation,  # noqa: ANN001
) -> None:
    summary, index = _point_index("repeat_offenders", _repeat_day())
    publish._stamp_envelope(  # noqa: SLF001
        [("unused", index, "historic")],
        provider_id="stm",
        stamp=STAMP,
    )
    path = history_common.history_pointer_path(
        "historic/history/repeat_offenders",
        index,
    )
    mutation(index)

    findings = gate.check_point_history_index(
        index,
        rel_key=path,
        family="repeat_offenders",
        expected_refs=summary.refs,
        fallback_generated_utc=STAMP,
    )

    assert findings


@pytest.mark.parametrize(
    ("field", "value", "expected_check"),
    [
        ("generated_utc", "2026-07-13T00:00:00+00:00", "generated_utc"),
        ("methodology_version", "reliability-1", "index_envelope"),
        ("publish_generation_id", None, "index_envelope"),
    ],
)
def test_point_family_index_gate_requires_canonical_published_envelope(
    field: str,
    value: object,
    expected_check: str,
) -> None:
    _summary, index = _point_index("hotspots", _hotspots_day())
    publish._stamp_envelope(  # noqa: SLF001
        [("unused", index, "historic")],
        provider_id="stm",
        stamp=STAMP,
    )
    path = history_common.history_pointer_path("historic/history/hotspots", index)
    setattr(index, field, value)

    findings = gate.check_point_history_index(
        index,
        rel_key=path,
        family="hotspots",
    )

    assert expected_check in {finding.check for finding in findings}


def test_publish_streams_all_point_days_before_exact_indexes_and_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    hotspots = (
        _hotspots_day("2026-07-01"),
        _hotspots_day("2026-07-03", generated_utc="2026-07-04T05:00:00Z"),
    )
    repeat = (_repeat_day("2026-07-02"),)
    _patch_points(monkeypatch, hotspots=hotspots, repeat=repeat)
    store = _RecordingStore()

    keys = publish._publish_historic(  # noqa: SLF001
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=2),
        stamp=STAMP,
    )

    assert keys[-1] == "historic/history/index.json"
    assert store.calls[-1] == ("normal", "historic/history/index.json")
    root = HistoricAvailabilityIndex.model_validate_json(
        store.objects["historic/history/index.json"]
    )
    assert [family.family for family in root.families] == [
        "alerts",
        "hotspots",
        "lines",
        "network",
        "receipts",
        "repeat_offenders",
        "stops",
    ]
    by_family = {family.family: family for family in root.families}
    point_index_paths = [
        by_family["hotspots"].index_path,
        by_family["repeat_offenders"].index_path,
    ]
    assert "historic/history/hotspots/index.json" not in store.objects
    assert "historic/history/repeat_offenders/index.json" not in store.objects
    positions = {path: position for position, (_mode, path) in enumerate(store.calls)}
    child_paths: list[str] = []
    for family, payloads in (("hotspots", hotspots), ("repeat_offenders", repeat)):
        index_path = by_family[family].index_path
        match = re.fullmatch(
            rf"historic/history/{family}/generations/([0-9a-f]{{64}})/index\.json",
            index_path,
        )
        assert match is not None
        index = HistoricCollectionIndex.model_validate_json(store.objects[index_path])
        assert snapshot_sha256(index) == match.group(1)
        assert index.publish_generation_id == f"stm@{STAMP}"
        for ref, payload in zip(index.partitions, payloads, strict=True):
            child_paths.append(ref.path)
            assert store.objects[ref.path] == snapshot_json_bytes(payload)
            assert positions[ref.path] < positions[index_path]
    assert max(positions[path] for path in child_paths) < min(
        positions[path] for path in point_index_paths
    )
    assert (
        max(positions[path] for path in point_index_paths)
        < positions["historic/history/index.json"]
    )


def test_point_days_upload_in_bounded_immutable_batches_after_gating(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    days = tuple(
        _hotspots_day(
            f"2026-07-{day:02d}",
            generated_utc=f"2026-07-{day + 1:02d}T05:00:00Z",
        )
        for day in range(1, 6)
    )
    store = _RecordingStore()
    report = gate.new_report("stm", "historic", STAMP)
    batches: list[tuple[int, int, str]] = []
    original_parallel_put = publish._parallel_put  # noqa: SLF001

    def record_batch(storage, items, *, concurrency, write_mode="normal"):  # noqa: ANN001, ANN202
        batches.append((len(items), concurrency, write_mode))
        return original_parallel_put(
            storage,
            items,
            concurrency=concurrency,
            write_mode=write_mode,
        )

    monkeypatch.setattr(publish, "_parallel_put", record_batch)

    summary, keys = publish._publish_point_history_days(  # noqa: SLF001
        _PointPlan(*days),
        family="hotspots",
        storage=store,
        report=report,
        analytics_report=None,
        force=False,
        concurrency=2,
    )

    assert report.passed
    assert len(summary.refs) == len(keys) == 5
    assert batches == [(2, 2, "immutable"), (2, 2, "immutable"), (1, 2, "immutable")]


def test_point_day_batch_memory_cap_is_fixed_even_with_extreme_executor_concurrency(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    first = date(2026, 1, 1)
    days = tuple(
        _hotspots_day(
            (local_date := first + timedelta(days=offset)).isoformat(),
            generated_utc=f"{(local_date + timedelta(days=1)).isoformat()}T05:00:00Z",
        )
        for offset in range(70)
    )
    batches: list[tuple[int, int, str]] = []

    def record_batch(_storage, items, *, concurrency, write_mode="normal"):  # noqa: ANN001, ANN202
        batches.append((len(items), concurrency, write_mode))
        return [item[0] for item in items]

    monkeypatch.setattr(publish, "_parallel_put", record_batch)

    _summary, keys = publish._publish_point_history_days(  # noqa: SLF001
        _PointPlan(*days),
        family="hotspots",
        storage=_RecordingStore(),
        report=gate.new_report("stm", "historic", STAMP),
        analytics_report=None,
        force=False,
        concurrency=10_000,
    )

    assert len(keys) == 70
    assert batches == [
        (32, 10_000, "immutable"),
        (32, 10_000, "immutable"),
        (6, 10_000, "immutable"),
    ]


def test_point_child_or_index_failure_leaves_old_root_active(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_minimal_historic(monkeypatch)
    _patch_points(monkeypatch, hotspots=(_hotspots_day(),), repeat=(_repeat_day(),))

    class FailingStore(_RecordingStore):
        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            if re.fullmatch(
                r"historic/history/repeat_offenders/generations/[0-9a-f]{64}/index\.json",
                rel_key,
            ):
                raise RuntimeError("point index failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailingStore()
    old_root = b'{"old":true}'
    store.objects["historic/history/index.json"] = old_root

    with pytest.raises(RuntimeError, match="point index failed"):
        publish._publish_historic(  # noqa: SLF001
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp=STAMP,
        )

    assert store.objects["historic/history/index.json"] == old_root


def test_point_indexes_extend_root_timestamp_and_exact_child_graph() -> None:
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    hotspot_summary, hotspots = _point_index(
        "hotspots",
        _hotspots_day(generated_utc="2026-07-14T01:00:00Z"),
    )
    repeat_summary, repeat = _point_index("repeat_offenders", _repeat_day())
    for index in (hotspots, repeat):
        publish._stamp_envelope(  # noqa: SLF001
            [("unused", index, "historic")],
            provider_id="stm",
            stamp=STAMP,
        )
    hotspot_path = history_common.history_pointer_path("historic/history/hotspots", hotspots)
    repeat_path = history_common.history_pointer_path("historic/history/repeat_offenders", repeat)
    alerts = AlertArchiveIndex(
        generated_utc=STAMP,
        collection_generation_id="alerts",
        first_available_date=None,
        last_available_date=None,
        total_alerts=0,
        months=[],
    )
    receipts = ReceiptsIndex(
        generated_utc=STAMP,
        collection_generation_id=publish._receipts_collection_generation_id({}),  # noqa: SLF001
        dates=[],
    )
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp=STAMP,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat,
        hotspots_index_path=hotspot_path,
        repeat_offenders_index_path=repeat_path,
    )

    assert root.generated_utc == "2026-07-14T01:00:00Z"
    assert not gate.check_history_availability_graph(
        root,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat,
        fallback_generated_utc=STAMP,
        hotspots_index_path=hotspot_path,
        repeat_offenders_index_path=repeat_path,
    )
    repeat.partitions[0].sha256 = "f" * 64
    findings = gate.check_history_availability_graph(
        root,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat,
        fallback_generated_utc=STAMP,
        hotspots_index_path=hotspot_path,
        repeat_offenders_index_path=repeat_path,
    )
    assert findings


def test_collect_names_historic_bundles_and_consumes_point_plans_in_connection(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    _patch_points(
        monkeypatch,
        hotspots=(_hotspots_day(),),
        repeat=(_repeat_day(),),
    )
    monkeypatch.setattr(publish, "_historic_stamp", lambda: STAMP)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)
    connection = SimpleNamespace(closed=False)

    class Engine:
        @contextmanager
        def connect(self):  # noqa: ANN201
            try:
                yield connection
            finally:
                connection.closed = True

    def consume(collected: publish.HistoricValidationInputs):  # noqa: ANN202
        assert not connection.closed
        assert collected.alert_archive is not None
        assert collected.alert_archive.provider_timezone == "UTC"
        assert collected.network_history is not None
        assert collected.line_history is not None
        assert collected.stop_history is not None
        bundle = collected.point_plans
        assert bundle is not None
        return (
            [day.date for day in bundle.hotspots.iter_days()],
            [day.date for day in bundle.repeat_offenders.iter_days()],
        )

    dates = publish.collect_payloads(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
        include_archive_bundle=True,
        include_network_bundle=True,
        include_line_bundle=True,
        include_stop_bundle=True,
        include_point_bundle=True,
        _historic_consumer=consume,
    )

    assert dates == (["2026-07-01"], ["2026-07-01"])
    assert connection.closed


def test_validation_named_inputs_support_a_point_only_non_prefix_bundle() -> None:
    point_plans = publish.HistoricPointPlanBundle(
        hotspots=_PointPlan(),
        repeat_offenders=_PointPlan(),
    )
    collected = publish.HistoricValidationInputs(
        all_items=[],
        route_items=[],
        stamp=STAMP,
        prior_total=None,
        point_plans=point_plans,
    )

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        _collected=collected,
    )

    assert report.errors == []


def test_validation_named_inputs_support_range_archive_without_point_bundle(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    monkeypatch.setattr(publish, "_historic_stamp", lambda: STAMP)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        @contextmanager
        def connect(self):  # noqa: ANN201
            yield object()

    collected = publish.collect_payloads(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
        include_archive_bundle=True,
        include_network_bundle=True,
        include_line_bundle=True,
        include_stop_bundle=True,
    )

    assert isinstance(collected, publish.HistoricValidationInputs)
    assert collected.point_plans is None
    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        _collected=collected,
    )

    assert report.errors == []
    assert "historic/history/index.json" not in report.payload_sha256


def test_validation_records_the_exact_point_graph_published_from_fresh_plans(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    _patch_minimal_historic(
        monkeypatch,
        network_plan=_network_history_plan(),
        line_plan=_line_history_plan(),
        stop_plan=_stop_history_plan(),
    )
    _patch_points(
        monkeypatch,
        hotspots=(
            _hotspots_day("2026-07-01"),
            _hotspots_day("2026-07-03", generated_utc="2026-07-04T05:00:00Z"),
        ),
        repeat=(_repeat_day("2026-07-02"),),
    )
    monkeypatch.setattr(publish, "_historic_stamp", lambda: STAMP)
    monkeypatch.setattr(publish, "_prior_files_total", lambda *args, **kwargs: None)

    class Engine:
        @contextmanager
        def connect(self):  # noqa: ANN201
            yield object()

    report = publish.validate_snapshots(
        "stm",
        tier="historic",
        settings=SimpleNamespace(),
        engine=Engine(),
    )
    store = _RecordingStore()
    publish._publish_historic(  # noqa: SLF001
        object(),
        store,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=2),
        stamp=STAMP,
    )

    assert report.passed
    point_pattern = re.compile(
        r"historic/history/(?:hotspots|repeat_offenders)/generations/"
        r"[0-9a-f]{64}/(?:index|\d{4}-\d{2}-\d{2})\.json"
    )
    validated = {path for path in report.payload_sha256 if point_pattern.fullmatch(path)}
    published = {path for path in store.objects if point_pattern.fullmatch(path)}
    assert validated == published
    for path in validated:
        assert report.payload_sha256[path] == hashlib.sha256(store.objects[path]).hexdigest()


@pytest.mark.parametrize("family", ["hotspots", "repeat_offenders"])
@pytest.mark.parametrize("stage", ["child", "index"])
def test_each_point_family_write_failure_preserves_old_root(
    monkeypatch: pytest.MonkeyPatch,
    family: str,
    stage: str,
) -> None:
    _patch_minimal_historic(monkeypatch)
    _patch_points(monkeypatch, hotspots=(_hotspots_day(),), repeat=(_repeat_day(),))

    class FailingStore(_RecordingStore):
        def put_immutable_json(self, rel_key, payload):  # noqa: ANN001, ANN201
            is_family = rel_key.startswith(f"historic/history/{family}/generations/")
            is_index = rel_key.endswith("/index.json")
            matches_stage = (stage == "index" and is_index) or (stage == "child" and not is_index)
            if is_family and matches_stage:
                raise RuntimeError(f"{family} {stage} failed")
            return super().put_immutable_json(rel_key, payload)

    store = FailingStore()
    old_root = b'{"old":true}'
    store.objects["historic/history/index.json"] = old_root

    with pytest.raises(RuntimeError, match=f"{family} {stage} failed"):
        publish._publish_historic(  # noqa: SLF001
            object(),
            store,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp=STAMP,
        )

    assert store.objects["historic/history/index.json"] == old_root


@pytest.mark.parametrize("family", ["hotspots", "repeat_offenders"])
def test_point_family_gate_failure_blocks_root_unless_force_is_explicit(
    monkeypatch: pytest.MonkeyPatch,
    family: str,
) -> None:
    _patch_minimal_historic(monkeypatch)
    hotspot = _hotspots_day()
    repeat = _repeat_day()
    if family == "hotspots":
        hotspot.hotspots = [Hotspot(rank=1, type="trip", id="bad-type")]
    else:
        repeat.offenders = [Offender(type="bogus", id="bad-type")]
    _patch_points(monkeypatch, hotspots=(hotspot,), repeat=(repeat,))
    old_root = b'{"old":true}'
    blocked = _RecordingStore()
    blocked.objects["historic/history/index.json"] = old_root

    with pytest.raises(gate.GateError) as exc_info:
        publish._publish_historic(  # noqa: SLF001
            object(),
            blocked,
            provider_id="stm",
            settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
            stamp=STAMP,
        )

    assert "unknown_type" in {finding.check for finding in exc_info.value.report.errors}
    assert blocked.objects["historic/history/index.json"] == old_root

    forced = _RecordingStore()
    forced.objects["historic/history/index.json"] = old_root
    publish._publish_historic(  # noqa: SLF001
        object(),
        forced,
        provider_id="stm",
        settings=SimpleNamespace(SNAPSHOT_PUBLISH_CONCURRENCY=1),
        stamp=STAMP,
        force=True,
    )

    assert forced.objects["historic/history/index.json"] != old_root


@pytest.mark.parametrize(
    "mutation",
    [
        lambda root: root.families.pop(1),
        lambda root: root.families.append(root.families[1].model_copy(deep=True)),
        lambda root: setattr(root.families[1], "selection_mode", HistorySelectionMode.range),
        lambda root: setattr(
            root.families[1],
            "index_path",
            "historic/history/hotspots/index.json",
        ),
    ],
)
def test_root_contract_rejects_missing_duplicate_wrong_mode_and_mutable_point_path(
    mutation,  # noqa: ANN001
) -> None:
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    _hot_summary, hotspots = _point_index("hotspots", _hotspots_day())
    _repeat_summary, repeat = _point_index("repeat_offenders", _repeat_day())
    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp=STAMP,
        alert_index=AlertArchiveIndex(
            generated_utc=STAMP,
            collection_generation_id="alerts",
            first_available_date=None,
            last_available_date=None,
            total_alerts=0,
            months=[],
        ),
        receipts_index=ReceiptsIndex(
            generated_utc=STAMP,
            collection_generation_id="receipts",
            dates=[],
        ),
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat,
    )
    mutation(root)

    findings = gate.check_history_availability_index(
        root,
        rel_key="historic/history/index.json",
    )

    assert findings


def test_root_build_and_graph_require_both_exact_point_children() -> None:
    from transit_ops.snapshots.contract import AlertArchiveIndex, ReceiptsIndex

    network = _network_history_plan().materialize().index
    lines = _line_history_plan().materialize()
    stops = _stop_history_plan().materialize()
    alerts = AlertArchiveIndex(
        generated_utc=STAMP,
        collection_generation_id="alerts",
        first_available_date=None,
        last_available_date=None,
        total_alerts=0,
        months=[],
    )
    receipts = ReceiptsIndex(
        generated_utc=STAMP,
        collection_generation_id="receipts",
        dates=[],
    )
    _hot_summary, hotspots = _point_index("hotspots")
    _repeat_summary, repeat = _point_index("repeat_offenders")
    for index in (hotspots, repeat):
        publish._stamp_envelope(  # noqa: SLF001
            [("unused", index, "historic")],
            provider_id="stm",
            stamp=STAMP,
        )

    with pytest.raises(RuntimeError, match="point history children"):
        publish._build_history_availability_index(  # noqa: SLF001
            stamp=STAMP,
            alert_index=alerts,
            receipts_index=receipts,
            network_index=network,
            line_directory=lines.directory,
            line_indexes=lines.indexes,
            stop_directory=stops.directory,
            stop_indexes=stops.indexes,
            hotspots_index=hotspots,
        )

    root = publish._build_history_availability_index(  # noqa: SLF001
        stamp=STAMP,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        repeat_offenders_index=repeat,
    )
    findings = gate.check_history_availability_graph(
        root,
        alert_index=alerts,
        receipts_index=receipts,
        network_index=network,
        line_directory=lines.directory,
        line_indexes=lines.indexes,
        stop_directory=stops.directory,
        stop_indexes=stops.indexes,
        hotspots_index=hotspots,
        fallback_generated_utc=STAMP,
    )

    assert "missing_point_child" in {finding.check for finding in findings}
