"""Published historic tree: family grammar, models, checks and reader traversal.

GC owns scan/mark/race decisions; the public proof owns sampling, deadlines and evidence.
Check functions resolve lazily so builders and storage can use path/write rules without
importing the gate or creating an import cycle.
"""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable, Iterator, Mapping, Sequence
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import date
from functools import partial
from itertools import batched
from types import MappingProxyType
from typing import TYPE_CHECKING, Any, Protocol, TypeVar, cast

from pydantic import BaseModel, ValidationError

from transit_ops.snapshots.contract import (
    AlertArchiveIndex,
    AlertArchivePage,
    AlertArchivePageRef,
    HistoricAvailabilityIndex,
    HistoricCollectionIndex,
    HistoricEntityDirectoryIndex,
    HistoricEntityIndexRef,
    HistoricHotspotsDay,
    HistoricPartitionRef,
    HistoricRepeatOffendersDay,
    LineHistoryPartition,
    Manifest,
    ManifestHistoricFiles,
    NetworkHistoryPartition,
    ReceiptsIndex,
    StopHistoryPartition,
)
from transit_ops.snapshots.paths import safe_public_path
from transit_ops.snapshots.serialization import snapshot_sha256

if TYPE_CHECKING:
    from transit_ops.snapshots.gate import CheckResult
    from transit_ops.snapshots.storage import StoredObjectVersion

_READ_BATCH_SIZE = 256


def pointer_path(prefix: str, payload: BaseModel | Mapping[str, Any]) -> str:
    value = cast("BaseModel | dict[Any, Any]", payload)
    return f"{prefix.rstrip('/')}/generations/{snapshot_sha256(value)}/index.json"


HISTORY_ROOT_PATH = cast(str, ManifestHistoricFiles.model_fields["history_index"].default)


LINE_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("cancellation", "additive"),
    ("occupancy", "additive"),
    ("service_span", "daily_only"),
    ("skipped_stops", "additive"),
)

STOP_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("occupancy", "additive"),
)

_HISTORY_MONTH = r"\d{4}-(?:0[1-9]|1[0-2])"
_NETWORK_HISTORY_ROOT = "historic/history/network"
_NETWORK_HISTORY_PARTITION_PATH_RE = re.compile(
    rf"{_NETWORK_HISTORY_ROOT}/generations/([0-9a-f]{{64}})/({_HISTORY_MONTH})\.json"
)
_NETWORK_HISTORY_INDEX_PATH = f"{_NETWORK_HISTORY_ROOT}/index.json"
_NETWORK_HISTORY_VERSIONED_INDEX_PATH_RE = re.compile(
    rf"{_NETWORK_HISTORY_ROOT}/generations/([0-9a-f]{{64}})/index\.json"
)


def _entity_history_paths(
    family: str,
) -> tuple[re.Pattern[str], re.Pattern[str], re.Pattern[str], re.Pattern[str]]:
    root = rf"historic/history/{family}"
    encoded = r"((?:[0-9a-f]{2})+)"
    return (
        re.compile(rf"{root}/{encoded}/generations/([0-9a-f]{{64}})/({_HISTORY_MONTH})\.json"),
        re.compile(rf"{root}/{encoded}/index\.json"),
        re.compile(rf"{root}/{encoded}/generations/([0-9a-f]{{64}})/index\.json"),
        re.compile(rf"{root}/generations/([0-9a-f]{{64}})/index\.json"),
    )


(
    _LINE_HISTORY_PARTITION_PATH_RE,
    _LINE_HISTORY_ENTITY_INDEX_PATH_RE,
    _LINE_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE,
    _LINE_HISTORY_VERSIONED_DIRECTORY_PATH_RE,
) = _entity_history_paths("lines")
_LINE_HISTORY_DIRECTORY_PATH = "historic/history/lines/index.json"
(
    _STOP_HISTORY_PARTITION_PATH_RE,
    _STOP_HISTORY_ENTITY_INDEX_PATH_RE,
    _STOP_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE,
    _STOP_HISTORY_VERSIONED_DIRECTORY_PATH_RE,
) = _entity_history_paths("stops")
_STOP_HISTORY_DIRECTORY_PATH = "historic/history/stops/index.json"
_STOP_HISTORY_ROOT_PATH = HISTORY_ROOT_PATH
_NETWORK_HISTORY_METRICS = (
    ("delay", "additive"),
    ("delay_percentiles", "daily_only"),
    ("vehicles", "daily_only"),
    ("cancellation", "additive"),
    ("occupancy", "additive"),
)


@dataclass(frozen=True, slots=True)
class HistoryFamilySpec:
    key: str
    family: str
    label: str
    partition_model: type[BaseModel]
    metrics: tuple[tuple[str, str], ...]
    partition_path_re: re.Pattern[str]
    entity_index_path_re: re.Pattern[str] | None
    versioned_index_path_re: re.Pattern[str]
    index_path: str
    versioned_directory_path_re: re.Pattern[str] | None
    day_fields: frozenset[str]
    kinds: Mapping[str, str]
    checks: Mapping[str, str]

    @property
    def entity_scoped(self) -> bool:
        return self.entity_index_path_re is not None


