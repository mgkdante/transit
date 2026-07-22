from __future__ import annotations

import hashlib
import json
import threading
import time
from collections import Counter
from dataclasses import replace
from datetime import UTC, datetime, timedelta

import pytest

from transit_ops.snapshots import publish
from transit_ops.snapshots.builders.historic.alert_archive import _collection_generation_id
from transit_ops.snapshots.builders.historic.history_common import (
    encode_history_entity_id,
    history_entity_directory_generation_id,
    history_index_generation_id,
    history_metric_coverage,
    history_partition_ref,
    history_point_ref,
    history_pointer_path,
)
from transit_ops.snapshots.contract import (
    AlertArchiveEntry,
    AlertArchiveIndex,
    AlertArchiveMonth,
    AlertArchivePage,
    AlertArchivePageRef,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricDelayMetric,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricFamilyAvailability,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    LineHistoryDay,
    LineHistoryPartition,
    Manifest,
    ManifestFiles,
    ManifestHistoricFiles,
    ManifestLiveFiles,
    NetworkHistoryDay,
    NetworkHistoryPartition,
    ReceiptsIndex,
    StopHistoryDay,
    StopHistoryPartition,
)
from transit_ops.snapshots.historic_gc import (
    HistoricGcBlockedError,
    HistoricGcMark,
    HistoricGcUnsupportedError,
    plan_historic_generation_gc,
)
from transit_ops.snapshots.paths import safe_public_path
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256
from transit_ops.snapshots.storage import StoredObjectVersion, StoredObjectVersionMismatchError

STAMP = "2026-07-13T06:00:00Z"
NOW = datetime(2026, 7, 14, 12, tzinfo=UTC)
OLD = NOW - timedelta(days=4)
PUBLISH_ID = f"stm@{STAMP}"


class MemorySnapshotStorage:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self.versions: dict[str, StoredObjectVersion] = {}
        self.iter_calls = 0
        self.read_calls: list[str] = []
        self.conditional_read_calls: list[str] = []
        self.conditional_read_delay_seconds = 0.0
        self.conditional_read_active = 0
        self.conditional_read_peak = 0
        self.version_delay_seconds = 0.0
        self.version_active = 0
        self.version_peak = 0
        self._request_lock = threading.Lock()

    def put(self, rel_key: str, payload: object, *, modified: datetime = OLD) -> str:
        body = payload if isinstance(payload, bytes) else snapshot_json_bytes(payload)  # type: ignore[arg-type]
        self.objects[rel_key] = body
        self.versions[rel_key] = StoredObjectVersion(
            rel_key=rel_key,
            etag=hashlib.sha256(body).hexdigest(),
            last_modified_utc=modified,
            size=len(body),
        )
        return rel_key

    def read_bytes(self, rel_key: str) -> bytes | None:
        self.read_calls.append(rel_key)
        return self.objects.get(rel_key)

    def read_bytes_at_version(
        self,
        rel_key: str,
        expected_version: StoredObjectVersion,
    ) -> bytes:
        with self._request_lock:
            self.conditional_read_calls.append(rel_key)
            self.conditional_read_active += 1
            self.conditional_read_peak = max(
                self.conditional_read_peak,
                self.conditional_read_active,
            )
        try:
            if self.conditional_read_delay_seconds:
                time.sleep(self.conditional_read_delay_seconds)
            current = self.versions.get(rel_key)
            body = self.objects.get(rel_key)
            if current != expected_version or body is None or len(body) != expected_version.size:
                raise StoredObjectVersionMismatchError(rel_key)
            return body
        finally:
            with self._request_lock:
                self.conditional_read_active -= 1

    def capture_object_version(self, rel_key: str) -> StoredObjectVersion | None:
        with self._request_lock:
            self.version_active += 1
            self.version_peak = max(self.version_peak, self.version_active)
        try:
            if self.version_delay_seconds:
                time.sleep(self.version_delay_seconds)
            return self.versions.get(rel_key)
        finally:
            with self._request_lock:
                self.version_active -= 1

    def iter_object_versions(self, rel_prefix: str):
        self.iter_calls += 1
        for key in sorted(self.versions):
            if key.startswith(rel_prefix):
                yield self.versions[key]


