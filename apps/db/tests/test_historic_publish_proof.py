from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass, replace
from datetime import UTC, datetime
from http.client import HTTPException, IncompleteRead, InvalidURL
from multiprocessing import get_context
from threading import Event
from time import monotonic, sleep
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

import transit_ops.validation.historic_publish as historic_publish_module
from transit_ops.settings import Settings
from transit_ops.snapshots.builders.historic.alert_archive import _collection_generation_id
from transit_ops.snapshots.builders.historic.history_common import (
    PointHistorySummary,
    encode_history_entity_id,
    history_coverage,
    history_entity_directory_generation_id,
    history_index_generation_id,
    history_metric_coverage,
    history_partition_ref,
    history_pointer_path,
)
from transit_ops.snapshots.contract import (
    AlertArchiveEntry,
    AlertArchiveIndex,
    AlertArchiveMonth,
    AlertArchivePage,
    AlertArchivePageRef,
    AlertHistory,
    AlertHistoryEntry,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricDelayMetric,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricFamilyAvailability,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    HistorySelectionMode,
    LineHistoryDay,
    LineHistoryPartition,
    Manifest,
    ManifestFiles,
    ManifestHistoricFiles,
    ManifestLiveFiles,
    NetworkHistoryDay,
    NetworkHistoryPartition,
    Receipt,
    ReceiptsIndex,
    RouteReliability,
    RouteReliabilityIndex,
    StopHistoryDay,
    StopHistoryPartition,
)
from transit_ops.snapshots.gate import check_alert_archive_index
from transit_ops.snapshots.serialization import snapshot_sha256
from transit_ops.validation.historic_publish import (
    AlertExpectations,
    MigrationEvidence,
    build_historic_publish_proof,
)

GENERATED_UTC = "2026-07-13T06:00:00Z"
POINT_OLD_GENERATED_UTC = "2026-05-02T04:00:00Z"
POINT_NEW_GENERATED_UTC = "2026-07-13T05:00:00Z"
PUBLISH_GENERATION_ID = f"stm@{GENERATED_UTC}"
NOW_UTC = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)


@dataclass
class PublicFixture:
    public_bytes: dict[str, bytes]
    page_paths: tuple[str, ...]
    point_index_paths: dict[str, str]
    point_day_paths: dict[str, tuple[str, ...]]
    range_graph_paths: dict[str, tuple[str, ...]]
    fetch_calls: list[str]
    collection_generation_id: str
    expectations_reader: Callable[..., AlertExpectations]


def _json_bytes(model: object) -> bytes:
    return model.model_dump_json().encode("utf-8")  # type: ignore[attr-defined]


def _point_history_family(
    family: str,
) -> tuple[HistoricCollectionIndex, str, dict[str, bytes], tuple[str, ...]]:
    summary = PointHistorySummary(family)
    public_bytes: dict[str, bytes] = {}
    paths: list[str] = []
    for local_date, generated_utc in (
        ("2026-05-01", POINT_OLD_GENERATED_UTC),
        ("2026-07-13", POINT_NEW_GENERATED_UTC),
    ):
        if family == "hotspots":
            payload = HistoricHotspotsDay(
                generated_utc=generated_utc,
                methodology_version="reliability-1",
                date=local_date,
                hotspots=[],
                by_grain=[],
            )
        else:
            payload = HistoricRepeatOffendersDay(
                generated_utc=generated_utc,
                methodology_version="reliability-1",
                date=local_date,
                offenders=[],
                by_grain=[],
            )
        ref = summary.observe(payload)
        public_bytes[ref.path] = _json_bytes(payload)
        paths.append(ref.path)

    index = summary.build_index(fallback_generated_utc=GENERATED_UTC)
    index.publish_generation_id = PUBLISH_GENERATION_ID
    index_path = history_pointer_path(f"historic/history/{family}", index)
    public_bytes[index_path] = _json_bytes(index)
    return index, index_path, public_bytes, tuple(paths)


def _delay(*, stop: bool = False) -> HistoricDelayMetric:
    return HistoricDelayMetric(
        observation_count=1,
        in_clamp_observation_count=1,
        on_time_count=None if stop else 1,
        severe_count=0,
        sum_delay_seconds=0,
    )