_COMMON_HISTORY_CHECK_NAMES = tuple(
    """contract pointer_sha256 metric_range delay_in_clamp_count delay_in_clamp_partition
    delay_sum_bound vehicle_observation_bound cancellation_universe cancellation_invariant
    partition_path partition_entity partition_month partition_sha256 partition_envelope
    generated_utc duplicate_date date_order index_path index_identity available_dates
    duplicate_ref_path ref_path ref_entity ref_month duplicate_month partition_order
    metric_vocabulary collection_generation_id ref_sha256 ref_byte_size ref_count ref_coverage
    empty_entity directory_path directory_identity entity_order entity_identity
    entity_generation directory_coverage""".split()
)


def _history_spec(
    key: str,
    label: str,
    model: type[BaseModel],
    metrics: tuple[tuple[str, str], ...],
    paths: tuple[
        re.Pattern[str], re.Pattern[str] | None, re.Pattern[str], str, re.Pattern[str] | None
    ],
    day_fields: str,
    specific_checks: str,
) -> HistoryFamilySpec:
    stem = key.removesuffix("s")
    kinds = {
        role: f"historic_{stem}_history_{role}"
        for role in ("partition", "partition_ref", "stream", "index")
    }
    terminal = "bundle" if key == "network" else "directory"
    kinds[terminal] = f"historic_{stem}_history_{terminal}"
    return HistoryFamilySpec(
        key,
        key,
        label,
        model,
        metrics,
        *paths,
        frozenset(day_fields.split()),
        MappingProxyType(kinds),
        MappingProxyType(
            {name: name for name in (*_COMMON_HISTORY_CHECK_NAMES, *specific_checks.split())}
        ),
    )


_HISTORY_FAMILY_SPECS = {
    "network": _history_spec(
        "network",
        "Network",
        NetworkHistoryPartition,
        _NETWORK_HISTORY_METRICS,
        (
            _NETWORK_HISTORY_PARTITION_PATH_RE,
            None,
            _NETWORK_HISTORY_VERSIONED_INDEX_PATH_RE,
            _NETWORK_HISTORY_INDEX_PATH,
            None,
        ),
        "",
        """stream_partitions stream_available_dates stream_coverage stream_metrics
        stream_generated_utc duplicate_built_path missing_partition unreferenced_partition
        metric_coverage""",
    ),
    "lines": _history_spec(
        "lines",
        "Line",
        LineHistoryPartition,
        LINE_HISTORY_METRICS,
        (
            _LINE_HISTORY_PARTITION_PATH_RE,
            _LINE_HISTORY_ENTITY_INDEX_PATH_RE,
            _LINE_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE,
            _LINE_HISTORY_DIRECTORY_PATH,
            _LINE_HISTORY_VERSIONED_DIRECTORY_PATH_RE,
        ),
        "date delay delay_percentiles cancellation occupancy service_span skipped_stops",
        """service_span_timestamp service_span_order line_metric_vocabulary line_stream_indexes
        line_stream_directory duplicate_entity_id duplicate_encoded_id duplicate_index_path""",
    ),
    "stops": _history_spec(
        "stops",
        "Stop",
        StopHistoryPartition,
        STOP_HISTORY_METRICS,
        (
            _STOP_HISTORY_PARTITION_PATH_RE,
            _STOP_HISTORY_ENTITY_INDEX_PATH_RE,
            _STOP_HISTORY_VERSIONED_ENTITY_INDEX_PATH_RE,
            _STOP_HISTORY_DIRECTORY_PATH,
            _STOP_HISTORY_VERSIONED_DIRECTORY_PATH_RE,
        ),
        "date delay delay_percentiles occupancy",
        "stop_metric_vocabulary stop_delay_semantics stop_stream_indexes stop_stream_directory",
    ),
}
_NETWORK_SPEC = _HISTORY_FAMILY_SPECS["network"]
_LINE_SPEC = _HISTORY_FAMILY_SPECS["lines"]
_STOP_SPEC = _HISTORY_FAMILY_SPECS["stops"]


@dataclass(frozen=True)
class TreeEdge:
    path: str
    model: type[BaseModel]
    reference: Any
    checker: Callable[..., Sequence[CheckResult]]
    role: str
    validation_scope: tuple[str, ...]


class TreeReader[ResultT](Protocol):
    def read_many(self, edges: Sequence[TreeEdge]) -> Iterator[tuple[TreeEdge, ResultT]]: ...