def _delay() -> HistoricDelayMetric:
    return HistoricDelayMetric(
        observation_count=1,
        in_clamp_observation_count=1,
        on_time_count=1,
        severe_count=0,
        sum_delay_seconds=0,
    )


def _stop_delay() -> HistoricDelayMetric:
    return HistoricDelayMetric(
        observation_count=1,
        in_clamp_observation_count=1,
        severe_count=0,
        sum_delay_seconds=0,
    )


def _collection(
    family: str,
    *,
    selection_mode: str,
    entity_id: str | None = None,
    refs: list | None = None,
) -> HistoricCollectionIndex:
    refs = refs or []
    dates = [ref.coverage_start for ref in refs]
    aggregations = {
        "network": (
            ("delay", "additive"),
            ("delay_percentiles", "daily_only"),
            ("vehicles", "daily_only"),
            ("cancellation", "additive"),
            ("occupancy", "additive"),
        ),
        "lines": (
            ("delay", "additive"),
            ("delay_percentiles", "daily_only"),
            ("cancellation", "additive"),
            ("occupancy", "additive"),
            ("service_span", "daily_only"),
            ("skipped_stops", "additive"),
        ),
        "stops": (
            ("delay", "additive"),
            ("delay_percentiles", "daily_only"),
            ("occupancy", "additive"),
        ),
    }
    metrics = [
        history_metric_coverage(metric, aggregation, dates if metric == "delay" else [])
        for metric, aggregation in aggregations.get(family, ())
    ]
    index = HistoricCollectionIndex(
        generated_utc=STAMP,
        methodology_version="history-1",
        publish_generation_id=PUBLISH_ID,
        family=family,
        selection_mode=selection_mode,
        entity_id=entity_id,
        first_available_date=dates[0] if dates else None,
        last_available_date=dates[-1] if dates else None,
        available_dates=dates,
        partitions=refs,
        metrics=metrics,
    )
    index.collection_generation_id = history_index_generation_id(index)
    return index


def _directory(
    family: str,
    entity_id: str,
    child: HistoricCollectionIndex,
    child_path: str,
) -> HistoricEntityDirectoryIndex:
    encoded = encode_history_entity_id(entity_id)
    directory = HistoricEntityDirectoryIndex(
        generated_utc=STAMP,
        methodology_version="history-1",
        publish_generation_id=PUBLISH_ID,
        family=family,
        selection_mode="range",
        collection_generation_id="pending",
        first_available_date=child.first_available_date,
        last_available_date=child.last_available_date,
        entities=[
            HistoricEntityIndexRef(
                entity_id=entity_id,
                encoded_id=encoded,
                index_path=child_path,
                collection_generation_id=child.collection_generation_id or "",
                first_available_date=child.first_available_date,
                last_available_date=child.last_available_date,
            )
        ],
    )
    directory.collection_generation_id = history_entity_directory_generation_id(directory)
    return directory


def _archive_page() -> tuple[str, AlertArchivePage, AlertArchivePageRef]:
    page = AlertArchivePage(
        generated_utc=STAMP,
        methodology_version="alerts-1",
        month="2026-07",
        page=1,
        alerts=[
            AlertArchiveEntry(
                id="alert-1",
                first_seen_utc="2026-07-01T10:00:00Z",
                last_seen_utc="2026-07-01T11:00:00Z",
            )
        ],
    )
    body = snapshot_json_bytes(page)
    digest = hashlib.sha256(body).hexdigest()
    path = f"historic/alerts/generations/{digest}/2026-07/page-0001.json"
    return (
        path,
        page,
        AlertArchivePageRef(
            path=path,
            page=1,
            count=1,
            byte_size=len(body),
            sha256=digest,
            coverage_start="2026-07-01",
            coverage_end="2026-07-01",
        ),
    )