def _range_collection(
    family: str,
    *,
    entity_id: str | None = None,
    refs: list | None = None,  # type: ignore[type-arg]
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
    index = HistoricCollectionIndex(
        generated_utc=GENERATED_UTC,
        methodology_version="history-1",
        publish_generation_id=PUBLISH_GENERATION_ID,
        family=family,
        selection_mode="range",
        entity_id=entity_id,
        first_available_date=dates[0] if dates else None,
        last_available_date=dates[-1] if dates else None,
        available_dates=dates,
        partitions=refs,
        metrics=[
            history_metric_coverage(metric, aggregation, dates if metric == "delay" else [])
            for metric, aggregation in aggregations[family]
        ],
    )
    index.collection_generation_id = history_index_generation_id(index)
    return index


def _range_directory(
    family: str,
    *,
    entity_id: str,
    child: HistoricCollectionIndex,
    child_path: str,
) -> HistoricEntityDirectoryIndex:
    directory = HistoricEntityDirectoryIndex(
        generated_utc=GENERATED_UTC,
        methodology_version="history-1",
        publish_generation_id=PUBLISH_GENERATION_ID,
        family=family,
        selection_mode="range",
        collection_generation_id="pending",
        first_available_date=child.first_available_date,
        last_available_date=child.last_available_date,
        entities=[
            HistoricEntityIndexRef(
                entity_id=entity_id,
                encoded_id=encode_history_entity_id(entity_id),
                index_path=child_path,
                collection_generation_id=child.collection_generation_id or "",
                first_available_date=child.first_available_date,
                last_available_date=child.last_available_date,
            )
        ],
    )
    directory.collection_generation_id = history_entity_directory_generation_id(directory)
    return directory


def _range_history_graph() -> tuple[
    dict[str, HistoricFamilyAvailability],
    dict[str, bytes],
    dict[str, tuple[str, ...]],
]:
    public_bytes: dict[str, bytes] = {}
    graph_paths: dict[str, tuple[str, ...]] = {}

    network_partition = NetworkHistoryPartition(
        generated_utc=GENERATED_UTC,
        methodology_version="history-1",
        month="2026-07",
        days=[NetworkHistoryDay(date="2026-07-01", delay=_delay())],
    )
    network_partition_path = (
        f"historic/history/network/generations/{snapshot_sha256(network_partition)}/2026-07.json"
    )
    network_ref = history_partition_ref(network_partition_path, network_partition)
    network = _range_collection("network", refs=[network_ref])
    network_path = history_pointer_path("historic/history/network", network)
    public_bytes[network_path] = _json_bytes(network)
    public_bytes[network_partition_path] = _json_bytes(network_partition)
    graph_paths["network"] = (network_path, network_partition_path)

    line_id = "51"
    line_encoded = encode_history_entity_id(line_id)
    line_partition = LineHistoryPartition(
        generated_utc=GENERATED_UTC,
        methodology_version="history-1",
        month="2026-07",
        entity_id=line_id,
        days=[LineHistoryDay(date="2026-07-01", delay=_delay())],
    )
    line_partition_path = (
        f"historic/history/lines/{line_encoded}/generations/"
        f"{snapshot_sha256(line_partition)}/2026-07.json"
    )
    line_ref = history_partition_ref(line_partition_path, line_partition)
    line_index = _range_collection("lines", entity_id=line_id, refs=[line_ref])
    line_index_path = history_pointer_path(f"historic/history/lines/{line_encoded}", line_index)
    lines = _range_directory(
        "lines",
        entity_id=line_id,
        child=line_index,
        child_path=line_index_path,
    )
    lines_path = history_pointer_path("historic/history/lines", lines)
    for path, payload in (
        (lines_path, lines),
        (line_index_path, line_index),
        (line_partition_path, line_partition),
    ):
        public_bytes[path] = _json_bytes(payload)
    graph_paths["lines"] = (lines_path, line_index_path, line_partition_path)

    stop_id = "stop:1"
    stop_encoded = encode_history_entity_id(stop_id)
    stop_partition = StopHistoryPartition(
        generated_utc=GENERATED_UTC,
        methodology_version="history-1",
        month="2026-07",
        entity_id=stop_id,
        days=[StopHistoryDay(date="2026-07-01", delay=_delay(stop=True))],
    )
    stop_partition_path = (
        f"historic/history/stops/{stop_encoded}/generations/"
        f"{snapshot_sha256(stop_partition)}/2026-07.json"
    )
    stop_ref = history_partition_ref(stop_partition_path, stop_partition)
    stop_index = _range_collection("stops", entity_id=stop_id, refs=[stop_ref])
    stop_index_path = history_pointer_path(f"historic/history/stops/{stop_encoded}", stop_index)
    stops = _range_directory(
        "stops",
        entity_id=stop_id,
        child=stop_index,
        child_path=stop_index_path,
    )
    stops_path = history_pointer_path("historic/history/stops", stops)
    for path, payload in (
        (stops_path, stops),
        (stop_index_path, stop_index),
        (stop_partition_path, stop_partition),
    ):
        public_bytes[path] = _json_bytes(payload)
    graph_paths["stops"] = (stops_path, stop_index_path, stop_partition_path)

    edges = {
        "network": HistoricFamilyAvailability(
            family="network",
            selection_mode="range",
            index_path=network_path,
            collection_generation_id=network.collection_generation_id,
            first_available_date=network.first_available_date,
            last_available_date=network.last_available_date,
            gaps=network.gaps,
            metrics=network.metrics,
        ),
        "lines": HistoricFamilyAvailability(
            family="lines",
            selection_mode="range",
            index_path=lines_path,
            collection_generation_id=lines.collection_generation_id,
            first_available_date=lines.first_available_date,
            last_available_date=lines.last_available_date,
            gaps=line_index.gaps,
            metrics=line_index.metrics,
        ),
        "stops": HistoricFamilyAvailability(
            family="stops",
            selection_mode="range",
            index_path=stops_path,
            collection_generation_id=stops.collection_generation_id,
            first_available_date=stops.first_available_date,
            last_available_date=stops.last_available_date,
            gaps=stop_index.gaps,
            metrics=stop_index.metrics,
        ),
    }
    return edges, public_bytes, graph_paths


def _archive_entry(alert_id: str, *, month: str) -> AlertArchiveEntry:
    return AlertArchiveEntry(
        id=alert_id,
        severity="watch",
        header_text=f"Avis {alert_id}",
        header_text_en=f"Alert {alert_id}",
        description=f"Description {alert_id}",
        description_en=f"English description {alert_id}",
        routes=["10"],
        stops=["1001"],
        start_utc=f"{month}-01T08:00:00Z",
        end_utc=f"{month}-01T09:00:00Z",
        first_seen_utc=f"{month}-01T07:55:00Z",
        last_seen_utc=f"{month}-01T09:05:00Z",
    )


def _page_and_ref(
    alert_id: str,
    *,
    month: str,
    page_number: int,
) -> tuple[str, AlertArchivePage, AlertArchivePageRef]:
    page = AlertArchivePage(
        generated_utc=GENERATED_UTC,
        methodology_version="alerts-1",
        month=month,
        page=page_number,
        alerts=[_archive_entry(alert_id, month=month)],
    )
    raw = _json_bytes(page)
    digest = hashlib.sha256(raw).hexdigest()
    path = f"historic/alerts/generations/{digest}/{month}/page-{page_number:04d}.json"
    ref = AlertArchivePageRef(
        path=path,
        page=page_number,
        count=1,
        byte_size=len(raw),
        sha256=digest,
        coverage_start=f"{month}-01",
        coverage_end=f"{month}-01",
    )
    return path, page, ref


def _manifest() -> Manifest:
    return Manifest(
        provider="stm",
        display_name="STM",
        bbox=[45.4, -73.9, 45.8, -73.4],
        attribution="Société de transport de Montréal",
        dataset_version="fixture",
        labels={},
        surfaces=["reliability", "accountability"],
        files=ManifestFiles(
            live=ManifestLiveFiles(generated_utc=GENERATED_UTC),
            historic=ManifestHistoricFiles(
                generated_utc="2026-07-12T06:00:00+00:00",
            ),
        ),
    )


def _complete_public_fixture(*, empty_alerts: bool = False) -> PublicFixture:
    page_paths: tuple[str, ...]
    public_bytes: dict[str, bytes] = {}
    if empty_alerts:
        months: list[AlertArchiveMonth] = []
        collection_generation_id = _collection_generation_id(months, None, None)
        alert_index = AlertArchiveIndex(
            generated_utc=GENERATED_UTC,
            collection_generation_id=collection_generation_id,
            first_available_date=None,
            last_available_date=None,
            total_alerts=0,
            months=[],
        )
        alert_history = AlertHistory(
            generated_utc=GENERATED_UTC,
            alerts=[],
            window_start=None,
            window_end=None,
            total_in_window=0,
            truncated=False,
        )
        page_paths = ()
    else:
        may_path, may_page, may_ref = _page_and_ref(
            "alert-may",
            month="2026-05",
            page_number=1,
        )
        july_path, july_page, july_ref = _page_and_ref(
            "alert-july",
            month="2026-07",
            page_number=1,
        )
        public_bytes[may_path] = _json_bytes(may_page)
        public_bytes[july_path] = _json_bytes(july_page)
        page_paths = (may_path, july_path)
        months = [
            AlertArchiveMonth(month="2026-07", total_alerts=1, pages=[july_ref]),
            AlertArchiveMonth(month="2026-05", total_alerts=1, pages=[may_ref]),
        ]
        collection_generation_id = _collection_generation_id(
            months,
            "2026-05-01",
            "2026-07-13",
        )
        alert_index = AlertArchiveIndex(
            generated_utc=GENERATED_UTC,
            collection_generation_id=collection_generation_id,
            first_available_date="2026-05-01",
            last_available_date="2026-07-13",
            total_alerts=2,
            months=months,
        )
        alert_history = AlertHistory(
            generated_utc=GENERATED_UTC,
            alerts=[
                AlertHistoryEntry(
                    id="legacy-may",
                    header_text="Avis mai",
                    description="Description mai",
                ),
                AlertHistoryEntry(
                    id="legacy-july",
                    header_text_en="July alert",
                    description_en="July description",
                ),
            ],
            window_start="2026-05-01",
            window_end="2026-07-13",
            total_in_window=2,
            truncated=False,
        )

    receipts_index = ReceiptsIndex(
        generated_utc=GENERATED_UTC,
        collection_generation_id="b" * 64,
        dates=["2026-05-01", "2026-07-13"],
    )
    _, _, receipt_gaps = history_coverage(receipts_index.dates)
    hotspots_index, hotspots_index_path, hotspots_bytes, hotspots_paths = _point_history_family(
        "hotspots"
    )
    repeat_index, repeat_index_path, repeat_bytes, repeat_paths = _point_history_family(
        "repeat_offenders"
    )
    range_edges, range_bytes, range_graph_paths = _range_history_graph()
    history_root = HistoricAvailabilityIndex(
        generated_utc=GENERATED_UTC,
        methodology_version="history-1",
        publish_generation_id=PUBLISH_GENERATION_ID,
        families=[
            HistoricFamilyAvailability(
                family="alerts",
                selection_mode=HistorySelectionMode.range,
                index_path="historic/alerts/index.json",
                collection_generation_id=collection_generation_id,
                first_available_date=alert_index.first_available_date,
                last_available_date=alert_index.last_available_date,
            ),
            HistoricFamilyAvailability(
                family="hotspots",
                selection_mode=HistorySelectionMode.date,
                index_path=hotspots_index_path,
                collection_generation_id=hotspots_index.collection_generation_id,
                first_available_date=hotspots_index.first_available_date,
                last_available_date=hotspots_index.last_available_date,
                gaps=hotspots_index.gaps,
            ),
            range_edges["lines"],
            range_edges["network"],
            HistoricFamilyAvailability(
                family="receipts",
                selection_mode=HistorySelectionMode.date,
                index_path="historic/receipts/index.json",
                collection_generation_id=receipts_index.collection_generation_id,
                first_available_date=receipts_index.dates[0],
                last_available_date=receipts_index.dates[-1],
                gaps=receipt_gaps,
            ),
            HistoricFamilyAvailability(
                family="repeat_offenders",
                selection_mode=HistorySelectionMode.date,
                index_path=repeat_index_path,
                collection_generation_id=repeat_index.collection_generation_id,
                first_available_date=repeat_index.first_available_date,
                last_available_date=repeat_index.last_available_date,
                gaps=repeat_index.gaps,
            ),
            range_edges["stops"],
        ],
    )

    public_bytes.update(hotspots_bytes)
    public_bytes.update(repeat_bytes)
    public_bytes.update(range_bytes)
    public_bytes.update(
        {
            "manifest.json": _json_bytes(_manifest()),
            "historic/alerts/index.json": _json_bytes(alert_index),
            "historic/alert_history.json": _json_bytes(alert_history),
            "historic/history/index.json": _json_bytes(history_root),
            "historic/receipts/index.json": _json_bytes(receipts_index),
            "historic/receipts/2026-05-01.json": _json_bytes(
                Receipt(generated_utc=GENERATED_UTC, date="2026-05-01")
            ),
            "historic/receipts/2026-07-13.json": _json_bytes(
                Receipt(generated_utc=GENERATED_UTC, date="2026-07-13")
            ),
            "historic/route_reliability/index.json": _json_bytes(
                RouteReliabilityIndex(
                    generated_utc=GENERATED_UTC,
                    route_ids=["10", "747"],
                )
            ),
            "historic/route_reliability/10.json": _json_bytes(
                RouteReliability(generated_utc=GENERATED_UTC, id="10")
            ),
            "historic/route_reliability/747.json": _json_bytes(
                RouteReliability(generated_utc=GENERATED_UTC, id="747")
            ),
        }
    )
    fetch_calls: list[str] = []

    if empty_alerts:

        def expectations_reader(provider_id, generated_utc, engine):  # noqa: ANN001
            return AlertExpectations(
                collection_generation_id=collection_generation_id,
                total_alerts=0,
                first_available_date=None,
                last_available_date=None,
                archive_source_text_count=0,
                archive_description_count=0,
                legacy_alert_count=0,
                legacy_source_text_count=0,
                legacy_description_count=0,
            )

    else:

        def expectations_reader(provider_id, generated_utc, engine):  # noqa: ANN001
            return AlertExpectations(
                collection_generation_id=collection_generation_id,
                total_alerts=2,
                first_available_date="2026-05-01",
                last_available_date="2026-07-13",
                archive_source_text_count=2,
                archive_description_count=2,
                legacy_alert_count=2,
                legacy_source_text_count=2,
                legacy_description_count=2,
            )

    return PublicFixture(
        public_bytes=public_bytes,
        page_paths=page_paths,
        point_index_paths={
            "hotspots": hotspots_index_path,
            "repeat_offenders": repeat_index_path,
        },
        point_day_paths={
            "hotspots": hotspots_paths,
            "repeat_offenders": repeat_paths,
        },
        range_graph_paths=range_graph_paths,
        fetch_calls=fetch_calls,
        collection_generation_id=collection_generation_id,
        expectations_reader=expectations_reader,
    )


def _with_large_network_graph(
    fixture: PublicFixture,
    *,
    partition_count: int = 40,
) -> tuple[str, ...]:
    partition_paths: list[str] = []
    refs = []
    for offset in range(partition_count):
        year = 2020 + offset // 12
        month_number = offset % 12 + 1
        month = f"{year:04d}-{month_number:02d}"
        payload = NetworkHistoryPartition(
            generated_utc=GENERATED_UTC,
            methodology_version="history-1",
            month=month,
            days=[NetworkHistoryDay(date=f"{month}-01", delay=_delay())],
        )
        path = f"historic/history/network/generations/{snapshot_sha256(payload)}/{month}.json"
        refs.append(history_partition_ref(path, payload))
        fixture.public_bytes[path] = _json_bytes(payload)
        partition_paths.append(path)

    network = _range_collection("network", refs=refs)
    network_path = history_pointer_path("historic/history/network", network)
    fixture.public_bytes[network_path] = _json_bytes(network)

    root_path = "historic/history/index.json"
    root = HistoricAvailabilityIndex.model_validate_json(fixture.public_bytes[root_path])
    edge = next(item for item in root.families if item.family == "network")
    edge.index_path = network_path
    edge.collection_generation_id = network.collection_generation_id
    edge.first_available_date = network.first_available_date
    edge.last_available_date = network.last_available_date
    edge.gaps = network.gaps
    edge.metrics = network.metrics
    _replace_public_model(fixture, root_path, root)
    fixture.range_graph_paths["network"] = (network_path, *partition_paths)
    return tuple(partition_paths)


def _with_interior_point_day(
    fixture: PublicFixture,
    family: str = "hotspots",
) -> str:
    summary = PointHistorySummary(family)
    payloads: list[HistoricHotspotsDay | HistoricRepeatOffendersDay] = []
    model_type = HistoricHotspotsDay if family == "hotspots" else HistoricRepeatOffendersDay
    for path in fixture.point_day_paths[family]:
        payloads.append(model_type.model_validate_json(fixture.public_bytes[path]))
    if family == "hotspots":
        payloads.append(
            HistoricHotspotsDay(
                generated_utc="2026-06-01T04:00:00Z",
                methodology_version="reliability-1",
                date="2026-06-01",
                hotspots=[],
                by_grain=[],
            )
        )
    else:
        payloads.append(
            HistoricRepeatOffendersDay(
                generated_utc="2026-06-01T04:00:00Z",
                methodology_version="reliability-1",
                date="2026-06-01",
                offenders=[],
                by_grain=[],
            )
        )

    observed_paths: list[str] = []
    middle_path = ""
    for payload in sorted(payloads, key=lambda item: item.date):
        ref = summary.observe(payload)
        fixture.public_bytes[ref.path] = _json_bytes(payload)
        observed_paths.append(ref.path)
        if payload.date == "2026-06-01":
            middle_path = ref.path

    index = summary.build_index(fallback_generated_utc=GENERATED_UTC)
    index.publish_generation_id = PUBLISH_GENERATION_ID
    index_path = history_pointer_path(f"historic/history/{family}", index)
    fixture.public_bytes[index_path] = _json_bytes(index)
    fixture.point_index_paths[family] = index_path
    fixture.point_day_paths[family] = tuple(observed_paths)

    root_path = "historic/history/index.json"
    root = HistoricAvailabilityIndex.model_validate_json(fixture.public_bytes[root_path])
    edge = next(item for item in root.families if item.family == family)
    edge.index_path = index_path
    edge.collection_generation_id = index.collection_generation_id
    edge.first_available_date = index.first_available_date
    edge.last_available_date = index.last_available_date
    edge.gaps = index.gaps
    edge.metrics = index.metrics
    _replace_public_model(fixture, root_path, root)
    return middle_path


def _sync_receipt() -> dict[str, object]:
    return {
        "provider_id": "stm",
        "requested_from": "2026-05-01",
        "requested_to": "2026-07-13",
        "source_from": "2026-05-01",
        "source_to": "2026-07-13",
        "source_count": 2,
        "inserted_count": 1,
        "updated_count": 1,
        "unchanged_count": 0,
        "dry_run": False,
        "synced_at_utc": "2026-07-13T11:00:00+00:00",
    }


def _gate_report(fixture: PublicFixture) -> dict[str, object]:
    return {
        "provider_id": "stm",
        "tier": "historic",
        "generated_utc": GENERATED_UTC,
        "checks_run": 24,
        "payloads_checked": 11,
        "errors": 0,
        "warnings": 0,
        "results": [],
        "payload_sha256": dict(
            sorted(
                (
                    path,
                    hashlib.sha256(raw).hexdigest(),
                )
                for path, raw in fixture.public_bytes.items()
                if path != "manifest.json"
            )
        ),
    }


def _empty_sync_receipt() -> dict[str, object]:
    receipt = _sync_receipt()
    receipt.update(
        {
            "source_from": None,
            "source_to": None,
            "source_count": 0,
            "inserted_count": 0,
            "updated_count": 0,
            "unchanged_count": 0,
        }
    )
    return receipt


def _build_report(
    fixture: PublicFixture,
    *,
    sync_receipt: dict[str, object] | None = None,
    gate_report: dict[str, object] | None = None,
    migration_reader: Callable[..., MigrationEvidence] | None = None,
    fetch_override: Callable[[str], bytes] | None = None,
    public_base_url: str = "https://data.example.com",
    proof_timeout_seconds: float | None = None,
    monotonic_clock: Callable[[], float] | None = None,
    isolate_process: bool = False,
):
    def default_migration_reader(settings, engine):  # noqa: ANN001
        return MigrationEvidence(
            ("0081_snapshot_publish_stable_files",),
            ("0081_snapshot_publish_stable_files",),
        )

    def fetch_bytes(url: str) -> bytes:
        fixture.fetch_calls.append(url)
        if fetch_override is not None:
            return fetch_override(url)
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        return fixture.public_bytes[path]

    deadline_options: dict[str, object] = {}
    if proof_timeout_seconds is not None:
        deadline_options["proof_timeout_seconds"] = proof_timeout_seconds
    if monotonic_clock is not None:
        deadline_options["monotonic"] = monotonic_clock
    deadline_options["isolate_process"] = isolate_process
    if isolate_process:
        deadline_options["isolation_start_method"] = "fork"
    return build_historic_publish_proof(
        "stm",
        sync_receipt=sync_receipt or _sync_receipt(),
        gate_report=gate_report if gate_report is not None else _gate_report(fixture),
        settings=Settings(
            _env_file=None,
            DATABASE_URL="postgresql://proof:secret@localhost/transit",
            SNAPSHOT_PUBLIC_BASE_URL=public_base_url,
        ),
        engine=object(),  # type: ignore[arg-type]
        fetch_bytes=fetch_bytes,
        migration_reader=migration_reader or default_migration_reader,
        expectations_reader=fixture.expectations_reader,
        now_utc=NOW_UTC,
        **deadline_options,
    )


def test_historic_publish_proof_passes_complete_public_contract() -> None:
    fixture = _complete_public_fixture()

    report = _build_report(fixture)

    assert report.status == "pass"
    assert report.failures == ()
    assert report.migration == {
        "repository_heads": ["0081_snapshot_publish_stable_files"],
        "database_heads": ["0081_snapshot_publish_stable_files"],
        "heads_match": True,
    }
    assert report.sync["count_arithmetic_valid"] is True
    assert report.gate["errors"] == 0
    assert report.gate["checks_run"] == 24
    assert report.gate["payloads_checked"] == 11
    assert report.public["deadline"]["budget_seconds"] == 35 * 60
    assert report.public["deadline"]["exceeded"] is False
    assert report.public["deadline"]["failure"] is None
    compatibility_indexes = {
        name: report.public["indexes"][name] for name in ("alerts", "receipts", "route_reliability")
    }
    assert {details["generated_utc"] for details in compatibility_indexes.values()} == {
        GENERATED_UTC
    }
    history_root = report.public.get("history_root")
    assert isinstance(history_root, dict)
    assert history_root["path"] == "historic/history/index.json"
    assert history_root["publish_generation_id"] == PUBLISH_GENERATION_ID
    assert [family["family"] for family in history_root["families"]] == [
        "alerts",
        "hotspots",
        "lines",
        "network",
        "receipts",
        "repeat_offenders",
        "stops",
    ]
    for family in ("hotspots", "repeat_offenders"):
        index_evidence = report.public["indexes"].get(family)
        assert isinstance(index_evidence, dict)
        assert index_evidence["path"] == fixture.point_index_paths[family]
        assert index_evidence["generated_utc"] == POINT_NEW_GENERATED_UTC
        assert index_evidence["generated_utc"] != GENERATED_UTC
        assert index_evidence["publish_generation_id"] == PUBLISH_GENERATION_ID
        assert index_evidence["available_dates"] == ["2026-05-01", "2026-07-13"]
        assert index_evidence["partition_count"] == 2
    assert report.public.get("boundary_hotspots") == ["2026-05-01", "2026-07-13"]
    assert report.public.get("boundary_repeat_offenders") == [
        "2026-05-01",
        "2026-07-13",
    ]
    for paths in fixture.point_day_paths.values():
        for path in paths:
            artifact = report.public["artifacts"].get(path)
            assert isinstance(artifact, dict)
            assert artifact["sha256_matches"] is True
            assert artifact["byte_size_matches"] is True
            assert artifact["date_matches"] is True
    assert set(fixture.page_paths) <= set(report.public["artifacts"])
    for page_path in fixture.page_paths:
        artifact = report.public["artifacts"][page_path]
        assert artifact["sha256_matches"] is True
        assert artifact["byte_size_matches"] is True
        assert artifact["count_matches"] is True
    assert report.public["boundary_receipts"] == ["2026-05-01", "2026-07-13"]
    assert report.public["boundary_routes"] == ["10", "747"]
    assert report.source_messages["archive"]["status"] == "ok"
    assert report.source_messages["archive"]["database_description_count"] == 2
    assert report.source_messages["archive"]["public_description_count"] == 2
    assert report.source_messages["legacy"]["status"] == "ok"
    assert report.source_messages["legacy"]["database_description_count"] == 2
    assert report.source_messages["legacy"]["public_description_count"] == 2
    assert "secret" not in str(report.display_dict())


def test_historic_publish_proof_walks_every_range_index_and_the_small_fixture_partitions() -> None:
    fixture = _complete_public_fixture()

    report = _build_report(fixture)

    assert report.status == "pass"
    for paths in fixture.range_graph_paths.values():
        assert set(paths) <= set(report.public["artifacts"])
        for path in paths:
            assert report.public["artifacts"][path]["status"] == "pass"


def test_historic_publish_proof_bounds_remote_partition_fetches_for_large_graph() -> None:
    fixture = _complete_public_fixture()
    network_paths = _with_large_network_graph(fixture)

    report = _build_report(fixture)

    fetched_paths = [urlsplit(url).path.split("/v1/stm/", 1)[1] for url in fixture.fetch_calls]
    fetched_network_partitions = [path for path in fetched_paths if path in network_paths]
    evidence = report.public.get("range_partition_remote_sample")
    assert isinstance(evidence, dict)
    assert len(fetched_network_partitions) <= 8
    assert evidence["remote_existence_scope"] == "deterministic_samples_only"
    assert evidence["candidate_count"] == len(network_paths) + 2
    assert evidence["gate_digest_bound_count"] == evidence["candidate_count"]
    assert evidence["families"]["network"]["candidate_count"] == len(network_paths)
    assert evidence["families"]["network"]["sample_count"] == len(fetched_network_partitions)


def test_historic_publish_proof_deadline_cancels_bounded_fetches_without_waiting() -> None:
    fixture = _complete_public_fixture()
    blocked_paths = {paths[0] for paths in fixture.range_graph_paths.values()}
    release = Event()

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path in blocked_paths:
            release.wait(timeout=5)
        return fixture.public_bytes[path]

    started = monotonic()
    try:
        report = _build_report(
            fixture,
            fetch_override=fetch_override,
            proof_timeout_seconds=0.25,
        )
    finally:
        elapsed = monotonic() - started
        release.set()

    assert elapsed < 1
    assert report.status == "fail"
    assert "historic_proof_deadline_exceeded" in report.failures
    deadline = report.public["deadline"]
    assert deadline["budget_seconds"] == 0.25
    assert deadline["exceeded"] is True
    assert deadline["failure"] == "historic_proof_deadline_exceeded"
    assert deadline["skipped_request_count"] > 0
    assert deadline["abandoned_request_count"] > 0
    assert any(
        "historic_proof_deadline_exceeded" in artifact["failures"]
        for artifact in report.public["artifacts"].values()
    )


def test_bounded_fetch_deadline_never_queues_a_later_worker_window() -> None:
    release = Event()
    fetch_calls: list[str] = []
    artifacts: dict[str, dict[str, object]] = {}
    failures: list[str] = []
    requests = [(f"historic/receipts/{index}.json", Receipt) for index in range(32)]

    def blocked_fetch(url: str) -> bytes:
        fetch_calls.append(url)
        release.wait(timeout=5)
        return b"{}"

    deadline = historic_publish_module._HistoricProofDeadline(  # noqa: SLF001
        budget_seconds=0.1,
        monotonic=monotonic,
    )
    token = historic_publish_module._ACTIVE_PROOF_DEADLINE.set(deadline)  # noqa: SLF001
    started = monotonic()
    try:
        results = historic_publish_module._fetch_models_bounded(  # noqa: SLF001
            requests,
            public_root="https://data.example.com/v1/stm/",
            fetch_bytes=blocked_fetch,
            artifacts=artifacts,
            failures=failures,
            query="proof=deadline",
            gate_digests={},
        )
    finally:
        elapsed = monotonic() - started
        release.set()
        historic_publish_module._ACTIVE_PROOF_DEADLINE.reset(token)  # noqa: SLF001

    assert elapsed < 1
    assert len(results) == len(requests)
    assert len(fetch_calls) <= 8
    assert failures == ["historic_proof_deadline_exceeded"]
    evidence = deadline.evidence()
    assert evidence["max_batch_size"] <= 8
    assert evidence["skipped_request_count"] >= len(requests) - 8


def test_historic_publish_proof_fails_when_final_fetch_crosses_deadline() -> None:
    fixture = _complete_public_fixture()
    clock_value = [0.0]

    def monotonic_clock() -> float:
        return clock_value[0]

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == "historic/route_reliability/747.json":
            clock_value[0] = 2.0
        return fixture.public_bytes[path]

    report = _build_report(
        fixture,
        fetch_override=fetch_override,
        proof_timeout_seconds=1.0,
        monotonic_clock=monotonic_clock,
    )

    assert report.status == "fail"
    assert "historic_proof_deadline_exceeded" in report.failures
    assert report.public["deadline"]["exceeded"] is True


def test_whole_proof_deadline_bounds_stalled_migration_reader() -> None:
    fixture = _complete_public_fixture()
    context = get_context("fork")
    entered = context.Event()

    def stalled_migration_reader(settings, engine):  # noqa: ANN001, ARG001
        entered.set()
        sleep(1)
        return MigrationEvidence(
            ("0081_snapshot_publish_stable_files",),
            ("0081_snapshot_publish_stable_files",),
        )

    started = monotonic()
    report = _build_report(
        fixture,
        migration_reader=stalled_migration_reader,
        proof_timeout_seconds=0.1,
        isolate_process=True,
    )
    elapsed = monotonic() - started

    assert entered.is_set()
    assert elapsed < 0.4
    assert report.status == "fail"
    assert report.failures == ("historic_proof_deadline_exceeded",)
    assert report.public["deadline"]["whole_proof_process_terminated_count"] == 1


def test_whole_proof_deadline_bounds_stalled_direct_fetch() -> None:
    fixture = _complete_public_fixture()
    context = get_context("fork")
    entered = context.Event()

    def stalled_fetch(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == "manifest.json":
            entered.set()
            sleep(1)
        return fixture.public_bytes[path]

    started = monotonic()
    report = _build_report(
        fixture,
        fetch_override=stalled_fetch,
        proof_timeout_seconds=0.1,
        isolate_process=True,
    )
    elapsed = monotonic() - started

    assert entered.is_set()
    assert elapsed < 0.4
    assert report.status == "fail"
    assert report.failures == ("historic_proof_deadline_exceeded",)
    assert report.public["deadline"]["whole_proof_process_terminated_count"] == 1


def test_isolated_whole_proof_returns_the_complete_success_report() -> None:
    fixture = _complete_public_fixture()

    report = _build_report(fixture, isolate_process=True)

    assert report.status == "pass"
    assert report.failures == ()
    assert report.public["deadline"]["exceeded"] is False
    assert report.public["deadline"]["whole_proof_process_terminated_count"] == 0
    assert report.public["deadline"]["isolation_start_method"] == "fork"
    assert report.source_messages["archive"]["status"] == "ok"


def test_isolated_whole_proof_removes_outcome_file_when_process_start_fails(
    monkeypatch, tmp_path
) -> None:
    original_named_temporary_file = historic_publish_module.NamedTemporaryFile

    def tracked_named_temporary_file(*args, **kwargs):  # noqa: ANN002, ANN003
        return original_named_temporary_file(*args, dir=tmp_path, **kwargs)

    class StartFailingProcess:
        def start(self) -> None:
            assert list(tmp_path.glob("historic-publish-proof-*.json"))
            raise OSError("unable to start proof process")

    class StartFailingContext:
        @staticmethod
        def Process(*args, **kwargs):  # noqa: ANN002, ANN003, N802
            return StartFailingProcess()

    monkeypatch.setattr(
        historic_publish_module,
        "NamedTemporaryFile",
        tracked_named_temporary_file,
    )
    monkeypatch.setattr(
        historic_publish_module,
        "get_context",
        lambda _start_method: StartFailingContext(),
    )

    with pytest.raises(OSError, match="unable to start proof process"):
        build_historic_publish_proof(
            "stm",
            sync_receipt={},
            gate_report={},
            now_utc=NOW_UTC,
        )

    assert list(tmp_path.iterdir()) == []


def test_whole_proof_uses_spawn_by_default_without_injected_process_state() -> None:
    fixture = _complete_public_fixture()

    report = build_historic_publish_proof(
        "stm",
        sync_receipt=_sync_receipt(),
        gate_report=_gate_report(fixture),
        settings=Settings(_env_file=None),
        now_utc=NOW_UTC,
        proof_timeout_seconds=5,
    )

    assert report.status == "fail"
    assert "historic_proof_deadline_exceeded" not in report.failures
    assert "database_url_missing" in report.failures
    assert "snapshot_public_base_url_missing" in report.failures
    assert report.public["deadline"]["isolation_start_method"] == "spawn"


def test_historic_publish_partition_samples_are_seeded_deterministic_and_include_boundaries() -> (
    None
):
    first_fixture = _complete_public_fixture()
    network_paths = _with_large_network_graph(first_fixture)
    first = _build_report(first_fixture)

    repeat_fixture = _complete_public_fixture()
    _with_large_network_graph(repeat_fixture)
    repeat = _build_report(repeat_fixture)

    other_fixture = _complete_public_fixture()
    _with_large_network_graph(other_fixture)
    other_gate = _gate_report(other_fixture)
    other_gate["generated_utc"] = "2026-07-13T06:01:00Z"
    other = _build_report(other_fixture, gate_report=other_gate)

    first_evidence = first.public.get("range_partition_remote_sample")
    repeat_evidence = repeat.public.get("range_partition_remote_sample")
    other_evidence = other.public.get("range_partition_remote_sample")
    assert isinstance(first_evidence, dict)
    assert isinstance(repeat_evidence, dict)
    assert isinstance(other_evidence, dict)
    first_paths = first_evidence["sampled_paths"]
    repeat_paths = repeat_evidence["sampled_paths"]
    other_paths = other_evidence["sampled_paths"]
    assert first_paths == repeat_paths
    assert first_paths != other_paths
    assert network_paths[0] in first_paths
    assert network_paths[-1] in first_paths
    assert any(path not in {network_paths[0], network_paths[-1]} for path in first_paths)


def test_historic_publish_binds_range_refs_through_exact_parent_indexes() -> None:
    fixture = _complete_public_fixture()
    gate_report = _gate_report(fixture)
    payload_sha256 = gate_report["payload_sha256"]
    assert isinstance(payload_sha256, dict)
    range_partition_paths = {
        path
        for paths in fixture.range_graph_paths.values()
        for path in paths
        if not path.endswith("/index.json")
    }
    for path in range_partition_paths:
        payload_sha256.pop(path)

    report = _build_report(fixture, gate_report=gate_report)
    fetched_paths = {urlsplit(url).path.split("/v1/stm/", 1)[1] for url in fixture.fetch_calls}

    assert report.status == "pass"
    assert not any("range_partition_gate_digest" in failure for failure in report.failures)
    evidence = report.public["range_partition_remote_sample"]
    assert evidence["binding_source"] == "exact_gate_bound_parent_indexes"
    assert evidence["gate_digest_bound_count"] == evidence["candidate_count"]
    assert evidence["parent_index_count"] == 3
    assert range_partition_paths <= fetched_paths


def test_historic_publish_rejects_forged_range_ref_via_parent_index_digest() -> None:
    fixture = _complete_public_fixture()
    gate_report = _gate_report(fixture)
    payload_sha256 = gate_report["payload_sha256"]
    assert isinstance(payload_sha256, dict)
    range_partition_paths = {
        path
        for paths in fixture.range_graph_paths.values()
        for path in paths
        if not path.endswith("/index.json")
    }
    for path in range_partition_paths:
        payload_sha256.pop(path)

    stop_child_index_path = fixture.range_graph_paths["stops"][1]
    stop_child_index = HistoricCollectionIndex.model_validate_json(
        fixture.public_bytes[stop_child_index_path]
    )
    stop_child_index.partitions[0].sha256 = "0" * 64
    _replace_public_model(fixture, stop_child_index_path, stop_child_index)

    report = _build_report(fixture, gate_report=gate_report)

    assert report.status == "fail"
    assert "public_gate_digest_mismatch" in report.failures
    assert "public_range_partition_parent_index_unbound" in report.failures
    artifact = report.public["artifacts"][stop_child_index_path]
    assert artifact["gate_sha256_matches"] is False
    evidence = report.public["range_partition_remote_sample"]
    assert evidence["binding_source"] == "exact_gate_bound_parent_indexes"
    assert evidence["gate_digest_failure_count"] == 1
    assert evidence["gate_digest_mismatch_count"] == 1


def test_historic_publish_binds_unsampled_point_ref_to_exact_gate_digest() -> None:
    fixture = _complete_public_fixture()
    unsampled_path = _with_interior_point_day(fixture)
    gate_report = _gate_report(fixture)
    payload_sha256 = gate_report["payload_sha256"]
    assert isinstance(payload_sha256, dict)
    payload_sha256[unsampled_path] = "0" * 64

    report = _build_report(fixture, gate_report=gate_report)
    fetched_paths = {urlsplit(url).path.split("/v1/stm/", 1)[1] for url in fixture.fetch_calls}

    assert report.status == "fail"
    assert "public_point_partition_gate_digest_mismatch" in report.failures
    assert unsampled_path not in fetched_paths
    binding = report.public["indexes"]["hotspots"]["partition_gate_binding"]
    assert binding["candidate_count"] == 3
    assert binding["gate_digest_bound_count"] == 2
    assert binding["gate_digest_mismatch_count"] == 1
    assert unsampled_path in binding["gate_digest_failure_paths"]


@pytest.mark.parametrize("family", ["network", "lines", "stops"])
def test_historic_publish_proof_fails_when_range_history_child_is_unreadable(
    family: str,
) -> None:
    fixture = _complete_public_fixture()
    target = fixture.range_graph_paths[family][-1]

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == target:
            raise OSError("unreadable public child")
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "fail"
    assert "public_artifact_fetch_failed" in report.failures
    assert report.public["artifacts"][target]["status"] == "fail"


def test_historic_publish_proof_accepts_incremental_sync_over_accumulated_archive() -> None:
    fixture = _complete_public_fixture()
    sync_receipt = _sync_receipt()
    sync_receipt.update(
        {
            "source_from": "2026-07-13",
            "source_to": "2026-07-13",
            "source_count": 1,
            "inserted_count": 0,
            "updated_count": 0,
            "unchanged_count": 1,
        }
    )

    report = _build_report(fixture, sync_receipt=sync_receipt)

    assert report.status == "pass"
    assert "sync_source_count_mismatch" not in report.failures
    assert "sync_source_bounds_mismatch" not in report.failures


@pytest.mark.parametrize(
    ("expectation_field", "failure"),
    [
        ("archive_source_text_count", "archive_source_text_count_mismatch"),
        ("archive_description_count", "archive_source_description_count_mismatch"),
        ("legacy_source_text_count", "legacy_source_text_count_mismatch"),
        ("legacy_description_count", "legacy_source_description_count_mismatch"),
    ],
)
def test_historic_publish_proof_requires_exact_source_message_count_parity(
    expectation_field: str,
    failure: str,
) -> None:
    fixture = _complete_public_fixture()
    original_reader = fixture.expectations_reader

    def expectations_reader(provider_id, generated_utc, engine):  # noqa: ANN001
        expected = original_reader(provider_id, generated_utc, engine)
        return replace(expected, **{expectation_field: 1})

    fixture.expectations_reader = expectations_reader

    report = _build_report(fixture)

    assert report.status == "fail"
    assert failure in report.failures
    section = "archive" if expectation_field.startswith("archive_") else "legacy"
    assert report.source_messages[section]["status"] == "mismatch"


def test_historic_publish_message_status_rejects_alert_total_mismatch() -> None:
    fixture = _complete_public_fixture()
    original_reader = fixture.expectations_reader

    def expectations_reader(provider_id, generated_utc, engine):  # noqa: ANN001
        expected = original_reader(provider_id, generated_utc, engine)
        return replace(expected, total_alerts=expected.total_alerts + 1)

    fixture.expectations_reader = expectations_reader

    report = _build_report(fixture)

    assert report.status == "fail"
    assert report.source_messages["archive"]["status"] == "mismatch"


def test_historic_publish_proof_treats_honest_empty_alerts_as_no_data() -> None:
    fixture = _complete_public_fixture(empty_alerts=True)

    report = _build_report(fixture, sync_receipt=_empty_sync_receipt())

    assert report.status == "pass"
    assert report.public["indexes"]["alerts"]["first_available_date"] is None
    assert report.public["indexes"]["alerts"]["last_available_date"] is None
    assert report.public["indexes"]["alerts"]["page_count"] == 0
    assert report.source_messages["archive"]["status"] == "no_data"
    assert report.source_messages["legacy"]["status"] == "no_data"
    assert not any(
        "/historic/alerts/generations/" in urlsplit(url).path for url in fixture.fetch_calls
    )


def test_historic_publish_proof_rejects_forged_archive_generation_binding() -> None:
    fixture = _complete_public_fixture()
    index_path = "historic/alerts/index.json"
    index = AlertArchiveIndex.model_validate_json(fixture.public_bytes[index_path])
    original_generation = index.collection_generation_id
    forged_paths: list[str] = []

    for month in index.months:
        for ref in month.pages:
            page = AlertArchivePage.model_validate_json(fixture.public_bytes.pop(ref.path))
            page.alerts[0].id = f"forged-{page.alerts[0].id}"
            raw = _json_bytes(page)
            digest = hashlib.sha256(raw).hexdigest()
            forged_path = (
                f"historic/alerts/generations/{digest}/{page.month}/page-{page.page:04d}.json"
            )
            ref.path = forged_path
            ref.byte_size = len(raw)
            ref.sha256 = digest
            fixture.public_bytes[forged_path] = raw
            forged_paths.append(forged_path)

    assert index.collection_generation_id == original_generation
    canonical_findings = check_alert_archive_index(index, rel_key=index_path)
    assert "collection_generation_id" in {finding.check for finding in canonical_findings}
    _replace_public_model(fixture, index_path, index)
    fixture.page_paths = tuple(forged_paths)

    report = _build_report(fixture)

    assert report.status == "fail"
    assert "public_archive_generation_binding_mismatch" in report.failures
    assert (
        "public_archive_generation_binding_mismatch"
        in report.public["artifacts"][index_path]["failures"]
    )


@pytest.mark.parametrize(
    "target",
    [
        "alerts_index",
        "receipts_index",
        "route_index",
        "alert_history",
        "alert_page_oldest",
        "alert_page_newest",
        "receipt_oldest",
        "receipt_newest",
        "route_oldest",
        "route_newest",
        "history_root",
        "hotspots_history_index",
        "repeat_offenders_history_index",
        "hotspots_day_oldest",
        "hotspots_day_newest",
        "repeat_offenders_day_oldest",
        "repeat_offenders_day_newest",
    ],
)
def test_historic_publish_proof_binds_every_fetched_task6_artifact_to_gate_digest(
    target: str,
) -> None:
    fixture = _complete_public_fixture()
    target_paths = {
        "alerts_index": "historic/alerts/index.json",
        "receipts_index": "historic/receipts/index.json",
        "route_index": "historic/route_reliability/index.json",
        "alert_history": "historic/alert_history.json",
        "alert_page_oldest": fixture.page_paths[0],
        "alert_page_newest": fixture.page_paths[-1],
        "receipt_oldest": "historic/receipts/2026-05-01.json",
        "receipt_newest": "historic/receipts/2026-07-13.json",
        "route_oldest": "historic/route_reliability/10.json",
        "route_newest": "historic/route_reliability/747.json",
        "history_root": "historic/history/index.json",
        "hotspots_history_index": fixture.point_index_paths["hotspots"],
        "repeat_offenders_history_index": fixture.point_index_paths["repeat_offenders"],
        "hotspots_day_oldest": fixture.point_day_paths["hotspots"][0],
        "hotspots_day_newest": fixture.point_day_paths["hotspots"][-1],
        "repeat_offenders_day_oldest": fixture.point_day_paths["repeat_offenders"][0],
        "repeat_offenders_day_newest": fixture.point_day_paths["repeat_offenders"][-1],
    }
    path = target_paths[target]
    gate_report = _gate_report(fixture)
    payload_sha256 = gate_report["payload_sha256"]
    assert isinstance(payload_sha256, dict)
    payload_sha256[path] = "0" * 64

    report = _build_report(fixture, gate_report=gate_report)

    assert report.status == "fail"
    assert "public_gate_digest_mismatch" in report.failures
    artifact = report.public["artifacts"][path]
    assert artifact["failures"] == ["public_gate_digest_mismatch"]
    assert artifact["gate_sha256_matches"] is False


def test_historic_publish_proof_accepts_advertised_published_empty_point_days() -> None:
    fixture = _complete_public_fixture()

    for path in fixture.point_day_paths["hotspots"]:
        payload = HistoricHotspotsDay.model_validate_json(fixture.public_bytes[path])
        assert payload.hotspots == []
        assert payload.by_grain == []
    for path in fixture.point_day_paths["repeat_offenders"]:
        payload = HistoricRepeatOffendersDay.model_validate_json(fixture.public_bytes[path])
        assert payload.offenders == []
        assert payload.by_grain == []

    report = _build_report(fixture)

    assert report.status == "pass"
    assert report.public["boundary_hotspots"] == ["2026-05-01", "2026-07-13"]
    assert report.public["boundary_repeat_offenders"] == ["2026-05-01", "2026-07-13"]


def test_historic_publish_proof_rejects_wrong_nonempty_point_root_edge() -> None:
    fixture = _complete_public_fixture()
    root_path = "historic/history/index.json"
    root = HistoricAvailabilityIndex.model_validate_json(fixture.public_bytes[root_path])
    hotspots = next(family for family in root.families if family.family == "hotspots")
    hotspots.collection_generation_id = "f" * 64
    _replace_public_model(fixture, root_path, root)

    report = _build_report(fixture)

    assert report.status == "fail"
    assert "public_history_point_edge_mismatch" in report.failures
    assert "public_history_point_edge_mismatch" in report.public["artifacts"][root_path]["failures"]


def test_historic_publish_proof_rejects_point_index_bytes_at_old_digest_path() -> None:
    fixture = _complete_public_fixture()
    index_path = fixture.point_index_paths["hotspots"]
    index = HistoricCollectionIndex.model_validate_json(fixture.public_bytes[index_path])
    index.generated_utc = POINT_OLD_GENERATED_UTC
    _replace_public_model(fixture, index_path, index)

    report = _build_report(fixture)

    assert report.status == "fail"
    assert "public_point_index_path_digest_mismatch" in report.failures
    assert (
        "public_point_index_path_digest_mismatch"
        in report.public["artifacts"][index_path]["failures"]
    )


def test_historic_publish_proof_rejects_point_day_bytes_at_old_ref_path() -> None:
    fixture = _complete_public_fixture()
    day_path = fixture.point_day_paths["hotspots"][0]
    payload = HistoricHotspotsDay.model_validate_json(fixture.public_bytes[day_path])
    payload.generated_utc = "2026-05-02T03:00:00+00:00"
    _replace_public_model(fixture, day_path, payload)

    report = _build_report(fixture)

    assert report.status == "fail"
    assert "public_point_day_sha256_mismatch" in report.failures
    artifact = report.public["artifacts"][day_path]
    assert "public_point_day_sha256_mismatch" in artifact["failures"]
    assert artifact["sha256_matches"] is False


@pytest.mark.parametrize(
    ("mutation", "artifact_failure"),
    [
        ("missing_mapping", "public_gate_digest_missing"),
        ("malformed_digest", "public_gate_digest_invalid"),
    ],
)
def test_historic_publish_proof_rejects_missing_or_malformed_gate_digest_receipt(
    mutation: str,
    artifact_failure: str,
) -> None:
    fixture = _complete_public_fixture()
    path = "historic/alerts/index.json"
    gate_report = _gate_report(fixture)
    if mutation == "missing_mapping":
        gate_report.pop("payload_sha256")
    else:
        payload_sha256 = gate_report["payload_sha256"]
        assert isinstance(payload_sha256, dict)
        payload_sha256[path] = "not-a-sha256"

    report = _build_report(fixture, gate_report=gate_report)

    assert report.status == "fail"
    assert "gate_payload_sha256_invalid" in report.failures
    assert artifact_failure in report.public["artifacts"][path]["failures"]


@pytest.mark.parametrize(
    ("label", "single_encoded", "double_encoded"),
    [
        (
            "dot",
            "historic/alerts/%2e/page.json",
            "historic/alerts/%252e/page.json",
        ),
        (
            "dot_dot",
            "historic/alerts/%2e%2e/page.json",
            "historic/alerts/%252e%252e/page.json",
        ),
        (
            "slash",
            "historic%2falerts/index.json",
            "historic%252falerts/index.json",
        ),
        (
            "backslash",
            "historic/alerts/%5csecret.json",
            "historic/alerts/%255csecret.json",
        ),
        (
            "query",
            "historic/alerts/index.json%3fproof=attacker",
            "historic/alerts/index.json%253fproof=attacker",
        ),
        (
            "fragment",
            "historic/alerts/index.json%23fragment",
            "historic/alerts/index.json%2523fragment",
        ),
        (
            "colon",
            "historic/alerts/%3aevil.json",
            "historic/alerts/%253aevil.json",
        ),
        (
            "at",
            "historic/alerts/%40evil.json",
            "historic/alerts/%2540evil.json",
        ),
        (
            "authority",
            "%2f%2fevil.example/historic/index.json",
            "%252f%252fevil.example/historic/index.json",
        ),
    ],
)
def test_safe_public_path_rejects_single_and_double_encoded_reserved_delimiters(
    label: str,
    single_encoded: str,
    double_encoded: str,
) -> None:
    for path in (single_encoded, double_encoded):
        with pytest.raises(ValueError, match="unsafe_public_path"):
            historic_publish_module._safe_public_path(path)


def test_safe_public_path_preserves_content_addressed_alert_page() -> None:
    path = f"historic/alerts/generations/{'a' * 64}/2026-07/page-0001.json"

    assert historic_publish_module._safe_public_path(path) == path


def test_historic_publish_proof_uses_one_unique_cache_buster_for_every_fetch() -> None:
    first = _complete_public_fixture()
    second = _complete_public_fixture()

    assert _build_report(first).status == "pass"
    assert _build_report(second).status == "pass"

    proof_tokens: list[str] = []
    for calls in (first.fetch_calls, second.fetch_calls):
        parsed_queries = [parse_qs(urlsplit(url).query) for url in calls]
        assert parsed_queries
        assert all(set(query) == {"proof"} for query in parsed_queries)
        run_tokens = {query["proof"][0] for query in parsed_queries}
        assert len(run_tokens) == 1
        token = run_tokens.pop()
        assert token
        proof_tokens.append(token)
    assert proof_tokens[0] != proof_tokens[1]


def _replace_public_model(fixture: PublicFixture, path: str, model: object) -> None:
    fixture.public_bytes[path] = _json_bytes(model)


@pytest.mark.parametrize(
    ("label", "unsafe_path"),
    [
        ("space_raw", "historic/alerts/index evil.json"),
        ("space_encoded", "historic/alerts/index%20evil.json"),
        ("space_double_encoded", "historic/alerts/index%2520evil.json"),
        ("tab_raw", "historic/alerts/index\tevil.json"),
        ("tab_encoded", "historic/alerts/index%09evil.json"),
        ("tab_double_encoded", "historic/alerts/index%2509evil.json"),
        ("crlf_raw", "historic/alerts/index\r\nevil.json"),
        ("crlf_encoded", "historic/alerts/index%0d%0aevil.json"),
        ("crlf_double_encoded", "historic/alerts/index%250d%250aevil.json"),
        ("nul_raw", "historic/alerts/index\x00evil.json"),
        ("nul_encoded", "historic/alerts/index%00evil.json"),
        ("nul_double_encoded", "historic/alerts/index%2500evil.json"),
        ("del_raw", "historic/alerts/index\x7fevil.json"),
        ("del_encoded", "historic/alerts/index%7fevil.json"),
        ("del_double_encoded", "historic/alerts/index%257fevil.json"),
    ],
)
def test_historic_publish_proof_rejects_control_paths_before_url_construction(
    label: str,
    unsafe_path: str,
) -> None:
    fixture = _complete_public_fixture()
    default_index_path = "historic/alerts/index.json"
    alert_index_bytes = fixture.public_bytes[default_index_path]
    manifest = Manifest.model_validate_json(fixture.public_bytes["manifest.json"])
    manifest.files.historic.alerts_index = unsafe_path
    _replace_public_model(fixture, "manifest.json", manifest)

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        return fixture.public_bytes.get(path, alert_index_bytes)

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "fail"
    artifact = report.public["artifacts"][unsafe_path]
    assert artifact["url"] is None
    assert artifact["status"] == "fail"
    assert artifact["failures"] == ["unsafe_public_path"]


def _header_only_fixture() -> PublicFixture:
    fixture = _complete_public_fixture()
    index_path = "historic/alerts/index.json"
    index = AlertArchiveIndex.model_validate_json(fixture.public_bytes[index_path])
    page_paths: list[str] = []
    for month in index.months:
        for ref in month.pages:
            page = AlertArchivePage.model_validate_json(fixture.public_bytes.pop(ref.path))
            for alert in page.alerts:
                alert.description = None
                alert.description_en = None
            raw = _json_bytes(page)
            digest = hashlib.sha256(raw).hexdigest()
            path = f"historic/alerts/generations/{digest}/{page.month}/page-{page.page:04d}.json"
            ref.path = path
            ref.byte_size = len(raw)
            ref.sha256 = digest
            fixture.public_bytes[path] = raw
            page_paths.append(path)
    index.collection_generation_id = _collection_generation_id(
        index.months,
        index.first_available_date,
        index.last_available_date,
    )
    _replace_public_model(fixture, index_path, index)
    fixture.collection_generation_id = index.collection_generation_id
    root_path = "historic/history/index.json"
    root = HistoricAvailabilityIndex.model_validate_json(fixture.public_bytes[root_path])
    alerts_edge = next(edge for edge in root.families if edge.family == "alerts")
    alerts_edge.collection_generation_id = index.collection_generation_id
    _replace_public_model(fixture, root_path, root)

    history_path = "historic/alert_history.json"
    history = AlertHistory.model_validate_json(fixture.public_bytes[history_path])
    for alert in history.alerts:
        alert.description = None
        alert.description_en = None
    _replace_public_model(fixture, history_path, history)

    def expectations_reader(provider_id, generated_utc, engine):  # noqa: ANN001
        return _nonempty_expectations(
            collection_generation_id=fixture.collection_generation_id,
            archive_description_count=0,
            legacy_description_count=0,
        )

    fixture.page_paths = tuple(page_paths)
    fixture.expectations_reader = expectations_reader
    return fixture


def test_historic_publish_proof_accepts_header_only_alert_sources() -> None:
    fixture = _header_only_fixture()

    report = _build_report(fixture)

    assert report.status == "pass"
    assert "archive_source_description_missing" not in report.failures
    assert "legacy_source_description_missing" not in report.failures
    assert report.source_messages["archive"]["status"] == "ok"
    assert report.source_messages["archive"]["database_description_count"] == 0
    assert report.source_messages["archive"]["public_description_count"] == 0
    assert report.source_messages["legacy"]["status"] == "ok"
    assert report.source_messages["legacy"]["database_description_count"] == 0
    assert report.source_messages["legacy"]["public_description_count"] == 0


def _nonempty_expectations(
    *,
    collection_generation_id: str,
    **overrides: object,
) -> AlertExpectations:
    values: dict[str, object] = {
        "collection_generation_id": collection_generation_id,
        "total_alerts": 2,
        "first_available_date": "2026-05-01",
        "last_available_date": "2026-07-13",
        "archive_source_text_count": 2,
        "archive_description_count": 2,
        "legacy_alert_count": 2,
        "legacy_source_text_count": 2,
        "legacy_description_count": 2,
    }
    values.update(overrides)
    return AlertExpectations(**values)  # type: ignore[arg-type]


def build_mutated_report(mutation: str):
    fixture = _complete_public_fixture()
    sync_receipt = _sync_receipt()
    gate_report = _gate_report(fixture)
    migration_reader = None

    if mutation == "migration_mismatch":

        def migration_reader(settings, engine):  # noqa: ANN001
            return MigrationEvidence(
                ("0081_snapshot_publish_stable_files",),
                ("0080_alert_archive",),
            )

    elif mutation == "sync_provider":
        sync_receipt["provider_id"] = "other"
    elif mutation == "sync_dry_run":
        sync_receipt["dry_run"] = True
    elif mutation == "sync_arithmetic":
        sync_receipt["source_count"] = 3
    elif mutation == "stale_sync":
        sync_receipt["synced_at_utc"] = "2026-07-13T04:00:00+00:00"
    elif mutation == "gate_provider":
        gate_report["provider_id"] = "other"
    elif mutation == "gate_tier":
        gate_report["tier"] = "static"
    elif mutation == "gate_errors":
        gate_report["errors"] = 1
    elif mutation == "stale_gate":
        gate_report["generated_utc"] = "2026-07-11T00:00:00+00:00"
    elif mutation == "index_generation":
        index = ReceiptsIndex.model_validate_json(
            fixture.public_bytes["historic/receipts/index.json"]
        )
        index.generated_utc = "2026-07-12T00:00:00+00:00"
        _replace_public_model(fixture, "historic/receipts/index.json", index)
    elif mutation in {
        "archive_generation",
        "unsafe_page",
        "page_sha",
        "page_size",
        "page_count",
    }:
        index = AlertArchiveIndex.model_validate_json(
            fixture.public_bytes["historic/alerts/index.json"]
        )
        if mutation == "archive_generation":
            index.collection_generation_id = "f" * 64
        elif mutation == "unsafe_page":
            index.months[0].pages[0].path = "../page.json"
        elif mutation == "page_sha":
            index.months[0].pages[0].sha256 = "f" * 64
        elif mutation == "page_size":
            index.months[0].pages[0].byte_size += 1
        else:
            index.months[0].pages[0].count += 1
        _replace_public_model(fixture, "historic/alerts/index.json", index)
    elif mutation in {"archive_description", "archive_text"}:
        for page_path in fixture.page_paths:
            page = AlertArchivePage.model_validate_json(fixture.public_bytes[page_path])
            for alert in page.alerts:
                alert.description = None
                alert.description_en = None
                if mutation == "archive_text":
                    alert.header_text = None
                    alert.header_text_en = None
            _replace_public_model(fixture, page_path, page)
    elif mutation in {"legacy_description", "legacy_text"}:
        history = AlertHistory.model_validate_json(
            fixture.public_bytes["historic/alert_history.json"]
        )
        for alert in history.alerts:
            alert.description = None
            alert.description_en = None
            if mutation == "legacy_text":
                alert.header_text = None
                alert.header_text_en = None
        _replace_public_model(fixture, "historic/alert_history.json", history)
    else:  # pragma: no cover - the parametrized table is the exhaustive caller
        raise AssertionError(f"unknown mutation: {mutation}")

    return _build_report(
        fixture,
        sync_receipt=sync_receipt,
        gate_report=gate_report,
        migration_reader=migration_reader,
    )


@pytest.mark.parametrize(
    ("mutation", "failure"),
    [
        ("migration_mismatch", "migration_head_mismatch"),
        ("sync_provider", "sync_provider_mismatch"),
        ("sync_dry_run", "sync_dry_run"),
        ("sync_arithmetic", "sync_count_mismatch"),
        ("stale_sync", "sync_receipt_stale"),
        ("gate_provider", "gate_provider_mismatch"),
        ("gate_tier", "gate_tier_mismatch"),
        ("gate_errors", "gate_failed"),
        ("stale_gate", "gate_generation_stale"),
        ("index_generation", "public_index_generation_mismatch"),
        ("archive_generation", "public_archive_generation_mismatch"),
        ("unsafe_page", "unsafe_public_path"),
        ("page_sha", "alert_page_sha256_mismatch"),
        ("page_size", "alert_page_byte_size_mismatch"),
        ("page_count", "alert_page_count_mismatch"),
        ("archive_description", "archive_source_description_missing"),
        ("legacy_description", "legacy_source_description_missing"),
        ("archive_text", "archive_source_text_missing"),
        ("legacy_text", "legacy_source_text_missing"),
    ],
)
def test_historic_publish_proof_fails_closed(mutation: str, failure: str) -> None:
    report = build_mutated_report(mutation)
    assert report.status == "fail"
    assert failure in report.failures


@pytest.mark.parametrize(
    ("mutation", "section"),
    [
        ("archive_text", "archive"),
        ("legacy_text", "legacy"),
    ],
)
def test_historic_publish_proof_marks_nonempty_zero_text_section_missing(
    mutation: str,
    section: str,
) -> None:
    report = build_mutated_report(mutation)

    assert report.source_messages[section]["status"] == "missing"


def test_unsorted_duplicate_indexes_fail_closed_and_fetch_true_boundaries() -> None:
    fixture = _complete_public_fixture()
    receipt_index_path = "historic/receipts/index.json"
    route_index_path = "historic/route_reliability/index.json"
    receipt_index = ReceiptsIndex.model_validate_json(fixture.public_bytes[receipt_index_path])
    receipt_index.dates = [
        "2026-06-01",
        "2026-07-13",
        "2026-05-01",
        "2026-06-01",
    ]
    route_index = RouteReliabilityIndex.model_validate_json(fixture.public_bytes[route_index_path])
    route_index.route_ids = ["20", "747", "10", "20"]
    _replace_public_model(fixture, receipt_index_path, receipt_index)
    _replace_public_model(fixture, route_index_path, route_index)
    fixture.public_bytes["historic/receipts/2026-06-01.json"] = _json_bytes(
        Receipt(generated_utc=GENERATED_UTC, date="2026-06-01")
    )
    fixture.public_bytes["historic/route_reliability/20.json"] = _json_bytes(
        RouteReliability(generated_utc=GENERATED_UTC, id="20")
    )

    report = _build_report(fixture)

    assert report.status == "fail"
    assert {
        "receipts_index_order_invalid",
        "receipts_index_duplicate_values",
        "route_reliability_index_order_invalid",
        "route_reliability_index_duplicate_values",
    } <= set(report.failures)
    assert report.public["boundary_receipts"] == ["2026-05-01", "2026-07-13"]
    assert report.public["boundary_routes"] == ["10", "747"]
    fetched_paths = {urlsplit(url).path.split("/v1/stm/", 1)[1] for url in fixture.fetch_calls}
    assert {
        "historic/receipts/2026-05-01.json",
        "historic/receipts/2026-07-13.json",
        "historic/route_reliability/10.json",
        "historic/route_reliability/747.json",
    } <= fetched_paths
    assert (
        "receipts_index_order_invalid" in report.public["artifacts"][receipt_index_path]["failures"]
    )
    assert (
        "route_reliability_index_duplicate_values"
        in report.public["artifacts"][route_index_path]["failures"]
    )


@pytest.mark.parametrize(
    ("mutation", "failure", "artifact_path"),
    [
        (
            "malformed_json",
            "public_artifact_invalid",
            "historic/receipts/index.json",
        ),
        (
            "contract_failure",
            "public_artifact_invalid",
            "historic/route_reliability/index.json",
        ),
        (
            "wrong_receipt_date",
            "receipt_date_mismatch",
            "historic/receipts/2026-05-01.json",
        ),
        (
            "wrong_route_id",
            "route_reliability_id_mismatch",
            "historic/route_reliability/10.json",
        ),
    ],
)
def test_historic_publish_proof_records_public_contract_failures_as_artifact_evidence(
    mutation: str,
    failure: str,
    artifact_path: str,
) -> None:
    fixture = _complete_public_fixture()
    if mutation == "malformed_json":
        fixture.public_bytes[artifact_path] = b"{"
    elif mutation == "contract_failure":
        fixture.public_bytes[artifact_path] = (
            b'{"generated_utc":"2026-07-13T06:00:00+00:00","route_ids":"wrong"}'
        )
    elif mutation == "wrong_receipt_date":
        _replace_public_model(
            fixture,
            artifact_path,
            Receipt(generated_utc=GENERATED_UTC, date="2026-05-02"),
        )
    else:
        _replace_public_model(
            fixture,
            artifact_path,
            RouteReliability(generated_utc=GENERATED_UTC, id="11"),
        )

    report = _build_report(fixture)

    assert report.status == "fail"
    assert failure in report.failures
    assert failure in report.public["artifacts"][artifact_path]["failures"]


def test_historic_publish_proof_records_http_failure_without_leaking_exception() -> None:
    fixture = _complete_public_fixture()
    failed_path = "historic/receipts/index.json"

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == failed_path:
            raise HTTPError(url, 503, "unavailable", hdrs=None, fp=None)
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "fail"
    assert "public_artifact_fetch_failed" in report.failures
    artifact = report.public["artifacts"][failed_path]
    assert artifact["failures"] == ["public_artifact_fetch_failed"]
    assert artifact["error_type"] == "HTTPError"
    assert artifact["http_status"] == 503
    assert "unavailable" not in str(report.display_dict())


def test_historic_publish_proof_accepts_missing_live_owned_manifest() -> None:
    fixture = _complete_public_fixture()

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == "manifest.json":
            raise HTTPError(url, 404, "not found", hdrs=None, fp=None)
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "pass"
    assert "public_artifact_fetch_failed" not in report.failures
    assert report.public["manifest"] == {}
    manifest_artifact = report.public["artifacts"]["manifest.json"]
    assert manifest_artifact["status"] == "optional_absent"
    assert manifest_artifact["http_status"] == 404
    assert manifest_artifact["failures"] == []
    assert report.public["artifacts"]["historic/history/index.json"]["status"] == "pass"


@pytest.mark.parametrize(
    ("failed_path", "http_status"),
    [
        ("manifest.json", 403),
        ("manifest.json", 503),
        ("historic/history/index.json", 404),
    ],
)
def test_historic_publish_proof_only_allows_manifest_not_found(
    failed_path: str,
    http_status: int,
) -> None:
    fixture = _complete_public_fixture()

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == failed_path:
            raise HTTPError(url, http_status, "unavailable", hdrs=None, fp=None)
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "fail"
    assert "public_artifact_fetch_failed" in report.failures
    artifact = report.public["artifacts"][failed_path]
    assert artifact["status"] == "fail"
    assert artifact["http_status"] == http_status
    assert artifact["failures"] == ["public_artifact_fetch_failed"]


def test_public_fetch_sends_explicit_transit_user_agent(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    request_headers: dict[str, str | None] = {}

    class Response:
        def __enter__(self):
            return self

        def __exit__(self, *args):  # noqa: ANN002
            return False

        def read(self) -> bytes:
            return b'{"ready":true}'

    def fake_urlopen(request, timeout):  # noqa: ANN001, ARG001
        request_headers.update(
            {
                "accept": request.get_header("Accept"),
                "cache_control": request.get_header("Cache-control"),
                "user_agent": request.get_header("User-agent"),
            }
        )
        return Response()

    monkeypatch.setattr(historic_publish_module, "urlopen", fake_urlopen)

    payload = historic_publish_module._default_fetch_bytes(
        "https://data.example.com/v1/stm/historic/history/index.json"
    )

    assert payload == b'{"ready":true}'
    assert request_headers == {
        "accept": "application/json",
        "cache_control": "no-cache",
        "user_agent": "transit-historic-proof/1.0 (+https://transit.yesid.dev)",
    }


def test_historic_publish_proof_records_incomplete_read_without_partial_body() -> None:
    fixture = _complete_public_fixture()
    failed_path = "historic/receipts/index.json"

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == failed_path:
            raise IncompleteRead(b"private-partial-body", 100)
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "fail"
    assert "public_artifact_fetch_failed" in report.failures
    artifact = report.public["artifacts"][failed_path]
    assert artifact["failures"] == ["public_artifact_fetch_failed"]
    assert artifact["error_type"] == "IncompleteRead"
    assert "private-partial-body" not in str(report.display_dict())


@pytest.mark.parametrize(
    ("exception_type", "private_detail"),
    [
        (InvalidURL, "https://user:private-secret@invalid.example/path"),
        (HTTPException, "private-partial-body"),
    ],
)
def test_historic_publish_proof_records_http_client_failure_without_exception_detail(
    exception_type: type[HTTPException],
    private_detail: str,
) -> None:
    fixture = _complete_public_fixture()
    failed_path = "historic/receipts/index.json"

    def fetch_override(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == failed_path:
            raise exception_type(private_detail)
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch_override)

    assert report.status == "fail"
    assert "public_artifact_fetch_failed" in report.failures
    artifact = report.public["artifacts"][failed_path]
    assert artifact["failures"] == ["public_artifact_fetch_failed"]
    assert artifact["error_type"] == exception_type.__name__
    assert not {"error", "message", "detail", "exception"} & artifact.keys()
    assert private_detail not in str(report.display_dict())


def test_historic_publish_proof_propagates_fetch_type_error() -> None:
    fixture = _complete_public_fixture()

    def fetch_override(url: str) -> bytes:  # noqa: ARG001
        raise TypeError("programming bug")

    with pytest.raises(TypeError, match="programming bug"):
        _build_report(fixture, fetch_override=fetch_override)


def test_historic_publish_proof_records_malformed_public_base_url() -> None:
    fixture = _complete_public_fixture()

    report = _build_report(fixture, public_base_url="https://[malformed")

    assert report.status == "fail"
    assert "snapshot_public_base_url_invalid" in report.failures
    assert report.public["base_url"] is None
    assert "malformed" not in str(report.display_dict())


@pytest.mark.parametrize(
    "public_base_url",
    [
        "https://exam ple.com",
        "https://exam\tple.com",
        "https://example.com:not-a-port",
        "https://example.com:70000",
    ],
)
def test_historic_publish_proof_rejects_invalid_public_origin(
    public_base_url: str,
) -> None:
    fixture = _complete_public_fixture()

    report = _build_report(fixture, public_base_url=public_base_url)

    assert report.status == "fail"
    assert "snapshot_public_base_url_invalid" in report.failures
    assert report.public["base_url"] is None
    assert public_base_url not in str(report.display_dict())


def test_historic_publish_proof_rejects_unsafe_manifest_prefixes_with_evidence() -> None:
    fixture = _complete_public_fixture()
    manifest = Manifest.model_validate_json(fixture.public_bytes["manifest.json"])
    manifest.files.historic.receipts_prefix = "../receipts/"
    manifest.files.historic.route_reliability_prefix = "https://evil.example/"
    _replace_public_model(fixture, "manifest.json", manifest)

    report = _build_report(fixture)

    assert report.status == "fail"
    assert "unsafe_public_path" in report.failures
    unsafe_artifacts = [
        artifact
        for artifact in report.public["artifacts"].values()
        if "unsafe_public_path" in artifact["failures"]
    ]
    assert len(unsafe_artifacts) == 4


def test_historic_publish_proof_propagates_dependency_type_error() -> None:
    fixture = _complete_public_fixture()

    def programming_error(settings, engine):  # noqa: ANN001
        raise TypeError("dependency bug")

    with pytest.raises(TypeError, match="dependency bug"):
        _build_report(fixture, migration_reader=programming_error)