@dataclass(frozen=True)
class HistoricFamily:
    name: str
    root: str
    index_model: type[BaseModel]
    leaf_model: type[BaseModel] | None
    index_check: str
    leaf_check: str | None = None
    ref_check: str | None = None
    entity_check: str | None = None

    @property
    def index_path(self) -> str:
        return f"{self.root}/index.json"

    @property
    def entity_scoped(self) -> bool:
        return self.entity_check is not None

    @property
    def selection_mode(self) -> str:
        return "date" if self.name in {"receipts", "hotspots", "repeat_offenders"} else "range"

    def entity_root(self, encoded_id: str) -> str:
        return f"{self.root}/{encoded_id}"

    def entity_index_path(self, encoded_id: str) -> str:
        return f"{self.entity_root(encoded_id)}/index.json"

    def leaf_path(self, digest: str, name: str, *, encoded_id: str | None = None) -> str:
        prefix = self.root if encoded_id is None else self.entity_root(encoded_id)
        return f"{prefix}/generations/{digest}/{name}.json"

    def checker(self, role: str) -> Callable[..., Sequence[CheckResult]]:
        from transit_ops.snapshots import gate

        name = {
            "index": self.index_check,
            "leaf": self.leaf_check,
            "ref": self.ref_check,
            "entity": self.entity_check,
        }[role]
        assert name is not None
        checker = getattr(gate, name)
        if self.name in {"hotspots", "repeat_offenders"} and role in {"index", "ref"}:
            return partial(checker, family=self.name)
        return cast("Callable[..., Sequence[CheckResult]]", checker)

    def edges(self, payload: object) -> tuple[TreeEdge, ...]:
        """One tree level, in publication order, including duplicate references.

        Readers decide how to report missing objects and whether to deduplicate reads.
        The public proof can select edges before reading to preserve its sample budget.
        """
        data = payload.model_dump(mode="json") if isinstance(payload, BaseModel) else payload
        if not isinstance(data, dict):
            return ()
        if self.name == "receipts":
            return ()  # Receipt dates are discovery metadata, not generation children.
        if self.name == "alerts":
            refs = [
                (month, ref) for month in data.get("months", []) for ref in month.get("pages", [])
            ]
            return tuple(
                TreeEdge(
                    ref["path"],
                    AlertArchivePage,
                    (month, ref),
                    self.checker("leaf"),
                    "leaf",
                    ("alerts", month["month"]),
                )
                for month, ref in refs
                if isinstance(ref.get("path"), str)
            )
        if self.entity_scoped and "entities" in data:
            return tuple(
                TreeEdge(
                    ref["index_path"],
                    HistoricCollectionIndex,
                    ref,
                    self.checker("entity"),
                    "entity",
                    (),
                )
                for ref in data["entities"]
                if isinstance(ref.get("index_path"), str)
            )
        assert self.leaf_model is not None
        return tuple(
            TreeEdge(
                ref["path"],
                self.leaf_model,
                ref,
                self.checker("leaf"),
                "leaf",
                (self.name,),
            )
            for ref in (data.get("partitions") or [])
            if isinstance(ref, dict) and isinstance(ref.get("path"), str)
        )

    def walk[ResultT](
        self,
        reader: TreeReader[ResultT],
        payload: object,
    ) -> Iterator[tuple[TreeEdge, ResultT]]:
        """Traverse the next level through the caller's concrete reader port."""
        yield from reader.read_many(self.edges(payload))


FAMILIES: Mapping[str, HistoricFamily] = MappingProxyType(
    {
        "alerts": HistoricFamily(
            "alerts",
            "historic/alerts",
            AlertArchiveIndex,
            AlertArchivePage,
            "check_alert_archive_index",
            "check_alert_archive_page",
        ),
        "receipts": HistoricFamily(
            "receipts", "historic/receipts", ReceiptsIndex, None, "check_receipts_index"
        ),
        "network": HistoricFamily(
            "network",
            _NETWORK_HISTORY_ROOT,
            HistoricCollectionIndex,
            NetworkHistoryPartition,
            "check_network_history_index",
            "check_network_history_partition",
            "check_network_history_partition_ref",
        ),
        "lines": HistoricFamily(
            "lines",
            "historic/history/lines",
            HistoricEntityDirectoryIndex,
            LineHistoryPartition,
            "check_line_history_directory",
            "check_line_history_partition",
            "check_line_history_partition_ref",
            "check_line_history_index",
        ),
        "stops": HistoricFamily(
            "stops",
            "historic/history/stops",
            HistoricEntityDirectoryIndex,
            StopHistoryPartition,
            "check_stop_history_directory",
            "check_stop_history_partition",
            "check_stop_history_partition_ref",
            "check_stop_history_index",
        ),
        "hotspots": HistoricFamily(
            "hotspots",
            "historic/history/hotspots",
            HistoricCollectionIndex,
            HistoricHotspotsDay,
            "check_point_history_index",
            "check_point_history_day",
            "check_point_history_day_ref",
        ),
        "repeat_offenders": HistoricFamily(
            "repeat_offenders",
            "historic/history/repeat_offenders",
            HistoricCollectionIndex,
            HistoricRepeatOffendersDay,
            "check_point_history_index",
            "check_point_history_day",
            "check_point_history_day_ref",
        ),
    }
)
RANGE_FAMILIES = tuple(_HISTORY_FAMILY_SPECS)
POINT_MODELS = {name: FAMILIES[name].leaf_model for name in ("hotspots", "repeat_offenders")}
WRITE_ONCE_TIER = "historic_immutable"


def write_once(path: str, tier: str | None = None) -> bool:
    # Preserve legacy callers that explicitly tag immutable keys, including non-tree keys.
    return tier == WRITE_ONCE_TIER or "/generations/" in path