def _build_graph() -> tuple[MemorySnapshotStorage, dict[str, str]]:
    storage = MemorySnapshotStorage()

    network_partition = NetworkHistoryPartition(
        generated_utc=STAMP,
        methodology_version="history-1",
        month="2026-07",
        days=[NetworkHistoryDay(date="2026-07-01", delay=_delay())],
    )
    network_ref = history_partition_ref(
        f"historic/history/network/generations/{snapshot_sha256(network_partition)}/2026-07.json",
        network_partition,
    )
    network = _collection("network", selection_mode="range", refs=[network_ref])
    network_path = history_pointer_path("historic/history/network", network)

    line_id = "51"
    line_partition = LineHistoryPartition(
        generated_utc=STAMP,
        methodology_version="history-1",
        month="2026-07",
        entity_id=line_id,
        days=[LineHistoryDay(date="2026-07-01", delay=_delay())],
    )
    line_encoded = encode_history_entity_id(line_id)
    line_ref = history_partition_ref(
        f"historic/history/lines/{line_encoded}/generations/"
        f"{snapshot_sha256(line_partition)}/2026-07.json",
        line_partition,
    )
    line_index = _collection("lines", selection_mode="range", entity_id=line_id, refs=[line_ref])
    line_index_path = history_pointer_path(f"historic/history/lines/{line_encoded}", line_index)
    lines = _directory("lines", line_id, line_index, line_index_path)
    lines_path = history_pointer_path("historic/history/lines", lines)

    stop_id = "stop:1"
    stop_partition = StopHistoryPartition(
        generated_utc=STAMP,
        methodology_version="history-1",
        month="2026-07",
        entity_id=stop_id,
        days=[StopHistoryDay(date="2026-07-01", delay=_stop_delay())],
    )
    stop_encoded = encode_history_entity_id(stop_id)
    stop_ref = history_partition_ref(
        f"historic/history/stops/{stop_encoded}/generations/"
        f"{snapshot_sha256(stop_partition)}/2026-07.json",
        stop_partition,
    )
    stop_index = _collection("stops", selection_mode="range", entity_id=stop_id, refs=[stop_ref])
    stop_index_path = history_pointer_path(f"historic/history/stops/{stop_encoded}", stop_index)
    stops = _directory("stops", stop_id, stop_index, stop_index_path)
    stops_path = history_pointer_path("historic/history/stops", stops)

    repeat_day = HistoricRepeatOffendersDay(
        generated_utc=STAMP,
        methodology_version="reliability-1",
        date="2026-07-01",
    )
    repeat_ref = history_point_ref("repeat_offenders", repeat_day)
    repeat = _collection("repeat_offenders", selection_mode="date", refs=[repeat_ref])
    repeat_path = history_pointer_path("historic/history/repeat_offenders", repeat)

    hotspots = _collection("hotspots", selection_mode="date")
    hotspots_path = history_pointer_path("historic/history/hotspots", hotspots)

    empty_alerts = AlertArchiveIndex(
        generated_utc=STAMP,
        methodology_version="alerts-1",
        publish_generation_id=PUBLISH_ID,
        collection_generation_id=_collection_generation_id([], None, None),
        first_available_date=None,
        last_available_date=None,
        total_alerts=0,
        months=[],
    )
    alerts_path = history_pointer_path("historic/alerts", empty_alerts)
    empty_receipts = ReceiptsIndex(
        generated_utc=STAMP,
        methodology_version="receipt-1",
        publish_generation_id=PUBLISH_ID,
        dates=[],
        collection_generation_id=snapshot_sha256({"receipts": []}),
    )
    receipts_path = history_pointer_path("historic/receipts", empty_receipts)

    root = HistoricAvailabilityIndex(
        generated_utc=STAMP,
        methodology_version="history-1",
        publish_generation_id=PUBLISH_ID,
        families=[
            HistoricFamilyAvailability(
                family="alerts",
                selection_mode="range",
                index_path=alerts_path,
                collection_generation_id=empty_alerts.collection_generation_id,
            ),
            HistoricFamilyAvailability(
                family="hotspots",
                selection_mode="date",
                index_path=hotspots_path,
                collection_generation_id=hotspots.collection_generation_id,
            ),
            HistoricFamilyAvailability(
                family="lines",
                selection_mode="range",
                index_path=lines_path,
                collection_generation_id=lines.collection_generation_id,
                first_available_date=lines.first_available_date,
                last_available_date=lines.last_available_date,
                gaps=line_index.gaps,
                metrics=line_index.metrics,
            ),
            HistoricFamilyAvailability(
                family="network",
                selection_mode="range",
                index_path=network_path,
                collection_generation_id=network.collection_generation_id,
                first_available_date=network.first_available_date,
                last_available_date=network.last_available_date,
                gaps=network.gaps,
                metrics=network.metrics,
            ),
            HistoricFamilyAvailability(
                family="receipts",
                selection_mode="date",
                index_path=receipts_path,
                collection_generation_id=empty_receipts.collection_generation_id,
            ),
            HistoricFamilyAvailability(
                family="repeat_offenders",
                selection_mode="date",
                index_path=repeat_path,
                collection_generation_id=repeat.collection_generation_id,
                first_available_date=repeat.first_available_date,
                last_available_date=repeat.last_available_date,
                gaps=repeat.gaps,
            ),
            HistoricFamilyAvailability(
                family="stops",
                selection_mode="range",
                index_path=stops_path,
                collection_generation_id=stops.collection_generation_id,
                first_available_date=stops.first_available_date,
                last_available_date=stops.last_available_date,
                gaps=stop_index.gaps,
                metrics=stop_index.metrics,
            ),
        ],
    )
    manifest = Manifest(
        provider="stm",
        display_name="STM",
        bbox=[45.4, -73.9, 45.8, -73.4],
        attribution="STM",
        dataset_version="fixture",
        labels={},
        surfaces=["accountability"],
        files=ManifestFiles(
            live=ManifestLiveFiles(generated_utc=STAMP),
            historic=ManifestHistoricFiles(generated_utc=STAMP),
        ),
    )

    for path, payload in (
        ("manifest.json", manifest),
        ("historic/history/index.json", root),
        (alerts_path, empty_alerts),
        (receipts_path, empty_receipts),
        (network_path, network),
        (network_ref.path, network_partition),
        (lines_path, lines),
        (line_index_path, line_index),
        (line_ref.path, line_partition),
        (stops_path, stops),
        (stop_index_path, stop_index),
        (stop_ref.path, stop_partition),
        (hotspots_path, hotspots),
        (repeat_path, repeat),
        (repeat_ref.path, repeat_day),
    ):
        storage.put(path, payload)

    page_path, page, page_ref = _archive_page()
    compat_alerts = AlertArchiveIndex(
        generated_utc=STAMP,
        methodology_version="alerts-1",
        publish_generation_id=PUBLISH_ID,
        collection_generation_id=_collection_generation_id(
            [AlertArchiveMonth(month="2026-07", total_alerts=1, pages=[page_ref])],
            "2026-07-01",
            "2026-07-01",
        ),
        first_available_date="2026-07-01",
        last_available_date="2026-07-01",
        total_alerts=1,
        months=[AlertArchiveMonth(month="2026-07", total_alerts=1, pages=[page_ref])],
    )
    compat_alerts_path = history_pointer_path("historic/alerts", compat_alerts)
    storage.put("historic/alerts/index.json", compat_alerts)
    storage.put(compat_alerts_path, compat_alerts)
    storage.put(page_path, page)

    compat_receipts = ReceiptsIndex(
        generated_utc=STAMP,
        methodology_version="receipt-1",
        publish_generation_id=PUBLISH_ID,
        dates=["2026-06-30"],
        collection_generation_id="compat-receipts",
    )
    compat_receipts_path = history_pointer_path("historic/receipts", compat_receipts)
    storage.put("historic/receipts/index.json", compat_receipts)
    storage.put(compat_receipts_path, compat_receipts)

    legacy_day = HistoricHotspotsDay(
        generated_utc=STAMP,
        methodology_version="reliability-1",
        date="2026-06-30",
    )
    legacy_ref = history_point_ref("hotspots", legacy_day)
    legacy_hotspots = _collection("hotspots", selection_mode="date", refs=[legacy_ref])
    legacy_hotspots_path = history_pointer_path("historic/history/hotspots", legacy_hotspots)
    storage.put("historic/history/hotspots/index.json", legacy_hotspots)
    storage.put(legacy_hotspots_path, legacy_hotspots)
    storage.put(legacy_ref.path, legacy_day)

    orphan = NetworkHistoryPartition(
        generated_utc=STAMP,
        methodology_version="history-1",
        month="2025-01",
        days=[NetworkHistoryDay(date="2025-01-01", delay=_delay())],
    )
    orphan_path = f"historic/history/network/generations/{snapshot_sha256(orphan)}/2025-01.json"
    storage.put(orphan_path, orphan)
    return storage, {
        "compat_alerts": compat_alerts_path,
        "compat_receipts": compat_receipts_path,
        "alert_page": page_path,
        "legacy_hotspots": legacy_hotspots_path,
        "legacy_day": legacy_ref.path,
        "line_index": line_index_path,
        "line_partition": line_ref.path,
        "stop_index": stop_index_path,
        "stop_partition": stop_ref.path,
        "network_partition": network_ref.path,
        "repeat_day": repeat_ref.path,
        "orphan": orphan_path,
    }


