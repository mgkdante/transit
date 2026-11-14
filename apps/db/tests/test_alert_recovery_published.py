from datetime import UTC, date, datetime

import pytest

from transit_ops.history.alert_recovery_published import read_published_candidates
from transit_ops.snapshots import historic_tree
from transit_ops.snapshots.contract import AlertArchiveIndex, AlertArchivePage
from transit_ops.snapshots.serialization import snapshot_sha256
from transit_ops.snapshots.storage import LocalSnapshotStorage

NOW = datetime(2026, 11, 14, tzinfo=UTC)


def page(storage, identity, *, message=True):
    entry = dict(
        id=identity,
        first_seen_utc="2020-01-02T00:00:00Z",
        last_seen_utc="2026-11-01T00:00:00Z",
        description="Travaux",
        description_en="Works",
        severity_level="WARNING",
        message=(
            dict(snapshot_id="evidence", alert_index=2, captured_utc="2026-11-01T00:00:00Z")
            if message
            else None
        ),
    )
    payload = AlertArchivePage(
        generated_utc="2026-11-01T00:00:00Z", month="2020-01", page=1, alerts=[entry]
    )
    path = historic_tree.FAMILIES["alerts"].leaf_path(snapshot_sha256(payload), "2020-01/page-0001")
    storage.put_json(path, payload, tier="historic")
    return path, payload


def index(storage, path, payload):
    from transit_ops.snapshots.serialization import snapshot_json_bytes

    ref = dict(
        path=path,
        page=1,
        count=1,
        byte_size=len(snapshot_json_bytes(payload)),
        sha256=snapshot_sha256(payload),
        coverage_start="2020-01-02",
        coverage_end="2026-11-01",
    )
    months = [dict(month=payload.month, total_alerts=1, pages=[ref])]
    basis = dict(first_available_date="2020-01-02", last_available_date="2026-11-01", months=months)
    value = AlertArchiveIndex(
        generated_utc="2026-11-01T00:00:00Z",
        total_alerts=1,
        collection_generation_id=snapshot_sha256(basis),
        **basis,
    )
    storage.put_json(historic_tree.pointer_path("historic/alerts", value), value, tier="historic")
    storage.put_json("historic/alerts/index.json", value, tier="historic")


def test_reads_older_generations_and_preserves_fields(tmp_path):
    storage = LocalSnapshotStorage(str(tmp_path), "v1/p")
    index(storage, *page(storage, "older"))
    index(storage, *page(storage, "newest"))
    candidates, report = read_published_candidates(storage, provider_id="p", recovered_at_utc=NOW)
    assert report.complete
    assert [c.alert_id for c in candidates] == ["newest", "older"]
    row = candidates[0].record
    assert row["archive_month"] == date(2020, 1, 1)
    assert (row["description_text"], row["description_text_en"]) == ("Travaux", "Works")
    assert row["severity"] == "WARNING"
    assert row["message"]["snapshot_id"] == "evidence" and row["url_en"] is None
    assert row["last_seen_utc"] == datetime(2026, 11, 1, tzinfo=UTC)


@pytest.mark.parametrize("fault", ["checksum", "size", "count", "missing", "escape", "month"])
def test_incomplete_on_corrupt_or_unreadable_evidence(tmp_path, fault):
    storage = LocalSnapshotStorage(str(tmp_path), "v1/p")
    path, payload = page(storage, "a")
    if fault == "checksum":
        storage.put_bytes(path, b"{}", tier="historic")
    else:
        import json

        index(storage, path, payload)
        key = "historic/alerts/index.json"
        value = json.loads(storage.read_bytes(key))
        ref = value["months"][0]["pages"][0]
        if fault in {"size", "count"}:
            ref["byte_size" if fault == "size" else "count"] += 1
        elif fault == "month":
            value["months"][0]["month"] = "2020-02"
        else:
            ref["path"] = (
                "../other/historic/alerts/index.json"
                if fault == "escape"
                else path.replace("page-0001", "page-0002")
            )
        basis = {k: value[k] for k in ("first_available_date", "last_available_date", "months")}
        value["collection_generation_id"] = snapshot_sha256(basis)
        storage.put_json(key, value, tier="historic")
    _, report = read_published_candidates(storage, provider_id="p", recovered_at_utc=NOW)
    assert not report.complete
    assert report.errors or report.missing


def test_orphan_is_eligible_with_explicit_coverage_limit(tmp_path):
    storage = LocalSnapshotStorage(str(tmp_path), "v1/p")
    path, _ = page(storage, "orphan", message=False)
    candidates, report = read_published_candidates(storage, provider_id="p", recovered_at_utc=NOW)
    assert [c.alert_id for c in candidates] == ["orphan"]
    assert candidates[0].record["message"] is None
    assert report.complete and f"orphan:{path}" in report.coverage


def test_selection_is_order_independent_and_reports_conflicts(tmp_path):
    from dataclasses import replace

    from transit_ops.history.alert_recovery_models import SourceReport, select_candidates

    storage = LocalSnapshotStorage(str(tmp_path), "v1/p")
    page(storage, "a")
    candidates, _ = read_published_candidates(storage, provider_id="p", recovered_at_utc=NOW)
    a = candidates[0]
    backup = replace(a, source_kind="backup")
    assert select_candidates([a, backup], provider_id="p") == ([backup], ())
    assert select_candidates([backup, a], provider_id="p") == ([backup], ())
    changed = replace(a, record={**a.record, "description_text": "Different"})
    assert select_candidates([a, changed], provider_id="p") == ([], ("a",))
    newer = replace(changed, record={**changed.record, "last_seen_utc": NOW})
    selected, conflicts = select_candidates([a, newer], provider_id="p")
    assert not conflicts and selected[0].record["description_text"] == "Different"
    with pytest.raises(ValueError):
        select_candidates([a], provider_id="other")
    assert not SourceReport("capture").complete
    assert SourceReport("capture").coverage == ("not read",)


@pytest.mark.parametrize(
    "field,value",
    [
        ("alert_id", ""),
        ("route_ids", [1]),
        ("first_seen_utc", "2020-01-01"),
        ("active_periods", [{"start_utc": "2020-01-01"}]),
    ],
)
def test_preparation_refuses_invalid_evidence(tmp_path, field, value):
    from transit_ops.gold.alert_archive import prepare_recovered_archive_record
    from transit_ops.history.alert_recovery_models import SourceReport, unrecovered_ids

    storage = LocalSnapshotStorage(str(tmp_path), "v1/p")
    page(storage, "a")
    candidates, report = read_published_candidates(storage, provider_id="p", recovered_at_utc=NOW)
    with pytest.raises(ValueError):
        prepare_recovered_archive_record(
            {**candidates[0].record, field: value}, provider_id="p", recovered_at_utc=NOW
        )
    assert unrecovered_ids(["a", "lost"], ["a"], [report]) == ("lost",)
    assert unrecovered_ids(None, ["a"], [report]) is None
    assert unrecovered_ids(["lost"], [], [SourceReport("backup")]) is None