def upload_mode(items: Sequence[tuple[str, object, str]]) -> str:
    immutable = {write_once(path, tier) for path, _payload, tier in items}
    if immutable == {True}:
        return "immutable"
    return "historic" if True in immutable else "normal"


def preserve_leaf_envelope(payload: object) -> bool:
    # Leaf hashes exist before publishing; parent hashes are computed after run stamping.
    return isinstance(
        payload,
        tuple(family.leaf_model for family in FAMILIES.values() if family.leaf_model is not None),
    )


@dataclass
class MemoryTreeReader:
    objects: Mapping[str, object]

    def read_many(self, edges: Sequence[TreeEdge]) -> Iterator[tuple[TreeEdge, object]]:
        for edge in edges:
            yield edge, self.objects.get(edge.path)


@dataclass
class PublicHttpTreeReader[ResultT]:
    # The proof's bounded HTTP loader retains transport, retry, deadline and evidence policy.
    fetch_models: Callable[[list[tuple[str, type[BaseModel]]]], Sequence[ResultT]]

    def read_many(self, edges: Sequence[TreeEdge]) -> Iterator[tuple[TreeEdge, ResultT]]:
        results = self.fetch_models([(edge.path, edge.model) for edge in edges])
        yield from zip(edges, results, strict=True)


_SHA = r"[0-9a-f]{64}"
_MONTH = r"\d{4}-(?:0[1-9]|1[0-2])"
_DAY = rf"{_MONTH}-(?:0[1-9]|[12]\d|3[01])"
_VERSIONED_DIGEST = re.compile(rf"(?:^|/)generations/({_SHA})/")
_LEGACY_ROOTS = {
    name: family.index_path
    for name, family in FAMILIES.items()
    if name not in {"alerts", "receipts"}
}
_CANONICAL_ROOTS = {
    "history": _STOP_HISTORY_ROOT_PATH,
    **{name: FAMILIES[name].index_path for name in ("alerts", "receipts")},
}


def family_path_role(path: str, *, strict: bool = False) -> tuple[HistoricFamily, str] | None:
    """Gate allows malformed dates through routing so its checker can diagnose them.

    GC's inventory grammar is stricter: unknown or impossible generation keys block
    the whole scan, including otherwise unreachable objects.
    """
    for family in FAMILIES.values():
        root = re.escape(family.root)
        if re.fullmatch(rf"{root}/generations/{_SHA}/index\.json", path):
            return family, "index"
        if family.entity_scoped and re.fullmatch(
            rf"{root}/(?:[0-9a-f]{{2}})+/(?:generations/{_SHA}/)?index\.json",
            path,
        ):
            return family, "entity"
        if family.name in RANGE_FAMILIES:
            if _HISTORY_FAMILY_SPECS[family.name].partition_path_re.fullmatch(path):
                return family, "leaf"
        elif family.name == "alerts":
            month = _MONTH if strict else r"\d{4}-\d{2}"
            if re.fullmatch(rf"{root}/generations/{_SHA}/{month}/page-\d{{4}}\.json", path):
                return family, "leaf"
        elif family.name in POINT_MODELS:
            day = _DAY if strict else r"\d{4}-\d{2}-\d{2}"
            if re.fullmatch(rf"{root}/generations/{_SHA}/{day}\.json", path):
                return family, "leaf"
    return None


def point_family_from_path(path: str, *, index: bool) -> str | None:
    matched = family_path_role(path)
    if matched is None:
        return None
    family, role = matched
    return (
        family.name
        if family.name in POINT_MODELS and role == ("index" if index else "leaf")
        else None
    )


def point_leaf_match(family: str, path: str) -> re.Match[str] | None:
    return re.fullmatch(
        rf"{re.escape(FAMILIES[family].root)}/generations/({_SHA})/(\d{{4}}-\d{{2}}-\d{{2}})\.json",
        path,
    )


def index_path_pattern(family: str) -> re.Pattern[str]:
    return re.compile(rf"{re.escape(FAMILIES[family].root)}/generations/({_SHA})/index\.json")


def point_index_match(family: str, path: str) -> re.Match[str] | None:
    return index_path_pattern(family).fullmatch(path)


ARCHIVE_PAGE_PATH_RE = re.compile(
    rf"^{re.escape(FAMILIES['alerts'].root)}/generations/({_SHA})/"
    r"(\d{4}-\d{2})/page-(\d{4})\.json$"
)


