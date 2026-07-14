"""Fail-closed reachability marking for immutable historic snapshot generations.

This lane intentionally does not delete. Cloudflare R2's atomic conditional-delete
semantics must be proven by a production canary before an apply mode can exist.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, timedelta
from functools import partial
from typing import Literal, Protocol, TypeVar
from uuid import uuid4

from pydantic import BaseModel, ValidationError
from sqlalchemy import text
from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.snapshots.builders.historic.history_common import history_pointer_path
from transit_ops.snapshots.contract import (
    AlertArchiveIndex,
    AlertArchivePage,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricHotspotsDay,
    HistoricRepeatOffendersDay,
    LineHistoryPartition,
    Manifest,
    NetworkHistoryPartition,
    ReceiptsIndex,
    StopHistoryPartition,
)
from transit_ops.snapshots.gate import (
    CheckResult,
    Severity,
    check_alert_archive_index,
    check_alert_archive_page,
    check_history_availability_graph,
    check_history_availability_index,
    check_line_history_directory,
    check_line_history_index,
    check_line_history_partition,
    check_line_history_partition_ref,
    check_network_history_index,
    check_network_history_partition,
    check_network_history_partition_ref,
    check_point_history_day,
    check_point_history_day_ref,
    check_point_history_index,
    check_receipts_index,
    check_stop_history_directory,
    check_stop_history_index,
    check_stop_history_partition,
    check_stop_history_partition_ref,
)
from transit_ops.snapshots.paths import safe_public_path
from transit_ops.snapshots.publish import _acquire_publish_lock
from transit_ops.snapshots.storage import StoredObjectVersion, build_snapshot_storage

GcMode = Literal["dry-run", "mark", "apply"]
MIN_UNREACHABLE = timedelta(hours=48)

_SHA = r"[0-9a-f]{64}"
_MONTH = r"\d{4}-(?:0[1-9]|1[0-2])"
_DAY = rf"{_MONTH}-(?:0[1-9]|[12]\d|3[01])"
_KNOWN_GENERATION_SHAPES = (
    re.compile(rf"historic/alerts/generations/{_SHA}/index\.json"),
    re.compile(rf"historic/alerts/generations/{_SHA}/{_MONTH}/page-\d{{4}}\.json"),
    re.compile(rf"historic/receipts/generations/{_SHA}/index\.json"),
    re.compile(rf"historic/history/network/generations/{_SHA}/(?:index|{_MONTH})\.json"),
    re.compile(
        rf"historic/history/(?:hotspots|repeat_offenders)/generations/{_SHA}/"
        rf"(?:index|{_DAY})\.json"
    ),
    re.compile(rf"historic/history/(?:lines|stops)/generations/{_SHA}/index\.json"),
    re.compile(
        rf"historic/history/(?:lines|stops)/(?:[0-9a-f]{{2}})+/generations/{_SHA}/"
        rf"(?:index|{_MONTH})\.json"
    ),
)
_VERSIONED_DIGEST = re.compile(rf"(?:^|/)generations/({_SHA})/")
_LEGACY_ROOTS = {
    "network": "historic/history/network/index.json",
    "lines": "historic/history/lines/index.json",
    "stops": "historic/history/stops/index.json",
    "hotspots": "historic/history/hotspots/index.json",
    "repeat_offenders": "historic/history/repeat_offenders/index.json",
}


class HistoricGcBlockedError(RuntimeError):
    """The graph or inventory was incomplete, malformed, or changed mid-scan."""


class HistoricGcUnsupportedError(RuntimeError):
    """A destructive mode was requested before its storage canary exists."""


class HistoricGcStorage(Protocol):
    def read_bytes(self, rel_key: str) -> bytes | None: ...

    def capture_object_version(self, rel_key: str) -> StoredObjectVersion | None: ...

    def iter_object_versions(self, rel_prefix: str): ...


@dataclass(frozen=True)
class HistoricGcMark:
    version: StoredObjectVersion
    first_unreachable_utc: datetime
    last_confirmed_unreachable_utc: datetime
    last_scan_id: str


@dataclass(frozen=True)
class HistoricGcReport:
    mode: str
    scanned_at_utc: datetime
    scan_id: str
    provider_id: str | None
    reachable_keys: tuple[str, ...]
    candidate_keys: tuple[str, ...]
    unreachable_keys: tuple[str, ...]
    marked_keys: tuple[str, ...]
    eligible_keys: tuple[str, ...]
    reachable_bytes: int
    unreachable_bytes: int
    roots: Mapping[str, StoredObjectVersion]
    next_marks: Mapping[str, HistoricGcMark] = field(repr=False)

    def display_dict(self) -> dict[str, object]:
        return {
            "status": "pass",
            "provider_id": self.provider_id,
            "mode": self.mode,
            "scan_id": self.scan_id,
            "scanned_at_utc": self.scanned_at_utc.isoformat(),
            "deletion_supported": False,
            "eligibility_supported": False,
            "eligibility_blocker": (
                "durable_activation_evidence_and_r2_conditional_delete_canary_required"
            ),
            "reachable_count": len(self.reachable_keys),
            "candidate_count": len(self.candidate_keys),
            "unreachable_count": len(self.unreachable_keys),
            "marked_count": len(self.marked_keys),
            "eligible_count": len(self.eligible_keys),
            "reachable_bytes": self.reachable_bytes,
            "unreachable_bytes": self.unreachable_bytes,
            "reachable_keys": list(self.reachable_keys),
            "unreachable_keys": list(self.unreachable_keys),
            "marked_keys": list(self.marked_keys),
            "eligible_keys": list(self.eligible_keys),
            "roots": {
                path: {
                    "etag": version.etag,
                    "last_modified_utc": version.last_modified_utc.isoformat(),
                    "size": version.size,
                }
                for path, version in sorted(self.roots.items())
            },
        }


ModelT = TypeVar("ModelT", bound=BaseModel)


def _decode_payload(raw: bytes, model: type[ModelT], *, path: str) -> ModelT:
    def reject_constant(_value: str) -> None:
        raise ValueError

    try:
        decoded = json.loads(raw, parse_constant=reject_constant)
        return model.model_validate(decoded)
    except (UnicodeError, ValueError, ValidationError) as exc:
        raise HistoricGcBlockedError(f"malformed_payload:{path}") from exc


@dataclass
class _GraphWalker:
    storage: HistoricGcStorage
    reachable: set[str] = field(default_factory=set)
    observed: dict[str, StoredObjectVersion] = field(default_factory=dict)
    optional_roots: dict[str, StoredObjectVersion | None] = field(default_factory=dict)

    def _read_raw(
        self,
        path: str,
        *,
        optional: bool = False,
        expected_version: StoredObjectVersion | None = None,
    ) -> bytes | None:
        try:
            safe_public_path(path)
        except (TypeError, ValueError) as exc:
            raise HistoricGcBlockedError(f"unsafe_path:{path}") from exc
        before = self.storage.capture_object_version(path)
        if before is None:
            if optional:
                return None
            raise HistoricGcBlockedError(f"missing_object:{path}")
        if expected_version is not None and before != expected_version:
            raise HistoricGcBlockedError(f"inventory_version_mismatch:{path}")
        raw = self.storage.read_bytes(path)
        after = self.storage.capture_object_version(path)
        if raw is None or after is None:
            raise HistoricGcBlockedError(f"object_disappeared:{path}")
        if before != after:
            raise HistoricGcBlockedError(f"object_changed:{path}")
        self.observed[path] = before
        if "/generations/" in path:
            match = _VERSIONED_DIGEST.search(path)
            if match is None or hashlib.sha256(raw).hexdigest() != match.group(1):
                raise HistoricGcBlockedError(f"generation_digest_mismatch:{path}")
            self.reachable.add(path)
        return raw

    def load(
        self,
        path: str,
        model: type[ModelT],
        *,
        checker=None,
        optional: bool = False,
        expected_version: StoredObjectVersion | None = None,
    ) -> ModelT | None:
        raw = self._read_raw(
            path,
            optional=optional,
            expected_version=expected_version,
        )
        if raw is None:
            return None
        payload = _decode_payload(raw, model, path=path)
        if checker is not None:
            self.require_checks(checker(payload, rel_key=path), path=path)
        return payload

    @staticmethod
    def require_checks(findings: Sequence[CheckResult], *, path: str) -> None:
        errors = sorted(
            {finding.check for finding in findings if finding.severity is Severity.ERROR}
        )
        if errors:
            raise HistoricGcBlockedError(f"gate_failed:{path}:{','.join(errors)}")

    def require_exact_copy(self, prefix: str, payload: BaseModel) -> str:
        exact_path = history_pointer_path(prefix, payload)
        exact = self.load(exact_path, type(payload))
        if exact is None or exact.model_dump(mode="json") != payload.model_dump(mode="json"):
            raise HistoricGcBlockedError(f"pointer_copy_mismatch:{exact_path}")
        return exact_path

    def walk_alerts(self, path: str) -> AlertArchiveIndex:
        index = self.load(path, AlertArchiveIndex, checker=check_alert_archive_index)
        assert index is not None
        for month in index.months:
            for ref in month.pages:
                page = self.load(ref.path, AlertArchivePage, checker=check_alert_archive_page)
                assert page is not None
                raw = self.storage.read_bytes(ref.path)
                if (
                    raw is None
                    or hashlib.sha256(raw).hexdigest() != ref.sha256
                    or len(raw) != ref.byte_size
                    or len(page.alerts) != ref.count
                    or page.month != month.month
                    or page.page != ref.page
                ):
                    raise HistoricGcBlockedError(f"alert_page_ref_mismatch:{ref.path}")
        return index

    def walk_receipts(self, path: str) -> ReceiptsIndex:
        index = self.load(path, ReceiptsIndex, checker=check_receipts_index)
        assert index is not None
        return index

    def walk_network(self, path: str) -> HistoricCollectionIndex:
        index = self.load(path, HistoricCollectionIndex, checker=check_network_history_index)
        assert index is not None
        for ref in index.partitions:
            partition = self.load(
                ref.path,
                NetworkHistoryPartition,
                checker=check_network_history_partition,
            )
            assert partition is not None
            self.require_checks(
                check_network_history_partition_ref(ref, partition),
                path=ref.path,
            )
        return index

    def walk_point(self, family: str, path: str) -> HistoricCollectionIndex:
        index = self.load(
            path,
            HistoricCollectionIndex,
            checker=lambda value, *, rel_key: check_point_history_index(
                value,
                rel_key=rel_key,
                family=family,
            ),
        )
        assert index is not None
        day_model = HistoricHotspotsDay if family == "hotspots" else HistoricRepeatOffendersDay
        for ref in index.partitions:
            day = self.load(ref.path, day_model, checker=check_point_history_day)
            assert day is not None
            self.require_checks(
                check_point_history_day_ref(ref, day, family=family),
                path=ref.path,
            )
        return index

    def walk_entities(
        self,
        family: str,
        path: str,
    ) -> tuple[HistoricEntityDirectoryIndex, list[HistoricCollectionIndex]]:
        directory_checker = (
            check_line_history_directory if family == "lines" else check_stop_history_directory
        )
        index_checker = check_line_history_index if family == "lines" else check_stop_history_index
        partition_checker = (
            check_line_history_partition if family == "lines" else check_stop_history_partition
        )
        ref_checker = (
            check_line_history_partition_ref
            if family == "lines"
            else check_stop_history_partition_ref
        )
        partition_model = LineHistoryPartition if family == "lines" else StopHistoryPartition
        directory = self.load(path, HistoricEntityDirectoryIndex, checker=directory_checker)
        assert directory is not None
        indexes: list[HistoricCollectionIndex] = []
        for edge in directory.entities:
            child = self.load(edge.index_path, HistoricCollectionIndex, checker=index_checker)
            assert child is not None
            if (
                child.entity_id != edge.entity_id
                or child.collection_generation_id != edge.collection_generation_id
                or child.first_available_date != edge.first_available_date
                or child.last_available_date != edge.last_available_date
            ):
                raise HistoricGcBlockedError(f"entity_edge_mismatch:{edge.index_path}")
            indexes.append(child)
            for ref in child.partitions:
                partition = self.load(ref.path, partition_model, checker=partition_checker)
                assert partition is not None
                self.require_checks(ref_checker(ref, partition), path=ref.path)
        return directory, indexes

    def walk_legacy_root(self, family: str, path: str) -> None:
        initial_version = self.storage.capture_object_version(path)
        self.optional_roots[path] = initial_version
        if initial_version is None:
            return
        prefix = path.removesuffix("/index.json")
        if family == "network":
            payload = self.walk_network(path)
        elif family in {"hotspots", "repeat_offenders"}:
            stable = self.load(path, HistoricCollectionIndex)
            assert stable is not None
            exact_path = self.require_exact_copy(prefix, stable)
            self.walk_point(family, exact_path)
            return
        else:
            payload, _indexes = self.walk_entities(family, path)
        self.require_exact_copy(prefix, payload)
        if family not in {"lines", "stops"}:
            return
        assert isinstance(payload, HistoricEntityDirectoryIndex)
        for edge in payload.entities:
            if "/generations/" in edge.index_path:
                continue
            child = self.load(
                edge.index_path,
                HistoricCollectionIndex,
                checker=check_line_history_index if family == "lines" else check_stop_history_index,
            )
            assert child is not None
            self.require_exact_copy(edge.index_path.removesuffix("/index.json"), child)


def _read_manifest(storage: HistoricGcStorage) -> Manifest:
    """Read one coherent manifest body without pinning its live-cycle object version."""

    path = "manifest.json"
    raw = storage.read_bytes(path)
    if raw is None:
        raise HistoricGcBlockedError(f"missing_object:{path}")
    return _decode_payload(raw, Manifest, path=path)


def _manifest_graph_identity(manifest: Manifest) -> tuple[str, tuple[tuple[str, str], ...]]:
    historic = manifest.files.historic.model_dump(mode="json")
    pointers = tuple(
        sorted(
            (name, value)
            for name, value in historic.items()
            if name != "generated_utc" and isinstance(value, str)
        )
    )
    return manifest.provider, pointers


def _require_manifest_roots(manifest: Manifest, *, provider_id: str | None) -> None:
    if provider_id is not None and manifest.provider != provider_id:
        raise HistoricGcBlockedError(
            f"manifest_provider_mismatch:{manifest.provider}:{provider_id}"
        )
    mandatory_paths = {
        "history": (manifest.files.historic.history_index, "historic/history/index.json"),
        "alerts": (manifest.files.historic.alerts_index, "historic/alerts/index.json"),
        "receipts": (manifest.files.historic.receipts_index, "historic/receipts/index.json"),
    }
    for name, (actual, expected) in mandatory_paths.items():
        if actual != expected:
            raise HistoricGcBlockedError(f"mandatory_root_path:{name}:{actual}")


def _walk_reachable_graph(
    storage: HistoricGcStorage,
    *,
    provider_id: str | None = None,
) -> tuple[
    set[str],
    dict[str, StoredObjectVersion],
    tuple[str, tuple[tuple[str, str], ...]],
    dict[str, StoredObjectVersion | None],
]:
    walker = _GraphWalker(storage)
    manifest = _read_manifest(storage)
    _require_manifest_roots(manifest, provider_id=provider_id)
    history_path = manifest.files.historic.history_index
    root = walker.load(
        history_path,
        HistoricAvailabilityIndex,
        checker=check_history_availability_index,
    )
    assert root is not None

    compatibility_alerts_path = manifest.files.historic.alerts_index
    compatibility_alerts = walker.walk_alerts(compatibility_alerts_path)
    walker.require_exact_copy("historic/alerts", compatibility_alerts)
    compatibility_receipts_path = manifest.files.historic.receipts_index
    compatibility_receipts = walker.walk_receipts(compatibility_receipts_path)
    walker.require_exact_copy("historic/receipts", compatibility_receipts)

    edges = {edge.family: edge for edge in root.families}
    expected = {
        "alerts",
        "hotspots",
        "lines",
        "network",
        "receipts",
        "repeat_offenders",
        "stops",
    }
    if set(edges) != expected:
        raise HistoricGcBlockedError("history_root_family_set")

    alert_index = walker.walk_alerts(edges["alerts"].index_path)
    receipts_index = walker.walk_receipts(edges["receipts"].index_path)
    network_index = walker.walk_network(edges["network"].index_path)
    hotspots_index = walker.walk_point("hotspots", edges["hotspots"].index_path)
    repeat_index = walker.walk_point("repeat_offenders", edges["repeat_offenders"].index_path)
    line_directory, line_indexes = walker.walk_entities("lines", edges["lines"].index_path)
    stop_directory, stop_indexes = walker.walk_entities("stops", edges["stops"].index_path)

    for family, payload in (
        ("alerts", alert_index),
        ("receipts", receipts_index),
        ("network", network_index),
        ("hotspots", hotspots_index),
        ("repeat_offenders", repeat_index),
        ("lines", line_directory),
        ("stops", stop_directory),
    ):
        if edges[family].collection_generation_id != payload.collection_generation_id:
            raise HistoricGcBlockedError(f"root_edge_generation_mismatch:{family}")

    walker.require_checks(
        check_history_availability_graph(
            root,
            alert_index=alert_index,
            receipts_index=receipts_index,
            network_index=network_index,
            line_directory=line_directory,
            line_indexes=line_indexes,
            stop_directory=stop_directory,
            stop_indexes=stop_indexes,
            hotspots_index=hotspots_index,
            repeat_offenders_index=repeat_index,
            fallback_generated_utc=root.generated_utc,
            alert_index_path=edges["alerts"].index_path,
            receipt_index_path=edges["receipts"].index_path,
            network_index_path=edges["network"].index_path,
            line_directory_path=edges["lines"].index_path,
            stop_directory_path=edges["stops"].index_path,
            hotspots_index_path=edges["hotspots"].index_path,
            repeat_offenders_index_path=edges["repeat_offenders"].index_path,
        ),
        path=history_path,
    )

    for family, path in _LEGACY_ROOTS.items():
        walker.walk_legacy_root(family, path)
    return (
        walker.reachable,
        walker.observed,
        _manifest_graph_identity(manifest),
        walker.optional_roots,
    )


def _known_generation_shape(path: str) -> bool:
    if not any(pattern.fullmatch(path) is not None for pattern in _KNOWN_GENERATION_SHAPES):
        return False
    filename = path.rsplit("/", 1)[-1].removesuffix(".json")
    if re.fullmatch(_DAY, filename) is not None:
        try:
            return date.fromisoformat(filename).isoformat() == filename
        except ValueError:
            return False
    return True


def _validate_generation_candidate(
    walker: _GraphWalker,
    version: StoredObjectVersion,
) -> None:
    path = version.rel_key
    model: type[BaseModel]
    checker = None
    if re.fullmatch(rf"historic/alerts/generations/{_SHA}/index\.json", path):
        model, checker = AlertArchiveIndex, check_alert_archive_index
    elif re.fullmatch(
        rf"historic/alerts/generations/{_SHA}/{_MONTH}/page-\d{{4}}\.json",
        path,
    ):
        model, checker = AlertArchivePage, check_alert_archive_page
    elif re.fullmatch(rf"historic/receipts/generations/{_SHA}/index\.json", path):
        model, checker = ReceiptsIndex, check_receipts_index
    elif re.fullmatch(rf"historic/history/network/generations/{_SHA}/index\.json", path):
        model, checker = HistoricCollectionIndex, check_network_history_index
    elif re.fullmatch(rf"historic/history/network/generations/{_SHA}/{_MONTH}\.json", path):
        model, checker = NetworkHistoryPartition, check_network_history_partition
    elif match := re.fullmatch(
        rf"historic/history/(hotspots|repeat_offenders)/generations/{_SHA}/index\.json",
        path,
    ):
        family = match.group(1)
        model = HistoricCollectionIndex
        checker = partial(check_point_history_index, family=family)
    elif match := re.fullmatch(
        rf"historic/history/(hotspots|repeat_offenders)/generations/{_SHA}/{_DAY}\.json",
        path,
    ):
        family = match.group(1)
        model = HistoricHotspotsDay if family == "hotspots" else HistoricRepeatOffendersDay
        checker = check_point_history_day
    elif match := re.fullmatch(
        rf"historic/history/(lines|stops)/generations/{_SHA}/index\.json",
        path,
    ):
        family = match.group(1)
        model = HistoricEntityDirectoryIndex
        checker = (
            check_line_history_directory if family == "lines" else check_stop_history_directory
        )
    elif match := re.fullmatch(
        rf"historic/history/(lines|stops)/(?:[0-9a-f]{{2}})+/generations/{_SHA}/"
        rf"(index|{_MONTH})\.json",
        path,
    ):
        family, leaf = match.groups()
        if leaf == "index":
            model = HistoricCollectionIndex
            checker = check_line_history_index if family == "lines" else check_stop_history_index
        else:
            model = LineHistoryPartition if family == "lines" else StopHistoryPartition
            checker = (
                check_line_history_partition if family == "lines" else check_stop_history_partition
            )
    else:  # Inventory shape validation runs before this dispatcher.
        raise HistoricGcBlockedError(f"unknown_generation_shape:{path}")
    walker.load(
        path,
        model,
        checker=checker,
        expected_version=version,
    )


def plan_historic_generation_gc(
    storage: HistoricGcStorage,
    *,
    now: datetime,
    mode: GcMode = "dry-run",
    existing_marks: Mapping[str, HistoricGcMark] | None = None,
    min_unreachable: timedelta = MIN_UNREACHABLE,
    provider_id: str | None = None,
) -> HistoricGcReport:
    """Validate the full graph and plan a non-destructive reachability mark update."""

    if mode == "apply":
        raise HistoricGcUnsupportedError(
            "apply is disabled until an R2 conditional-delete canary proves atomic semantics"
        )
    if mode not in {"dry-run", "mark"}:
        raise ValueError(f"unsupported historic GC mode: {mode}")
    if now.tzinfo is None:
        raise ValueError("historic GC scan time must be timezone-aware")
    if min_unreachable < timedelta(hours=48):
        raise ValueError("historic GC minimum unreachable age cannot be below 48 hours")
    now = now.astimezone(UTC)
    reachable, roots, manifest_identity, optional_roots = _walk_reachable_graph(
        storage,
        provider_id=provider_id,
    )
    candidates: dict[str, StoredObjectVersion] = {}
    for version in storage.iter_object_versions("historic/"):
        if "/generations/" not in version.rel_key:
            continue
        try:
            safe_public_path(version.rel_key)
        except (TypeError, ValueError) as exc:
            raise HistoricGcBlockedError(f"unsafe_inventory_path:{version.rel_key}") from exc
        if not _known_generation_shape(version.rel_key):
            raise HistoricGcBlockedError(f"unknown_generation_shape:{version.rel_key}")
        if version.rel_key in candidates:
            raise HistoricGcBlockedError(f"duplicate_inventory_key:{version.rel_key}")
        candidates[version.rel_key] = version

    missing = sorted(reachable - candidates.keys())
    if missing:
        raise HistoricGcBlockedError(f"reachable_generation_missing_from_inventory:{missing[0]}")
    unreachable = sorted(candidates.keys() - reachable)
    candidate_walker = _GraphWalker(storage)
    for path in unreachable:
        _validate_generation_candidate(candidate_walker, candidates[path])
    current_manifest = _read_manifest(storage)
    if _manifest_graph_identity(current_manifest) != manifest_identity:
        raise HistoricGcBlockedError("manifest_changed_after_inventory")
    for path, observed in optional_roots.items():
        if storage.capture_object_version(path) != observed:
            raise HistoricGcBlockedError(f"optional_root_changed_after_inventory:{path}")
    for path, observed in {**roots, **candidate_walker.observed}.items():
        current = storage.capture_object_version(path)
        if current != observed:
            raise HistoricGcBlockedError(f"object_changed_after_inventory:{path}")

    scan_id = str(uuid4())
    prior = existing_marks or {}
    next_marks: dict[str, HistoricGcMark] = {}
    for path in unreachable:
        version = candidates[path]
        old = prior.get(path)
        first = old.first_unreachable_utc if old is not None and old.version == version else now
        mark = HistoricGcMark(
            version=version,
            first_unreachable_utc=first,
            last_confirmed_unreachable_utc=now,
            last_scan_id=scan_id,
        )
        next_marks[path] = mark

    return HistoricGcReport(
        mode=mode,
        scanned_at_utc=now,
        scan_id=scan_id,
        provider_id=provider_id,
        reachable_keys=tuple(sorted(reachable)),
        candidate_keys=tuple(sorted(candidates)),
        unreachable_keys=tuple(unreachable),
        marked_keys=tuple(unreachable),
        eligible_keys=(),
        reachable_bytes=sum(candidates[path].size for path in reachable),
        unreachable_bytes=sum(candidates[path].size for path in unreachable),
        roots=roots,
        next_marks=next_marks,
    )


_LOAD_MARKS_SQL = text(
    """
    SELECT object_key, etag, content_length, object_last_modified_utc,
           first_unreachable_utc, last_confirmed_unreachable_utc, last_scan_id
    FROM core.snapshot_historic_gc_marks
    WHERE provider_id = :provider_id
    ORDER BY object_key
    """
)
_DELETE_MARKS_SQL = text(
    "DELETE FROM core.snapshot_historic_gc_marks WHERE provider_id = :provider_id"
)
_INSERT_MARK_SQL = text(
    """
    INSERT INTO core.snapshot_historic_gc_marks (
        provider_id, object_key, etag, content_length, object_last_modified_utc,
        first_unreachable_utc, last_confirmed_unreachable_utc, last_scan_id
    ) VALUES (
        :provider_id, :object_key, :etag, :content_length, :object_last_modified_utc,
        :first_unreachable_utc, :last_confirmed_unreachable_utc, CAST(:last_scan_id AS uuid)
    )
    """
)


def _load_marks(conn: object, provider_id: str) -> dict[str, HistoricGcMark]:
    marks: dict[str, HistoricGcMark] = {}
    for row in conn.execute(_LOAD_MARKS_SQL, {"provider_id": provider_id}).mappings():  # type: ignore[attr-defined]
        path = str(row["object_key"])
        marks[path] = HistoricGcMark(
            version=StoredObjectVersion(
                rel_key=path,
                etag=str(row["etag"]),
                last_modified_utc=row["object_last_modified_utc"],
                size=int(row["content_length"]),
            ),
            first_unreachable_utc=row["first_unreachable_utc"],
            last_confirmed_unreachable_utc=row["last_confirmed_unreachable_utc"],
            last_scan_id=str(row["last_scan_id"]),
        )
    return marks


def _replace_marks(
    conn: object,
    provider_id: str,
    marks: Mapping[str, HistoricGcMark],
) -> None:
    conn.execute(_DELETE_MARKS_SQL, {"provider_id": provider_id})  # type: ignore[attr-defined]
    rows = [
        {
            "provider_id": provider_id,
            "object_key": path,
            "etag": mark.version.etag,
            "content_length": mark.version.size,
            "object_last_modified_utc": mark.version.last_modified_utc,
            "first_unreachable_utc": mark.first_unreachable_utc,
            "last_confirmed_unreachable_utc": mark.last_confirmed_unreachable_utc,
            "last_scan_id": mark.last_scan_id,
        }
        for path, mark in sorted(marks.items())
    ]
    if rows:
        conn.execute(_INSERT_MARK_SQL, rows)  # type: ignore[attr-defined]


def run_historic_snapshot_gc(
    provider_id: str,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    mode: GcMode = "dry-run",
    engine: Engine | None = None,
    storage: HistoricGcStorage | None = None,
    now: datetime | None = None,
) -> HistoricGcReport:
    """Run one advisory-locked dry-run or atomic mark scan for a provider."""

    if mode == "apply":
        raise HistoricGcUnsupportedError(
            "apply is disabled until an R2 conditional-delete canary proves atomic semantics"
        )
    registry.get_provider(provider_id)
    resolved_engine = engine or make_engine(settings)
    resolved_storage = storage or build_snapshot_storage(settings, provider_id=provider_id)
    scanned_at = now or datetime.now(UTC)
    with resolved_engine.begin() as conn:
        _acquire_publish_lock(conn, provider_id=provider_id, tier="historic")
        existing = _load_marks(conn, provider_id)
        report = plan_historic_generation_gc(
            resolved_storage,
            now=scanned_at,
            mode=mode,
            existing_marks=existing,
            provider_id=provider_id,
        )
        if mode == "mark":
            _replace_marks(conn, provider_id, report.next_marks)
    return report


__all__ = [
    "HistoricGcBlockedError",
    "HistoricGcMark",
    "HistoricGcReport",
    "HistoricGcUnsupportedError",
    "plan_historic_generation_gc",
    "run_historic_snapshot_gc",
]