def test_gc_walks_all_seven_families_compatibility_roots_and_legacy_roots() -> None:
    storage, paths = _build_graph()

    report = plan_historic_generation_gc(storage, now=NOW, mode="dry-run")

    for name, path in paths.items():
        if name != "orphan":
            assert path in report.reachable_keys
    assert report.unreachable_keys == (paths["orphan"],)
    assert report.marked_keys == (paths["orphan"],)
    assert report.eligible_keys == ()
    assert report.mode == "dry-run"


def test_gc_accepts_a_registered_historic_only_provider_without_a_manifest() -> None:
    storage, paths = _build_graph()
    storage.objects.pop("manifest.json")
    storage.versions.pop("manifest.json")

    report = plan_historic_generation_gc(
        storage,
        now=NOW,
        mode="dry-run",
        provider_id="octranspo",
    )

    assert report.provider_id == "octranspo"
    assert report.unreachable_keys == (paths["orphan"],)


def test_gc_inventories_once_fetches_each_body_once_and_uses_bounded_parallelism() -> None:
    storage, paths = _build_graph()
    storage.conditional_read_delay_seconds = 0.002
    storage.version_delay_seconds = 0.002

    plan_historic_generation_gc(storage, now=NOW, mode="dry-run", provider_id="stm")

    counts = Counter(storage.conditional_read_calls)
    assert storage.iter_calls == 1
    assert storage.read_calls == []
    assert counts
    assert set(counts.values()) == {1}
    assert counts[paths["alert_page"]] == 1
    assert 1 < storage.conditional_read_peak <= 16
    assert 1 < storage.version_peak <= 16


