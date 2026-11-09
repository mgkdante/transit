"""Cross-caller behavior pinned before extracting the published historic tree."""

from __future__ import annotations

from urllib.error import HTTPError
from urllib.parse import urlsplit

import pytest
from test_historic_publish_proof import _build_report, _complete_public_fixture
from test_historic_snapshot_gc import NOW, _build_graph

from transit_ops.snapshots import gate
from transit_ops.snapshots.historic_gc import (
    HistoricGcBlockedError,
    HistoricGcUnsupportedError,
    _generation_candidate_request,
    plan_historic_generation_gc,
)
from transit_ops.snapshots.serialization import snapshot_sha256

FAMILIES = ("alerts", "receipts", "network", "lines", "stops", "hotspots", "repeat_offenders")


def _prefix(family: str) -> str:
    return (
        f"historic/{family}/"
        if family in {"alerts", "receipts"}
        else (f"historic/history/{family}/")
    )


@pytest.mark.parametrize("family", FAMILIES)
def test_gate_accepts_every_published_family_object(family: str) -> None:
    storage, _ = _build_graph()
    paths = [
        path
        for path in storage.objects
        if (path.startswith(_prefix(family)) and "/generations/" in path)
    ]
    assert paths
    for path in paths:
        model = _generation_candidate_request(storage.versions[path]).model
        payload = model.model_validate_json(storage.objects[path])
        findings = gate.check_payload(path, payload)
        assert not [finding for finding in findings if finding.severity is gate.Severity.ERROR]


@pytest.mark.parametrize("family", FAMILIES)
def test_gc_marks_valid_unreachable_family_indexes_without_deleting(family: str) -> None:
    storage, paths = _build_graph()
    source = next(
        path
        for path in storage.objects
        if (
            path.startswith(_prefix(family))
            and "/generations/" in path
            and path.endswith("/index.json")
        )
    )
    model = _generation_candidate_request(storage.versions[source]).model
    payload = model.model_validate_json(storage.objects[source])
    payload.publish_generation_id = "unreachable-characterization"
    orphan = f"{source.split('/generations/')[0]}/generations/{snapshot_sha256(payload)}/index.json"
    storage.put(orphan, payload)
    before = dict(storage.objects)
    report = plan_historic_generation_gc(storage, now=NOW, mode="mark", provider_id=None)
    assert report.unreachable_keys == tuple(sorted((orphan, paths["orphan"])))
    assert report.eligible_keys == ()
    assert storage.objects == before


@pytest.mark.parametrize("family", FAMILIES)
def test_gc_blocks_missing_reachable_family_object(family: str) -> None:
    storage, _ = _build_graph()
    path = next(
        path
        for path in storage.objects
        if (path.startswith(_prefix(family)) and "/generations/" in path)
    )
    storage.objects.pop(path)
    storage.versions.pop(path)
    with pytest.raises(HistoricGcBlockedError, match="missing_object"):
        plan_historic_generation_gc(storage, now=NOW, provider_id=None)


@pytest.mark.parametrize("family", FAMILIES)
def test_http_proof_rejects_missing_family_index(family: str) -> None:
    fixture = _complete_public_fixture()
    target = next(
        path
        for path in fixture.public_bytes
        if (path.startswith(_prefix(family)) and path.endswith("/index.json"))
    )

    def fetch(url: str) -> bytes:
        path = urlsplit(url).path.split("/v1/stm/", 1)[1]
        if path == target:
            raise HTTPError(url, 404, "fixture missing", None, None)
        return fixture.public_bytes[path]

    report = _build_report(fixture, fetch_override=fetch)
    assert report.status == "fail"
    assert report.public["artifacts"][target]["status"] == "fail"


def test_complete_http_tree_passes_and_gc_apply_never_reads_storage() -> None:
    assert _build_report(_complete_public_fixture()).status == "pass"
    with pytest.raises(HistoricGcUnsupportedError, match="apply is disabled"):
        plan_historic_generation_gc(object(), now=NOW, mode="apply", provider_id=None)
