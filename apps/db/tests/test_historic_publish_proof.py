from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from http.client import HTTPException, IncompleteRead, InvalidURL
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlsplit

import pytest

import transit_ops.validation.historic_publish as historic_publish_module
from transit_ops.settings import Settings
from transit_ops.snapshots.builders.historic.alert_archive import _collection_generation_id
from transit_ops.snapshots.builders.historic.history_common import (
    PointHistorySummary,
    history_coverage,
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
    HistoricFamilyAvailability,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    HistorySelectionMode,
    Manifest,
    ManifestFiles,
    ManifestHistoricFiles,
    ManifestLiveFiles,
    Receipt,
    ReceiptsIndex,
    RouteReliability,
    RouteReliabilityIndex,
)
from transit_ops.snapshots.gate import check_alert_archive_index
from transit_ops.validation.historic_publish import (
    AlertExpectations,
    MigrationEvidence,
    build_historic_publish_proof,
)

GENERATED_UTC = "2026-07-13T06:00:00+00:00"
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
            HistoricFamilyAvailability(
                family="lines",
                selection_mode=HistorySelectionMode.range,
                index_path="historic/history/lines/index.json",
                collection_generation_id="c" * 64,
            ),
            HistoricFamilyAvailability(
                family="network",
                selection_mode=HistorySelectionMode.range,
                index_path="historic/history/network/index.json",
                collection_generation_id="d" * 64,
            ),
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
            HistoricFamilyAvailability(
                family="stops",
                selection_mode=HistorySelectionMode.range,
                index_path="historic/history/stops/index.json",
                collection_generation_id="e" * 64,
            ),
        ],
    )

    public_bytes.update(hotspots_bytes)
    public_bytes.update(repeat_bytes)
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
        fetch_calls=fetch_calls,
        collection_generation_id=collection_generation_id,
        expectations_reader=expectations_reader,
    )


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
    assert "unavailable" not in str(report.display_dict())


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
