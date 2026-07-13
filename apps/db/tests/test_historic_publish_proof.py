from __future__ import annotations

import hashlib
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from urllib.error import HTTPError
from urllib.parse import urlsplit

import pytest

from transit_ops.settings import Settings
from transit_ops.snapshots.contract import (
    AlertArchiveEntry,
    AlertArchiveIndex,
    AlertArchiveMonth,
    AlertArchivePage,
    AlertArchivePageRef,
    AlertHistory,
    AlertHistoryEntry,
    Manifest,
    ManifestFiles,
    ManifestHistoricFiles,
    ManifestLiveFiles,
    Receipt,
    ReceiptsIndex,
    RouteReliability,
    RouteReliabilityIndex,
)
from transit_ops.validation.historic_publish import (
    AlertExpectations,
    MigrationEvidence,
    build_historic_publish_proof,
)

GENERATED_UTC = "2026-07-13T06:00:00+00:00"
NOW_UTC = datetime(2026, 7, 13, 12, 0, tzinfo=UTC)
COLLECTION_GENERATION_ID = "a" * 64


@dataclass
class PublicFixture:
    public_bytes: dict[str, bytes]
    page_paths: tuple[str, ...]
    fetch_calls: list[str]
    expectations_reader: Callable[..., AlertExpectations]


def _json_bytes(model: object) -> bytes:
    return model.model_dump_json().encode("utf-8")  # type: ignore[attr-defined]


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
        collection_generation_id = "b" * 64
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
        alert_index = AlertArchiveIndex(
            generated_utc=GENERATED_UTC,
            collection_generation_id=COLLECTION_GENERATION_ID,
            first_available_date="2026-05-01",
            last_available_date="2026-07-13",
            total_alerts=2,
            months=[
                AlertArchiveMonth(month="2026-07", total_alerts=1, pages=[july_ref]),
                AlertArchiveMonth(month="2026-05", total_alerts=1, pages=[may_ref]),
            ],
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

    public_bytes.update(
        {
            "manifest.json": _json_bytes(_manifest()),
            "historic/alerts/index.json": _json_bytes(alert_index),
            "historic/alert_history.json": _json_bytes(alert_history),
            "historic/receipts/index.json": _json_bytes(
                ReceiptsIndex(
                    generated_utc=GENERATED_UTC,
                    dates=["2026-05-01", "2026-07-13"],
                )
            ),
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
                collection_generation_id="b" * 64,
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
                collection_generation_id="a" * 64,
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
        fetch_calls=fetch_calls,
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


def _gate_report() -> dict[str, object]:
    return {
        "provider_id": "stm",
        "tier": "historic",
        "generated_utc": GENERATED_UTC,
        "checks_run": 24,
        "payloads_checked": 11,
        "errors": 0,
        "warnings": 0,
        "results": [],
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
        gate_report=gate_report or _gate_report(),
        settings=Settings(
            _env_file=None,
            DATABASE_URL="postgresql://proof:secret@localhost/transit",
            SNAPSHOT_PUBLIC_BASE_URL="https://data.example.com",
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
    assert {details["generated_utc"] for details in report.public["indexes"].values()} == {
        GENERATED_UTC
    }
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
    assert not any("/generations/" in urlsplit(url).path for url in fixture.fetch_calls)


def _replace_public_model(fixture: PublicFixture, path: str, model: object) -> None:
    fixture.public_bytes[path] = _json_bytes(model)


def _nonempty_expectations(**overrides: object) -> AlertExpectations:
    values: dict[str, object] = {
        "collection_generation_id": COLLECTION_GENERATION_ID,
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
    gate_report = _gate_report()
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