def test_gc_fetches_each_body_once_when_a_legacy_root_aliases_the_canonical_graph() -> None:
    storage, paths = _build_graph()
    root = HistoricAvailabilityIndex.model_validate_json(
        storage.objects["historic/history/index.json"]
    )
    network_path = next(edge.index_path for edge in root.families if edge.family == "network")
    storage.put("historic/history/network/index.json", storage.objects[network_path])

    plan_historic_generation_gc(storage, now=NOW, mode="dry-run", provider_id="stm")

    counts = Counter(storage.conditional_read_calls)
    assert counts["historic/history/network/index.json"] == 1
    assert counts[network_path] == 1
    assert counts[paths["network_partition"]] == 1
    assert set(counts.values()) == {1}


def test_gc_blocks_a_conditional_read_version_conflict() -> None:
    storage, _paths = _build_graph()
    original_read = storage.read_bytes_at_version

    def conflict(rel_key: str, expected_version: StoredObjectVersion) -> bytes:
        if rel_key == "historic/history/index.json":
            raise StoredObjectVersionMismatchError(
                rel_key,
                reason="metadata_mismatch:last_modified",
            )
        return original_read(rel_key, expected_version)

    storage.read_bytes_at_version = conflict  # type: ignore[method-assign]

    with pytest.raises(
        HistoricGcBlockedError,
        match="object_changed:historic/history/index.json:metadata_mismatch:last_modified",
    ):
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")


@pytest.mark.parametrize(
    "mutation",
    ["missing_history_root", "missing_alerts", "malformed_root", "bad_ref"],
)
def test_gc_fails_closed_before_marking_on_incomplete_or_invalid_graph(mutation: str) -> None:
    storage, paths = _build_graph()
    if mutation == "missing_history_root":
        storage.objects.pop("historic/history/index.json")
        storage.versions.pop("historic/history/index.json")
    elif mutation == "missing_alerts":
        storage.objects.pop("historic/alerts/index.json")
        storage.versions.pop("historic/alerts/index.json")
    elif mutation == "malformed_root":
        storage.put("historic/history/index.json", b"not-json")
    else:
        storage.objects[paths["network_partition"]] = b'{"wrong":true}'

    with pytest.raises(HistoricGcBlockedError):
        plan_historic_generation_gc(storage, now=NOW, mode="mark")