def route_payload(path: str) -> tuple[Callable[..., Sequence[CheckResult]], str] | None:
    from transit_ops.snapshots import gate

    if path == _STOP_HISTORY_ROOT_PATH:
        return gate.check_history_availability_index, "historic_availability_index"
    for family in FAMILIES.values():
        if path == family.index_path and family.name not in POINT_MODELS:
            role = "index"
            break
    else:
        match = family_path_role(path)
        if match is None:
            # Preserve the gate's legacy diagnostics for malformed network/archive
            # generation keys. GC never uses this permissive routing fallback.
            for name in ("network", "alerts"):
                family = FAMILIES[name]
                if path.startswith(family.root + "/generations/"):
                    kind = (
                        "historic_network_history_partition"
                        if name == "network"
                        else "historic_alert_archive_page"
                    )
                    return family.checker("leaf"), kind
            return None
        family, role = match
    if family.name in POINT_MODELS:
        return family.checker(
            role
        ), f"historic_point_history_{'day' if role == 'leaf' else 'index'}"
    if family.name == "alerts":
        kind = f"historic_alert_archive_{'page' if role == 'leaf' else 'index'}"
    elif family.name == "receipts":
        kind = "historic_receipts_index"
    else:
        spec = _HISTORY_FAMILY_SPECS[family.name]
        kind = spec.kinds[
            "partition"
            if role == "leaf"
            else ("directory" if role == "index" and family.entity_scoped else "index")
        ]
    return family.checker(role), kind


class HistoricGcBlockedError(RuntimeError):
    """The graph or inventory was incomplete, malformed, or changed mid-scan."""


class HistoricGcUnsupportedError(RuntimeError):
    """A destructive mode was requested before its storage canary exists."""


class HistoricGcStorage(Protocol):
    def read_bytes_at_version(
        self,
        rel_key: str,
        expected_version: StoredObjectVersion,
    ) -> bytes: ...

    def capture_object_version(self, rel_key: str) -> StoredObjectVersion | None: ...

    def iter_object_versions(self, rel_prefix: str) -> Iterator[StoredObjectVersion]: ...


ModelT = TypeVar("ModelT", bound=BaseModel)


def _decode_payload[PayloadT: BaseModel](
    raw: bytes,
    model: type[PayloadT],
    *,
    path: str,
) -> PayloadT:
    def reject_constant(_value: str) -> None:
        raise ValueError

    try:
        decoded = json.loads(raw, parse_constant=reject_constant)
        return model.model_validate(decoded)
    except (UnicodeError, ValueError, ValidationError) as exc:
        raise HistoricGcBlockedError(f"malformed_payload:{path}") from exc


@dataclass(frozen=True)
class _LoadRequest:
    path: str
    model: type[BaseModel]
    checker: Callable[..., Sequence[CheckResult]] | None = None
    optional: bool = False
    expected_version: StoredObjectVersion | None = None


@dataclass(frozen=True)
class _LoadedObject:
    path: str
    version: StoredObjectVersion
    payload: BaseModel
    digest: str
    byte_size: int


