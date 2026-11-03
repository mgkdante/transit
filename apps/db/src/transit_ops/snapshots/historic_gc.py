from __future__ import annotations

from collections.abc import Mapping, Sequence
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import UTC, datetime, timedelta
from itertools import batched
from typing import Literal
from uuid import uuid4

from sqlalchemy import text
from sqlalchemy.engine import Engine

from transit_ops.db.connection import make_engine
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.snapshots.historic_tree import (
    _LEGACY_ROOTS,
    HistoricGcBlockedError,
    HistoricGcStorage,
    HistoricGcUnsupportedError,
    _generation_candidate_request,
    _known_generation_shape,
    _manifest_graph_identity,
    _read_manifest,
    _walk_reachable_graph,
)
from transit_ops.snapshots.historic_tree import (
    StoredVersionReader as _GraphWalker,
)
from transit_ops.snapshots.paths import safe_public_path
from transit_ops.snapshots.publication_lane import acquire_publication_lane
from transit_ops.snapshots.storage import (
    StoredObjectVersion,
    build_snapshot_storage,
)

GcMode = Literal["dry-run", "mark", "apply"]
MIN_UNREACHABLE = timedelta(hours=48)
HISTORIC_GC_READ_CONCURRENCY = 16
_READ_BATCH_SIZE = 256


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


def _capture_versions(
    storage: HistoricGcStorage,
    executor: ThreadPoolExecutor,
    paths: Sequence[str],
) -> dict[str, StoredObjectVersion | None]:
    captured: dict[str, StoredObjectVersion | None] = {}
    for path_batch in batched(paths, _READ_BATCH_SIZE):
        futures = [
            (path, executor.submit(storage.capture_object_version, path)) for path in path_batch
        ]
        for path, future in futures:
            captured[path] = future.result()
    return captured


def _inventory_historic_objects(
    storage: HistoricGcStorage,
) -> tuple[dict[str, StoredObjectVersion], dict[str, StoredObjectVersion]]:
    inventory: dict[str, StoredObjectVersion] = {}
    candidates: dict[str, StoredObjectVersion] = {}
    for version in storage.iter_object_versions("historic/"):
        path = version.rel_key
        try:
            safe_public_path(path)
        except (TypeError, ValueError) as exc:
            raise HistoricGcBlockedError(f"unsafe_inventory_path:{path}") from exc
        if path in inventory:
            raise HistoricGcBlockedError(f"duplicate_inventory_key:{path}")
        inventory[path] = version
        if "/generations/" not in path:
            continue
        if not _known_generation_shape(path):
            raise HistoricGcBlockedError(f"unknown_generation_shape:{path}")
        candidates[path] = version
    return inventory, candidates


def plan_historic_generation_gc(
    storage: HistoricGcStorage,
    *,
    now: datetime,
    mode: GcMode = "dry-run",
    existing_marks: Mapping[str, HistoricGcMark] | None = None,
    min_unreachable: timedelta = MIN_UNREACHABLE,
    provider_id: str | None = None,
) -> HistoricGcReport:

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
    with ThreadPoolExecutor(max_workers=HISTORIC_GC_READ_CONCURRENCY) as executor:
        initial_versions = _capture_versions(
            storage,
            executor,
            ["manifest.json", *_LEGACY_ROOTS.values()],
        )
        initial_manifest_version = initial_versions["manifest.json"]
        manifest = _read_manifest(storage, initial_manifest_version)
        optional_roots = {path: initial_versions[path] for path in _LEGACY_ROOTS.values()}
        inventory, candidates = _inventory_historic_objects(storage)
        reachable, roots, manifest_identity, optional_roots = _walk_reachable_graph(
            storage,
            inventory=inventory,
            executor=executor,
            initial_optional_roots=optional_roots,
            manifest=manifest,
            provider_id=provider_id,
        )

        missing = sorted(reachable - candidates.keys())
        if missing:
            raise HistoricGcBlockedError(
                f"reachable_generation_missing_from_inventory:{missing[0]}"
            )
        unreachable = sorted(candidates.keys() - reachable)
        candidate_walker = _GraphWalker(
            storage=storage,
            inventory=inventory,
            executor=executor,
            initial_optional_roots=optional_roots,
        )
        for path_batch in batched(unreachable, _READ_BATCH_SIZE):
            requests = [_generation_candidate_request(candidates[path]) for path in path_batch]
            for _loaded in candidate_walker.iter_loaded(requests, retain=False):
                pass

        observed_objects = {**roots, **candidate_walker.observed}
        final_versions = _capture_versions(
            storage,
            executor,
            sorted({"manifest.json", *optional_roots, *observed_objects}),
        )
        current_manifest_version = final_versions["manifest.json"]
        if current_manifest_version != initial_manifest_version:
            if current_manifest_version is None or initial_manifest_version is None:
                raise HistoricGcBlockedError("manifest_changed_after_inventory")
            current_manifest = _read_manifest(storage, current_manifest_version)
            assert current_manifest is not None
            if _manifest_graph_identity(current_manifest) != manifest_identity:
                raise HistoricGcBlockedError("manifest_changed_after_inventory")
            closing_manifest_version = _capture_versions(
                storage,
                executor,
                ["manifest.json"],
            )["manifest.json"]
            if closing_manifest_version != current_manifest_version:
                raise HistoricGcBlockedError("manifest_changed_after_inventory")
        for path, observed in optional_roots.items():
            if final_versions[path] != observed:
                raise HistoricGcBlockedError(f"optional_root_changed_after_inventory:{path}")
        for path, observed in observed_objects.items():
            if final_versions[path] != observed:
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

    if mode == "apply":
        raise HistoricGcUnsupportedError(
            "apply is disabled until an R2 conditional-delete canary proves atomic semantics"
        )
    registry.get_provider(provider_id)
    resolved_engine = engine or make_engine(settings)
    resolved_storage = storage or build_snapshot_storage(settings, provider_id=provider_id)
    scanned_at = now or datetime.now(UTC)
    with resolved_engine.begin() as conn:
        acquire_publication_lane(conn, provider_id=provider_id, tier="historic")
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