def test_gc_unknown_generation_shape_blocks_the_entire_mark_scan() -> None:
    storage, _paths = _build_graph()
    storage.put(
        f"historic/history/mystery/generations/{'a' * 64}/index.json",
        b"{}",
    )

    with pytest.raises(HistoricGcBlockedError, match="unknown_generation_shape"):
        plan_historic_generation_gc(storage, now=NOW, mode="mark")


def test_gc_invalid_calendar_generation_shape_blocks_the_entire_mark_scan() -> None:
    storage, _paths = _build_graph()
    storage.put(
        f"historic/history/network/generations/{'a' * 64}/2026-99.json",
        b"{}",
    )

    with pytest.raises(HistoricGcBlockedError, match="unknown_generation_shape"):
        plan_historic_generation_gc(storage, now=NOW, mode="mark")


def test_gc_preserves_marks_but_never_reports_eligibility_without_durable_activation() -> None:
    storage, paths = _build_graph()
    orphan = storage.versions[paths["orphan"]]
    first = NOW - timedelta(hours=47)
    prior = HistoricGcMark(
        version=orphan,
        first_unreachable_utc=first,
        last_confirmed_unreachable_utc=first,
        last_scan_id="prior",
    )

    at_47h = plan_historic_generation_gc(
        storage,
        now=NOW,
        mode="mark",
        existing_marks={orphan.rel_key: prior},
    )
    assert at_47h.eligible_keys == ()
    assert at_47h.next_marks[orphan.rel_key].first_unreachable_utc == first

    at_48h = plan_historic_generation_gc(
        storage,
        now=NOW + timedelta(hours=1),
        mode="mark",
        existing_marks=at_47h.next_marks,
    )
    assert at_48h.eligible_keys == ()
    assert at_48h.display_dict()["eligibility_supported"] is False

    changed = replace(orphan, etag="changed")
    storage.versions[orphan.rel_key] = changed
    reset = plan_historic_generation_gc(
        storage,
        now=NOW + timedelta(hours=2),
        mode="mark",
        existing_marks=at_48h.next_marks,
    )
    assert reset.eligible_keys == ()
    assert reset.next_marks[orphan.rel_key].first_unreachable_utc == NOW + timedelta(hours=2)


def test_gc_apply_is_hard_disabled_before_graph_or_inventory_access() -> None:
    storage = MemorySnapshotStorage()

    with pytest.raises(HistoricGcUnsupportedError, match="canary"):
        plan_historic_generation_gc(storage, now=NOW, mode="apply")

    assert storage.iter_calls == 0


def test_gc_binds_manifest_to_the_scanned_provider_identity() -> None:
    storage, _paths = _build_graph()

    with pytest.raises(HistoricGcBlockedError, match="manifest_provider_mismatch"):
        plan_historic_generation_gc(
            storage,
            now=NOW,
            mode="dry-run",
            provider_id="octranspo",
        )


def test_gc_uses_the_shared_snapshot_path_authority() -> None:
    path = f"historic/history/network/generations/{'a' * 64}/index.json"
    assert safe_public_path(path) == path
    with pytest.raises(ValueError, match="unsafe_public_path"):
        safe_public_path("historic/history/%252e%252e/manifest.json")


def test_gc_rejects_manifest_aliases_for_mandatory_stable_roots() -> None:
    storage, _paths = _build_graph()
    manifest = Manifest.model_validate(json.loads(storage.objects["manifest.json"]))
    alerts = storage.objects["historic/alerts/index.json"]
    manifest.files.historic.alerts_index = "historic/alerts/alternate.json"
    storage.put("manifest.json", manifest)
    storage.put("historic/alerts/alternate.json", alerts)

    with pytest.raises(HistoricGcBlockedError, match="mandatory_root_path"):
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")


def test_gc_tolerates_live_only_manifest_churn_during_inventory() -> None:
    storage, _paths = _build_graph()
    original_iter = storage.iter_object_versions

    def churn_manifest(rel_prefix: str):
        manifest = Manifest.model_validate_json(storage.objects["manifest.json"])
        manifest.files.live.generated_utc = "2026-07-14T12:00:30Z"
        storage.put("manifest.json", manifest)
        yield from original_iter(rel_prefix)

    storage.iter_object_versions = churn_manifest  # type: ignore[method-assign]

    report = plan_historic_generation_gc(
        storage,
        now=NOW,
        mode="mark",
        provider_id="stm",
    )

    assert report.provider_id == "stm"