@dataclass
class StoredVersionReader:
    storage: HistoricGcStorage
    inventory: Mapping[str, StoredObjectVersion]
    executor: ThreadPoolExecutor
    initial_optional_roots: Mapping[str, StoredObjectVersion | None]
    reachable: set[str] = field(default_factory=set)
    observed: dict[str, StoredObjectVersion] = field(default_factory=dict)
    retained: dict[str, _LoadedObject] = field(default_factory=dict)
    validated_leaf_refs: dict[str, tuple[str, ...]] = field(default_factory=dict)

    def _fetch(self, request: _LoadRequest) -> _LoadedObject | None:
        from transit_ops.snapshots.storage import StoredObjectVersionMismatchError

        path = request.path
        try:
            safe_public_path(path)
        except (TypeError, ValueError) as exc:
            raise HistoricGcBlockedError(f"unsafe_path:{path}") from exc
        version = self.inventory.get(path)
        if version is None:
            if request.optional:
                return None
            raise HistoricGcBlockedError(f"missing_object:{path}")
        if request.expected_version is not None and version != request.expected_version:
            raise HistoricGcBlockedError(f"inventory_version_mismatch:{path}")
        try:
            raw = self.storage.read_bytes_at_version(path, version)
        except StoredObjectVersionMismatchError as exc:
            raise HistoricGcBlockedError(f"object_changed:{path}:{exc.reason}") from exc
        digest = hashlib.sha256(raw).hexdigest()
        if write_once(path):
            match = _VERSIONED_DIGEST.search(path)
            if match is None or digest != match.group(1):
                raise HistoricGcBlockedError(f"generation_digest_mismatch:{path}")
        return _LoadedObject(
            path=path,
            version=version,
            payload=_decode_payload(raw, request.model, path=path),
            digest=digest,
            byte_size=len(raw),
        )

    def _record(
        self,
        request: _LoadRequest,
        loaded: _LoadedObject | None,
        *,
        retain: bool,
    ) -> _LoadedObject | None:
        if loaded is None:
            return None
        if loaded.path != request.path:
            raise HistoricGcBlockedError(f"path_conflict:{request.path}")
        if request.expected_version is not None and loaded.version != request.expected_version:
            raise HistoricGcBlockedError(f"inventory_version_mismatch:{request.path}")
        if not isinstance(loaded.payload, request.model):
            raise HistoricGcBlockedError(f"model_conflict:{request.path}")
        if request.checker is not None:
            self.require_checks(
                request.checker(loaded.payload, rel_key=request.path),
                path=request.path,
            )
        self.observed[request.path] = loaded.version
        if write_once(request.path):
            self.reachable.add(request.path)
        if retain:
            self.retained[request.path] = loaded
        return loaded

    def iter_loaded(
        self,
        requests: Sequence[_LoadRequest],
        *,
        retain: bool,
    ) -> Iterator[_LoadedObject | None]:
        for request_batch in batched(requests, _READ_BATCH_SIZE):
            ordered: list[
                tuple[_LoadRequest, _LoadedObject | None, Future[_LoadedObject | None] | None]
            ] = []
            pending: dict[str, tuple[_LoadRequest, Future[_LoadedObject | None]]] = {}
            for request in request_batch:
                cached = self.retained.get(request.path)
                if cached is not None:
                    ordered.append((request, cached, None))
                    continue
                existing = pending.get(request.path)
                if existing is not None:
                    first, future = existing
                    if (
                        first.model is not request.model
                        or first.optional != request.optional
                        or first.expected_version != request.expected_version
                    ):
                        raise HistoricGcBlockedError(f"load_request_conflict:{request.path}")
                    ordered.append((request, None, future))
                    continue
                future = self.executor.submit(self._fetch, request)
                pending[request.path] = (request, future)
                ordered.append((request, None, future))
            for request, cached, pending_future in ordered:
                loaded = cached if pending_future is None else pending_future.result()
                yield self._record(request, loaded, retain=retain)

    def iter_unique_leaves[ContextT](
        self,
        entries: Sequence[tuple[ContextT, _LoadRequest, tuple[str, ...]]],
    ) -> Iterator[tuple[ContextT, _LoadedObject]]:
        pending: list[tuple[ContextT, _LoadRequest]] = []
        for context, request, validation_key in entries:
            prior = self.validated_leaf_refs.get(request.path)
            if prior is not None:
                if prior != validation_key:
                    raise HistoricGcBlockedError(f"leaf_reference_conflict:{request.path}")
                continue
            self.validated_leaf_refs[request.path] = validation_key
            pending.append((context, request))
        loaded_items = self.iter_loaded([request for _context, request in pending], retain=False)
        for (context, _request), loaded in zip(pending, loaded_items, strict=True):
            assert loaded is not None
            yield context, loaded

    def load(
        self,
        path: str,
        model: type[ModelT],
        *,
        checker: Callable[..., Sequence[CheckResult]] | None = None,
        optional: bool = False,
        expected_version: StoredObjectVersion | None = None,
    ) -> ModelT | None:
        loaded = next(
            self.iter_loaded(
                [
                    _LoadRequest(
                        path=path,
                        model=model,
                        checker=checker,
                        optional=optional,
                        expected_version=expected_version,
                    )
                ],
                retain=True,
            )
        )
        if loaded is None:
            return None
        return cast(ModelT, loaded.payload)

    @staticmethod
    def require_checks(findings: Sequence[CheckResult], *, path: str) -> None:
        from transit_ops.snapshots import gate

        errors = sorted(
            {finding.check for finding in findings if finding.severity is gate.Severity.ERROR}
        )
        if errors:
            raise HistoricGcBlockedError(f"gate_failed:{path}:{','.join(errors)}")

    def require_exact_copy(self, prefix: str, payload: ModelT) -> tuple[str, ModelT]:
        exact_path = pointer_path(prefix, payload)
        exact = self.load(exact_path, type(payload))
        if exact is None or exact.model_dump(mode="json") != payload.model_dump(mode="json"):
            raise HistoricGcBlockedError(f"pointer_copy_mismatch:{exact_path}")
        return exact_path, exact

    def read_many(self, edges: Sequence[TreeEdge]) -> Iterator[tuple[TreeEdge, _LoadedObject]]:
        if not edges:
            return
        if edges[0].role == "entity":
            loaded = self.iter_loaded(
                [_LoadRequest(edge.path, edge.model, edge.checker) for edge in edges], retain=True
            )
            for edge, result in zip(edges, loaded, strict=True):
                assert result is not None
                yield edge, result
        else:
            entries = []
            for edge in edges:
                reference = (
                    AlertArchivePageRef.model_validate(edge.reference[1])
                    if edge.validation_scope[0] == "alerts"
                    else HistoricPartitionRef.model_validate(edge.reference)
                )
                validation_key = (*edge.validation_scope, reference.model_dump_json())
                entries.append(
                    (edge, _LoadRequest(edge.path, edge.model, edge.checker), validation_key)
                )
            yield from self.iter_unique_leaves(entries)

    def walk_alerts(self, path: str) -> AlertArchiveIndex:
        from transit_ops.snapshots import gate

        index = self.load(path, AlertArchiveIndex, checker=gate.check_alert_archive_index)
        assert index is not None
        for edge, loaded in FAMILIES["alerts"].walk(self, index):
            month_data, ref_data = edge.reference
            month_name = month_data["month"]
            ref = AlertArchivePageRef.model_validate(ref_data)
            page = cast(AlertArchivePage, loaded.payload)
            if (
                loaded.digest != ref.sha256
                or loaded.byte_size != ref.byte_size
                or len(page.alerts) != ref.count
                or page.month != month_name
                or page.page != ref.page
            ):
                raise HistoricGcBlockedError(f"alert_page_ref_mismatch:{ref.path}")
        return index

    def walk_receipts(self, path: str) -> ReceiptsIndex:
        from transit_ops.snapshots import gate

        index = self.load(path, ReceiptsIndex, checker=gate.check_receipts_index)
        assert index is not None
        return index

    def walk_network(self, path: str) -> HistoricCollectionIndex:
        from transit_ops.snapshots import gate

        index = self.load(path, HistoricCollectionIndex, checker=gate.check_network_history_index)
        assert index is not None
        for edge, loaded in FAMILIES["network"].walk(self, index):
            ref = HistoricPartitionRef.model_validate(edge.reference)
            partition = cast(NetworkHistoryPartition, loaded.payload)
            self.require_checks(
                gate.check_network_history_partition_ref(ref, partition),
                path=ref.path,
            )
        return index

    def walk_point(self, family: str, path: str) -> HistoricCollectionIndex:
        from transit_ops.snapshots import gate

        index = self.load(
            path,
            HistoricCollectionIndex,
            checker=lambda value, *, rel_key: gate.check_point_history_index(
                value,
                rel_key=rel_key,
                family=family,
            ),
        )
        assert index is not None
        for edge, loaded in FAMILIES[family].walk(self, index):
            ref = HistoricPartitionRef.model_validate(edge.reference)
            day = loaded.payload
            self.require_checks(
                gate.check_point_history_day_ref(ref, day, family=family),
                path=ref.path,
            )
        return index

    def walk_entities(
        self,
        family: str,
        path: str,
    ) -> tuple[HistoricEntityDirectoryIndex, list[HistoricCollectionIndex]]:

        directory_checker = FAMILIES[family].checker("index")
        ref_checker = FAMILIES[family].checker("ref")
        directory = self.load(path, HistoricEntityDirectoryIndex, checker=directory_checker)
        assert directory is not None
        indexes: list[HistoricCollectionIndex] = []
        for tree_edge, loaded in FAMILIES[family].walk(self, directory):
            edge = HistoricEntityIndexRef.model_validate(tree_edge.reference)
            child = cast(HistoricCollectionIndex, loaded.payload)
            if (
                child.entity_id != edge.entity_id
                or child.collection_generation_id != edge.collection_generation_id
                or child.first_available_date != edge.first_available_date
                or child.last_available_date != edge.last_available_date
            ):
                raise HistoricGcBlockedError(f"entity_edge_mismatch:{edge.index_path}")
            indexes.append(child)
        partition_edges = tuple(edge for child in indexes for edge in FAMILIES[family].edges(child))
        for partition_edge, loaded in self.read_many(partition_edges):
            ref = HistoricPartitionRef.model_validate(partition_edge.reference)
            self.require_checks(ref_checker(ref, loaded.payload), path=ref.path)
        return directory, indexes

    def walk_legacy_root(self, family: str, path: str) -> None:
        from transit_ops.snapshots import gate

        initial_version = self.initial_optional_roots[path]
        if initial_version is None:
            return
        prefix = path.removesuffix("/index.json")
        payload: HistoricCollectionIndex | HistoricEntityDirectoryIndex | None
        if family == "network":
            payload = self.load(
                path,
                HistoricCollectionIndex,
                checker=gate.check_network_history_index,
                expected_version=initial_version,
            )
            assert payload is not None
            entries = [
                (
                    ref,
                    _LoadRequest(
                        ref.path,
                        NetworkHistoryPartition,
                        gate.check_network_history_partition,
                    ),
                    ("network", ref.model_dump_json()),
                )
                for ref in payload.partitions
            ]
            for ref, loaded in self.iter_unique_leaves(entries):
                self.require_checks(
                    gate.check_network_history_partition_ref(ref, loaded.payload),
                    path=ref.path,
                )
        elif family in {"hotspots", "repeat_offenders"}:
            stable = self.load(
                path,
                HistoricCollectionIndex,
                expected_version=initial_version,
            )
            assert stable is not None
            exact_path, _exact = self.require_exact_copy(prefix, stable)
            self.walk_point(family, exact_path)
            return
        else:
            payload = self.load(
                path,
                HistoricEntityDirectoryIndex,
                checker=gate.check_line_history_directory
                if family == "lines"
                else gate.check_stop_history_directory,
                expected_version=initial_version,
            )
            assert payload is not None
            payload, _indexes = self.walk_entities(family, path)
        self.require_exact_copy(prefix, payload)
        if family not in {"lines", "stops"}:
            return
        assert isinstance(payload, HistoricEntityDirectoryIndex)
        for edge in payload.entities:
            if write_once(edge.index_path):
                continue
            child = self.load(
                edge.index_path,
                HistoricCollectionIndex,
                checker=gate.check_line_history_index
                if family == "lines"
                else gate.check_stop_history_index,
            )
            assert child is not None
            self.require_exact_copy(edge.index_path.removesuffix("/index.json"), child)


