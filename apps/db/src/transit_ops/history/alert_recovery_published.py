"""Read surviving generations through a provider-scoped snapshot store; never write."""

import hashlib
import json
from datetime import date, datetime
from typing import Any

from transit_ops.gold.alert_archive import prepare_recovered_archive_record
from transit_ops.history.alert_recovery_models import Candidate, SourceReport
from transit_ops.snapshots import gate, historic_tree
from transit_ops.snapshots.contract import AlertArchiveEntry, AlertArchiveIndex, AlertArchivePage
from transit_ops.snapshots.storage import LocalSnapshotStorage, SnapshotStorage


def _load(storage: Any, path: str, version: Any) -> dict[str, Any]:
    raw = storage.read_bytes_at_version(path, version)
    role = historic_tree.family_path_role(path, strict=True)
    stable = path == historic_tree.FAMILIES["alerts"].index_path
    if not stable and (role is None or role[0].name != "alerts"):
        raise ValueError("invalid path")
    if not stable and hashlib.sha256(raw).hexdigest() != path.split("/")[3]:
        raise ValueError("path checksum")
    value: dict[str, Any] = json.loads(raw)
    model = AlertArchiveIndex if stable or (role and role[1] == "index") else AlertArchivePage
    model.model_validate(value, strict=True)
    checker = (
        gate.check_alert_archive_index
        if model is AlertArchiveIndex
        else gate.check_alert_archive_page
    )
    # Exact inventoried bytes were hashed above; dictionary reserialization changes key order.
    if any(
        c.severity == gate.Severity.ERROR and not c.check.endswith("sha256")
        for c in checker(value, rel_key=path)
    ):
        raise ValueError("invalid archive")
    return value


def _candidates(page: dict[str, Any], path: str, provider: str, stamp: datetime) -> list[Candidate]:
    result = []
    for entry in page["alerts"]:
        row = AlertArchiveEntry.model_validate(entry, strict=True).model_dump()
        for public, column in {
            "id": "alert_id",
            "description": "description_text",
            "description_en": "description_text_en",
            "routes": "route_ids",
            "stops": "stop_ids",
            "severity_level": "severity",
        }.items():
            row[column] = row.pop(public, None)
        row["archive_month"] = date.fromisoformat(page["month"] + "-01")
        record = prepare_recovered_archive_record(row, provider_id=provider, recovered_at_utc=stamp)
        result.append(
            Candidate(
                provider, record["alert_id"], record["archive_month"], record, "published", path
            )
        )
    return result


def _references(
    loaded: dict[str, Any], versions: dict[str, Any], errors: list[str], missing: set[str]
) -> set[str]:
    referenced: set[str] = set()
    for value in loaded.values():
        for month in value.get("months", []):
            for ref in month["pages"]:
                path = ref["path"]
                match = historic_tree.ARCHIVE_PAGE_PATH_RE.fullmatch(path)
                if match is None:
                    errors.append("unsafe page reference")
                    continue
                referenced.add(path)
                page = loaded.get(path)
                if page is None:
                    missing.add(path)
                elif (
                    page.get("month"),
                    page.get("page"),
                    len(page.get("alerts", [])),
                    versions[path].size,
                    match[1],
                ) != (month["month"], ref["page"], ref["count"], ref["byte_size"], ref["sha256"]):
                    errors.append("page reference mismatch")
    return referenced


def read_published_candidates(
    storage: LocalSnapshotStorage | SnapshotStorage,
    *,
    provider_id: str,
    recovered_at_utc: datetime,
) -> tuple[tuple[Candidate, ...], SourceReport]:
    """The caller supplies the selected provider's store, never a bucket-wide store."""
    root = historic_tree.FAMILIES["alerts"].root
    errors: list[str] = []
    missing: set[str] = set()
    coverage = ["retained objects only; total historical loss unknown"]
    loaded: dict[str, dict[str, Any]] = {}
    try:
        versions = {v.rel_key: v for v in storage.iter_object_versions(root + "/")}
    except Exception:
        return (), SourceReport("published", errors=("inventory unreadable",), coverage=())
    for path, version in sorted(versions.items()):
        try:
            loaded[path] = _load(storage, path, version)
        except Exception:
            errors.append("object invalid or unreadable")
    referenced = _references(loaded, versions, errors, missing)
    candidates = []
    for path, value in sorted(loaded.items()):
        if "alerts" not in value:
            continue
        try:
            candidates.extend(_candidates(value, path, provider_id, recovered_at_utc))
            if path not in referenced:
                coverage.append(f"orphan:{path}")
        except (ValueError, TypeError):
            errors.append("invalid candidate")
    candidates = list({(c.alert_id, c.record["content_hash"]): c for c in candidates}.values())
    candidates.sort(key=lambda c: (c.alert_id, c.source_locator))
    return tuple(candidates), SourceReport(
        "published",
        len(versions),
        len(candidates),
        tuple(sorted(missing)),
        tuple(errors),
        tuple(coverage),
        not errors and not missing,
    )