def test_gc_blocks_historic_manifest_churn_after_reading_live_only_replacement() -> None:
    storage, _paths = _build_graph()
    original_iter = storage.iter_object_versions
    original_read = storage.read_bytes_at_version
    manifest_reads = 0

    def churn_live_manifest(rel_prefix: str):
        manifest = Manifest.model_validate_json(storage.objects["manifest.json"])
        manifest.files.live.generated_utc = "2026-07-14T12:00:30Z"
        storage.put("manifest.json", manifest)
        yield from original_iter(rel_prefix)

    def churn_historic_manifest_after_read(
        rel_key: str,
        expected_version: StoredObjectVersion,
    ) -> bytes:
        nonlocal manifest_reads
        raw = original_read(rel_key, expected_version)
        if rel_key == "manifest.json":
            manifest_reads += 1
            if manifest_reads == 2:
                manifest = Manifest.model_validate_json(raw)
                manifest.files.historic.network_trend = "historic/alternate-network-trend.json"
                storage.put("manifest.json", manifest)
        return raw

    storage.iter_object_versions = churn_live_manifest  # type: ignore[method-assign]
    storage.read_bytes_at_version = churn_historic_manifest_after_read  # type: ignore[method-assign]

    with pytest.raises(HistoricGcBlockedError, match="manifest_changed_after_inventory"):
        plan_historic_generation_gc(
            storage,
            now=NOW,
            mode="mark",
            provider_id="stm",
        )


def test_gc_blocks_manifest_provider_change_after_inventory() -> None:
    storage, _paths = _build_graph()
    original_iter = storage.iter_object_versions

    def replace_manifest(rel_prefix: str):
        manifest = Manifest.model_validate_json(storage.objects["manifest.json"])
        manifest.provider = "octranspo"
        storage.put("manifest.json", manifest)
        yield from original_iter(rel_prefix)

    storage.iter_object_versions = replace_manifest  # type: ignore[method-assign]

    with pytest.raises(HistoricGcBlockedError, match="manifest_changed_after_inventory"):
        plan_historic_generation_gc(
            storage,
            now=NOW,
            mode="mark",
            provider_id="stm",
        )


def test_gc_blocks_historic_manifest_pointer_change_after_inventory() -> None:
    storage, _paths = _build_graph()
    original_iter = storage.iter_object_versions

    def replace_manifest(rel_prefix: str):
        manifest = Manifest.model_validate_json(storage.objects["manifest.json"])
        manifest.files.historic.network_trend = "historic/alternate-network-trend.json"
        storage.put("manifest.json", manifest)
        yield from original_iter(rel_prefix)

    storage.iter_object_versions = replace_manifest  # type: ignore[method-assign]

    with pytest.raises(HistoricGcBlockedError, match="manifest_changed_after_inventory"):
        plan_historic_generation_gc(
            storage,
            now=NOW,
            mode="mark",
            provider_id="stm",
        )


def test_gc_blocks_a_manifest_that_appears_during_inventory() -> None:
    storage, _paths = _build_graph()
    manifest = Manifest.model_validate_json(storage.objects.pop("manifest.json"))
    storage.versions.pop("manifest.json")
    original_iter = storage.iter_object_versions

    def add_manifest(rel_prefix: str):
        storage.put("manifest.json", manifest)
        yield from original_iter(rel_prefix)

    storage.iter_object_versions = add_manifest  # type: ignore[method-assign]

    with pytest.raises(HistoricGcBlockedError, match="manifest_changed_after_inventory"):
        plan_historic_generation_gc(
            storage,
            now=NOW,
            mode="mark",
            provider_id="octranspo",
        )


def test_gc_blocks_a_root_version_change_at_the_final_race_gate() -> None:
    storage, _paths = _build_graph()
    original_capture = storage.capture_object_version
    changed = False

    def change_root(rel_key: str) -> StoredObjectVersion | None:
        nonlocal changed
        if rel_key == "historic/history/index.json" and not changed:
            changed = True
            storage.versions[rel_key] = replace(storage.versions[rel_key], etag="changed")
        return original_capture(rel_key)

    storage.capture_object_version = change_root  # type: ignore[method-assign]

    with pytest.raises(
        HistoricGcBlockedError,
        match="object_changed_after_inventory:historic/history/index.json",
    ):
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")