def _known_generation_shape(path: str) -> bool:
    if "/generations/" not in path or family_path_role(path, strict=True) is None:
        return False
    filename = path.rsplit("/", 1)[-1].removesuffix(".json")
    if re.fullmatch(_DAY, filename) is not None:
        try:
            return date.fromisoformat(filename).isoformat() == filename
        except ValueError:
            return False
    return True


def _generation_candidate_request(version: StoredObjectVersion) -> _LoadRequest:
    matched = family_path_role(version.rel_key, strict=True)
    if matched is None:
        raise HistoricGcBlockedError(f"unknown_generation_shape:{version.rel_key}")
    family, role = matched
    model = (
        family.index_model
        if role == "index"
        else (HistoricCollectionIndex if role == "entity" else family.leaf_model)
    )
    assert model is not None
    return _LoadRequest(version.rel_key, model, family.checker(role), expected_version=version)


def _read_manifest(
    storage: HistoricGcStorage,
    version: StoredObjectVersion | None,
) -> Manifest | None:

    if version is None:
        return None
    from transit_ops.snapshots.storage import StoredObjectVersionMismatchError

    path = "manifest.json"
    try:
        raw = storage.read_bytes_at_version(path, version)
    except StoredObjectVersionMismatchError as exc:
        raise HistoricGcBlockedError(f"manifest_changed:{exc.reason}") from exc
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
        "history": (manifest.files.historic.history_index, HISTORY_ROOT_PATH),
        "alerts": (manifest.files.historic.alerts_index, FAMILIES["alerts"].index_path),
        "receipts": (manifest.files.historic.receipts_index, FAMILIES["receipts"].index_path),
    }
    for name, (actual, expected) in mandatory_paths.items():
        if actual != expected:
            raise HistoricGcBlockedError(f"mandatory_root_path:{name}:{actual}")


def _walk_reachable_graph(
    storage: HistoricGcStorage,
    *,
    inventory: Mapping[str, StoredObjectVersion],
    executor: ThreadPoolExecutor,
    initial_optional_roots: Mapping[str, StoredObjectVersion | None],
    manifest: Manifest | None,
    provider_id: str | None,
) -> tuple[
    set[str],
    dict[str, StoredObjectVersion],
    tuple[str, tuple[tuple[str, str], ...]] | None,
    dict[str, StoredObjectVersion | None],
]:
    from transit_ops.snapshots import gate

    walker = StoredVersionReader(
        storage=storage,
        inventory=inventory,
        executor=executor,
        initial_optional_roots=initial_optional_roots,
    )
    if manifest is None:
        history_path = _CANONICAL_ROOTS["history"]
        compatibility_alerts_path = _CANONICAL_ROOTS["alerts"]
        compatibility_receipts_path = _CANONICAL_ROOTS["receipts"]
        manifest_identity = None
    else:
        _require_manifest_roots(manifest, provider_id=provider_id)
        history_path = manifest.files.historic.history_index
        compatibility_alerts_path = manifest.files.historic.alerts_index
        compatibility_receipts_path = manifest.files.historic.receipts_index
        manifest_identity = _manifest_graph_identity(manifest)

    list(
        walker.iter_loaded(
            [
                _LoadRequest(
                    history_path,
                    HistoricAvailabilityIndex,
                    gate.check_history_availability_index,
                ),
                _LoadRequest(
                    compatibility_alerts_path,
                    AlertArchiveIndex,
                    gate.check_alert_archive_index,
                ),
                _LoadRequest(
                    compatibility_receipts_path,
                    ReceiptsIndex,
                    gate.check_receipts_index,
                ),
            ],
            retain=True,
        )
    )
    root = walker.load(
        history_path,
        HistoricAvailabilityIndex,
        checker=gate.check_history_availability_index,
    )
    assert root is not None

    compatibility_alerts = walker.walk_alerts(compatibility_alerts_path)
    compatibility_alerts_exact_path, compatibility_alerts_exact = walker.require_exact_copy(
        "historic/alerts",
        compatibility_alerts,
    )
    compatibility_receipts = walker.walk_receipts(compatibility_receipts_path)
    walker.require_exact_copy("historic/receipts", compatibility_receipts)

    edges = {edge.family: edge for edge in root.families}
    expected = set(FAMILIES)
    if set(edges) != expected:
        raise HistoricGcBlockedError("history_root_family_set")

    list(
        walker.iter_loaded(
            [
                _LoadRequest(
                    edges[name].index_path,
                    FAMILIES[name].index_model,
                    FAMILIES[name].checker("index"),
                )
                for name in (
                    "alerts",
                    "receipts",
                    "network",
                    "hotspots",
                    "repeat_offenders",
                    "lines",
                    "stops",
                )
            ],
            retain=True,
        )
    )

    if edges["alerts"].index_path == compatibility_alerts_exact_path:
        alert_index = compatibility_alerts_exact
    else:
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
        gate.check_history_availability_graph(
            root,
            alert_index=alert_index,
            receipts_index=receipts_index,
            network_index=network_index,
            line_directory=line_directory,
            line_indexes=cast(list[object], line_indexes),
            stop_directory=stop_directory,
            stop_indexes=cast(list[object], stop_indexes),
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
        dict(walker.observed),
        manifest_identity,
        dict(initial_optional_roots),
    )