def test_gc_reports_the_first_sorted_candidate_failure_despite_completion_order() -> None:
    storage, _paths = _build_graph()
    malformed_paths: list[str] = []
    for raw in (b"not-json-a", b"not-json-b"):
        digest = hashlib.sha256(raw).hexdigest()
        path = f"historic/history/network/generations/{digest}/2025-01.json"
        storage.put(path, raw)
        malformed_paths.append(path)
    first = min(malformed_paths)
    original_read = storage.read_bytes_at_version

    def delay_first(rel_key: str, version: StoredObjectVersion) -> bytes:
        if rel_key == first:
            time.sleep(0.02)
        return original_read(rel_key, version)

    storage.read_bytes_at_version = delay_first  # type: ignore[method-assign]

    with pytest.raises(HistoricGcBlockedError, match="malformed_payload") as error:
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")

    assert first in str(error.value)


def test_gc_blocks_optional_legacy_root_that_appears_during_inventory() -> None:
    storage, _paths = _build_graph()
    original_iter = storage.iter_object_versions
    partition = NetworkHistoryPartition(
        generated_utc=STAMP,
        methodology_version="history-1",
        month="2025-02",
        days=[NetworkHistoryDay(date="2025-02-01", delay=_delay())],
    )
    ref = history_partition_ref(
        f"historic/history/network/generations/{snapshot_sha256(partition)}/2025-02.json",
        partition,
    )
    index = _collection("network", selection_mode="range", refs=[ref])
    exact_path = history_pointer_path("historic/history/network", index)

    def add_legacy_root(rel_prefix: str):
        storage.put(ref.path, partition)
        storage.put(exact_path, index)
        storage.put("historic/history/network/index.json", index)
        yield from original_iter(rel_prefix)

    storage.iter_object_versions = add_legacy_root  # type: ignore[method-assign]

    with pytest.raises(HistoricGcBlockedError, match="optional_root_changed_after_inventory"):
        plan_historic_generation_gc(
            storage,
            now=NOW,
            mode="mark",
            provider_id="stm",
        )


def test_gc_reads_and_rejects_unreachable_generation_with_wrong_directory_digest() -> None:
    storage, paths = _build_graph()
    storage.put(paths["orphan"], b'{"wrong":true}')

    with pytest.raises(HistoricGcBlockedError, match="generation_digest_mismatch"):
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")


def test_gc_reads_and_rejects_malformed_unreachable_generation() -> None:
    storage, _paths = _build_graph()
    raw = b"not-json"
    digest = hashlib.sha256(raw).hexdigest()
    storage.put(f"historic/history/network/generations/{digest}/2025-01.json", raw)

    with pytest.raises(HistoricGcBlockedError, match="malformed_payload"):
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")


def test_gc_reads_and_rejects_unreachable_generation_with_wrong_path_identity() -> None:
    storage, _paths = _build_graph()
    payload = NetworkHistoryPartition(
        generated_utc=STAMP,
        methodology_version="history-1",
        month="2025-02",
        days=[NetworkHistoryDay(date="2025-02-01", delay=_delay())],
    )
    digest = snapshot_sha256(payload)
    storage.put(
        f"historic/history/network/generations/{digest}/2025-01.json",
        payload,
    )

    with pytest.raises(HistoricGcBlockedError, match="gate_failed"):
        plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id="stm")


def test_publish_clear_restarts_unreachable_age_after_a_generation_was_referenced() -> None:
    storage, paths = _build_graph()
    first = plan_historic_generation_gc(
        storage,
        now=NOW,
        mode="mark",
        provider_id="stm",
    )
    marks = dict(first.next_marks)

    class MarkConnection:
        def execute(self, _statement, parameters):  # noqa: ANN001, ANN202
            for path in parameters["object_keys"]:
                marks.pop(path, None)

    publish._clear_referenced_historic_gc_marks(  # noqa: SLF001
        MarkConnection(), "stm", [paths["orphan"]]
    )
    later = NOW + timedelta(hours=49)
    unreachable_again = plan_historic_generation_gc(
        storage,
        now=later,
        mode="mark",
        existing_marks=marks,
        provider_id="stm",
    )

    assert unreachable_again.eligible_keys == ()
    assert unreachable_again.next_marks[paths["orphan"]].first_unreachable_utc == later
