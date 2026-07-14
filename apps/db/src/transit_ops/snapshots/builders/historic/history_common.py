"""Shared identity, coverage, and serialization helpers for retained history."""

from __future__ import annotations

import hashlib
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, date, datetime, time, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel

from transit_ops.snapshots.contract import (
    HistoricCollectionIndex,
    HistoricCoverageGap,
    HistoricEntityDirectoryIndex,
    HistoricHotspotsDay,
    HistoricMetricCoverage,
    HistoricPartitionRef,
    HistoricRepeatOffendersDay,
    HistoryMetricAggregation,
    HistoryMetricName,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes, snapshot_sha256

_CANONICAL_ENTITY_ID = re.compile(r"(?:[0-9a-f]{2})+")


def history_collection_generation_id(canonical: dict) -> str:  # type: ignore[type-arg]
    """Digest canonical collection identity through the shared byte authority."""

    return snapshot_sha256(canonical)


def history_collection_generation_basis(index: BaseModel | Mapping[str, Any]) -> dict[str, Any]:
    """Return the stable semantic fields that identify one collection index."""

    if isinstance(index, BaseModel):
        payload = index.model_dump(mode="json")
    else:
        payload = dict(index)
    fields = (
        "family",
        "selection_mode",
        "entity_id",
        "first_available_date",
        "last_available_date",
        "available_dates",
        "gaps",
        "partitions",
        "metrics",
    )
    return {field: payload.get(field) for field in fields}


def history_index_generation_id(index: BaseModel | Mapping[str, Any]) -> str:
    """Digest an index without volatile envelope or publication timestamps."""

    return history_collection_generation_id(history_collection_generation_basis(index))


def history_entity_directory_generation_id(
    directory: BaseModel | Mapping[str, Any],
) -> str:
    """Digest one entity directory including every exact child-generation edge."""

    if isinstance(directory, BaseModel):
        payload = directory.model_dump(mode="json")
    else:
        payload = dict(directory)
    return history_collection_generation_id(
        {
            "family": payload.get("family"),
            "selection_mode": payload.get("selection_mode"),
            "first_available_date": payload.get("first_available_date"),
            "last_available_date": payload.get("last_available_date"),
            "entities": payload.get("entities"),
        }
    )


def history_pointer_path(prefix: str, payload: BaseModel | Mapping[str, Any]) -> str:
    """Return the immutable exact-byte index path for one retained-history pointer."""

    return f"{prefix.rstrip('/')}/generations/{snapshot_sha256(payload)}/index.json"


def readdress_history_directory(
    directory: HistoricEntityDirectoryIndex,
    index_paths: Mapping[str, str],
) -> HistoricEntityDirectoryIndex:
    """Copy a directory onto exact child paths and recompute its semantic generation."""

    result = directory.model_copy(deep=True)
    for entity in result.entities:
        entity.index_path = index_paths[entity.entity_id]
    result.collection_generation_id = history_entity_directory_generation_id(result)
    return result


def history_date(value: object, *, field: str = "local_date") -> str:
    """Normalize a database local-date value to canonical ``YYYY-MM-DD``."""

    if isinstance(value, datetime):
        value = value.date()
    if isinstance(value, date):
        return value.isoformat()
    if isinstance(value, str):
        try:
            parsed = date.fromisoformat(value)
        except ValueError as exc:
            raise ValueError(f"{field} must be a valid local calendar date") from exc
        if parsed.isoformat() == value:
            return value
    raise ValueError(f"{field} must be a valid local calendar date")


def iter_history_date_groups(
    rows: Iterable[Mapping[str, Any]],
    *,
    field: str = "local_date",
):  # type: ignore[no-untyped-def]
    """Yield ordered date groups with at most one row of source lookahead.

    Retained-history SQL owns the sort. Failing closed here prevents a later
    append or query-plan change from silently corrupting bounded rolling state.
    """

    current: str | None = None
    grouped: list[Mapping[str, Any]] = []
    for row in rows:
        local_date = history_date(row.get(field), field=field)
        if current is not None and local_date < current:
            raise ValueError(f"history rows must be ordered by {field}")
        if current is not None and local_date != current:
            yield current, grouped
            grouped = []
        current = local_date
        grouped.append(row)
    if current is not None:
        yield current, grouped


@dataclass(frozen=True)
class _HistoryNameInterval:
    name: str | None
    valid_from_utc: datetime
    valid_to_utc: datetime | None


class HistoryNameIndex:
    """Provider-local closing-instant lookup over append-only name intervals."""

    def __init__(
        self,
        rows: Iterable[Mapping[str, Any]],
        *,
        provider_timezone: str,
    ) -> None:
        try:
            self._timezone = ZoneInfo(provider_timezone)
        except ZoneInfoNotFoundError as exc:
            raise ValueError(f"unknown provider timezone {provider_timezone!r}") from exc
        intervals: dict[tuple[str, str], list[_HistoryNameInterval]] = defaultdict(list)
        for row in rows:
            kind = row.get("entity_kind")
            entity_id = row.get("entity_id")
            if kind not in {"route", "stop"}:
                raise ValueError("history name entity_kind must be route or stop")
            if not isinstance(entity_id, str) or not entity_id:
                raise ValueError("history name entity_id must be nonempty")
            name = row.get("name")
            if name is not None and not isinstance(name, str):
                raise ValueError("history name must be a string or null")
            valid_from = _history_datetime(row.get("valid_from_utc"), field="valid_from_utc")
            valid_to_value = row.get("valid_to_utc")
            valid_to = (
                None
                if valid_to_value is None
                else _history_datetime(valid_to_value, field="valid_to_utc")
            )
            intervals[(kind, entity_id)].append(_HistoryNameInterval(name, valid_from, valid_to))
        self._intervals = {
            key: tuple(sorted(values, key=lambda value: value.valid_from_utc))
            for key, values in intervals.items()
        }

    def name_at(self, kind: str, entity_id: str, local_date: str) -> str | None:
        """Resolve the interval in force immediately before next local midnight."""

        parsed = date.fromisoformat(history_date(local_date, field="date"))
        closing_utc = datetime.combine(
            parsed + timedelta(days=1),
            time.min,
            tzinfo=self._timezone,
        ).astimezone(UTC)
        candidates = [
            interval
            for interval in self._intervals.get((kind, entity_id), ())
            if interval.valid_from_utc < closing_utc
            and (interval.valid_to_utc is None or interval.valid_to_utc >= closing_utc)
        ]
        if not candidates:
            return None
        return max(candidates, key=lambda value: value.valid_from_utc).name

    def names_at(
        self,
        kind: str,
        entity_ids: Iterable[str],
        local_date: str,
    ) -> dict[str, str | None]:
        """Resolve a deterministic map for one artifact date."""

        return {
            entity_id: self.name_at(kind, entity_id, local_date)
            for entity_id in sorted(set(entity_ids))
        }


@dataclass
class HistoryDateMask:
    """Compact relative-date set for bounded retained-history summaries."""

    _first_ordinal: int | None = None
    _bits: int = 0

    def add(self, value: object) -> None:
        ordinal = date.fromisoformat(history_date(value, field="date")).toordinal()
        if self._first_ordinal is None:
            self._first_ordinal = ordinal
            self._bits = 1
            return
        if ordinal < self._first_ordinal:
            self._bits <<= self._first_ordinal - ordinal
            self._first_ordinal = ordinal
        self._bits |= 1 << (ordinal - self._first_ordinal)

    def update(self, values: Iterable[object]) -> None:
        for value in values:
            self.add(value)

    def merge(self, other: HistoryDateMask) -> None:
        if other._first_ordinal is None:
            return
        if self._first_ordinal is None:
            self._first_ordinal = other._first_ordinal
            self._bits = other._bits
            return
        first = min(self._first_ordinal, other._first_ordinal)
        self._bits = (self._bits << (self._first_ordinal - first)) | (
            other._bits << (other._first_ordinal - first)
        )
        self._first_ordinal = first

    def copy(self) -> HistoryDateMask:
        return HistoryDateMask(self._first_ordinal, self._bits)

    def __bool__(self) -> bool:
        return self._first_ordinal is not None

    def __len__(self) -> int:
        return self._bits.bit_count()

    def __iter__(self):  # type: ignore[no-untyped-def]
        if self._first_ordinal is None:
            return
        remaining = self._bits
        while remaining:
            lowest = remaining & -remaining
            offset = lowest.bit_length() - 1
            yield date.fromordinal(self._first_ordinal + offset).isoformat()
            remaining ^= lowest


def history_month(local_date: str) -> str:
    """Return the calendar-month key for a canonical provider-local date."""

    return history_date(local_date)[:7]


def _history_datetime(value: object, *, field: str) -> datetime:
    if isinstance(value, datetime):
        parsed = value
    elif isinstance(value, str):
        try:
            parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError as exc:
            raise ValueError(f"{field} must be an ISO timestamp with timezone") from exc
    else:
        raise ValueError(f"{field} must be an ISO timestamp with timezone")
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(UTC)


def history_utc_timestamp(value: object, *, field: str = "source_generated_utc") -> str:
    """Normalize an aware datetime/ISO timestamp to an exact UTC ``Z`` string."""

    parsed = _history_datetime(value, field=field)
    rendered = parsed.isoformat(timespec="microseconds" if parsed.microsecond else "seconds")
    return rendered.replace("+00:00", "Z")


def latest_history_timestamp(
    values: Iterable[object],
    *,
    fallback: object | None = None,
) -> str:
    """Return the chronologically latest source timestamp, never lexical max."""

    parsed = [_history_datetime(value, field="source_generated_utc") for value in values]
    if not parsed:
        if fallback is None:
            raise ValueError("history timestamp set cannot be empty without a fallback")
        parsed.append(_history_datetime(fallback, field="generated_utc"))
    return history_utc_timestamp(max(parsed), field="source_generated_utc")


def history_row_int(
    row: Mapping[str, Any],
    field: str,
    *,
    optional: bool = False,
    minimum: int | None = 0,
) -> int | None:
    """Read an exact integer SQL aggregate and fail closed on malformed values."""

    value = row.get(field)
    if value is None:
        if optional:
            return None
        raise ValueError(f"history row {field} cannot be null")
    if isinstance(value, bool):
        raise ValueError(f"history row {field} must be an integer")
    try:
        result = int(value)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"history row {field} must be an integer") from exc
    if result != value:
        raise ValueError(f"history row {field} must be an exact integer")
    if minimum is not None and result < minimum:
        raise ValueError(f"history row {field} must be >= {minimum}")
    return result


def history_row_timestamp(row: Mapping[str, Any]) -> str:
    """Read and normalize the mandatory timestamp carried by a source aggregate."""

    return history_utc_timestamp(row.get("source_generated_utc"))


def history_gaps(dates: Iterable[str]) -> list[HistoricCoverageGap]:
    """Return only internal missing calendar ranges, never inferred edge gaps."""

    ordered = sorted({history_date(value, field="date") for value in dates})
    gaps: list[HistoricCoverageGap] = []
    for previous, current in zip(ordered, ordered[1:], strict=False):
        start = date.fromisoformat(previous) + timedelta(days=1)
        end = date.fromisoformat(current) - timedelta(days=1)
        if start <= end:
            gaps.append(HistoricCoverageGap(start_date=start.isoformat(), end_date=end.isoformat()))
    return gaps


def history_coverage(
    dates: Iterable[str],
) -> tuple[str | None, str | None, list[HistoricCoverageGap]]:
    """Return independent first/last/internal-gap coverage for real emitted days."""

    ordered = sorted({history_date(value, field="date") for value in dates})
    if not ordered:
        return (None, None, [])
    return (ordered[0], ordered[-1], history_gaps(ordered))


def history_metric_coverage(
    metric: HistoryMetricName | str,
    aggregation: HistoryMetricAggregation | str,
    dates: Iterable[str],
) -> HistoricMetricCoverage:
    """Build one metric's coverage without borrowing another metric's dates."""

    first, last, gaps = history_coverage(dates)
    return HistoricMetricCoverage(
        metric=metric,
        aggregation=aggregation,
        first_available_date=first,
        last_available_date=last,
        gaps=gaps,
    )


def history_partition_ref(path: str, partition: BaseModel) -> HistoricPartitionRef:
    """Build a ref from the exact canonical bytes used by immutable storage."""

    days = getattr(partition, "days", None)
    if not isinstance(days, list) or not days:
        raise ValueError("history partition ref requires a nonempty days list")
    body = snapshot_json_bytes(partition)
    return HistoricPartitionRef(
        path=path,
        coverage_start=days[0].date,
        coverage_end=days[-1].date,
        count=len(days),
        sha256=hashlib.sha256(body).hexdigest(),
        byte_size=len(body),
    )


_POINT_HISTORY_MODELS = {
    "hotspots": HistoricHotspotsDay,
    "repeat_offenders": HistoricRepeatOffendersDay,
}


def history_point_ref(family: str, payload: BaseModel) -> HistoricPartitionRef:
    """Address one self-identifying point day from its exact final bytes."""

    model = _POINT_HISTORY_MODELS.get(family)
    if model is None:
        raise ValueError(f"unsupported point history family {family!r}")
    if not isinstance(payload, model):
        raise ValueError(f"point history payload does not match family {family!r}")
    local_date = history_date(getattr(payload, "date", None), field="date")
    if getattr(payload, "methodology_version", None) != "reliability-1":
        raise ValueError("point history payload methodology must be reliability-1")
    if getattr(payload, "publish_generation_id", None) is not None:
        raise ValueError("point history payloads cannot carry a publish generation")
    body = snapshot_json_bytes(payload)
    digest = hashlib.sha256(body).hexdigest()
    return HistoricPartitionRef(
        path=f"historic/history/{family}/generations/{digest}/{local_date}.json",
        coverage_start=local_date,
        coverage_end=local_date,
        count=1,
        sha256=digest,
        byte_size=len(body),
    )


@dataclass
class PointHistorySummary:
    """Compact exact-ref truth retained while point-day payloads stream away."""

    family: str
    refs: list[HistoricPartitionRef] = field(default_factory=list)
    generated_utc: str | None = None

    def __post_init__(self) -> None:
        if self.family not in _POINT_HISTORY_MODELS:
            raise ValueError(f"unsupported point history family {self.family!r}")

    def observe(self, payload: BaseModel) -> HistoricPartitionRef:
        ref = history_point_ref(self.family, payload)
        local_date = ref.coverage_start
        if self.refs and local_date <= self.refs[-1].coverage_start:
            problem = "duplicate" if local_date == self.refs[-1].coverage_start else "ordered"
            raise ValueError(f"point history dates must be unique and ordered ({problem})")
        self.refs.append(ref)
        self.generated_utc = latest_history_timestamp(
            candidate
            for candidate in (self.generated_utc, getattr(payload, "generated_utc", None))
            if candidate is not None
        )
        return ref

    @property
    def available_dates(self) -> list[str]:
        return [ref.coverage_start for ref in self.refs]

    def build_index(self, *, fallback_generated_utc: str) -> HistoricCollectionIndex:
        first, last, gaps = history_coverage(self.available_dates)
        index = HistoricCollectionIndex(
            generated_utc=latest_history_timestamp(
                (() if self.generated_utc is None else (self.generated_utc,)),
                fallback=fallback_generated_utc,
            ),
            methodology_version="history-1",
            publish_generation_id=None,
            family=self.family,
            selection_mode="date",
            first_available_date=first,
            last_available_date=last,
            available_dates=self.available_dates,
            gaps=gaps,
            partitions=[ref.model_copy(deep=True) for ref in self.refs],
            metrics=[],
        )
        index.collection_generation_id = history_index_generation_id(index)
        return index


def encode_history_entity_id(entity_id: str) -> str:
    """Encode an entity ID as its bijective, path-safe lowercase UTF-8 hex."""

    if not entity_id:
        raise ValueError("history entity ID cannot be empty")
    return entity_id.encode("utf-8").hex()


def decode_history_entity_id(encoded_id: str) -> str:
    """Decode one canonical retained-history entity path segment."""

    if _CANONICAL_ENTITY_ID.fullmatch(encoded_id) is None:
        raise ValueError("encoded history entity ID must be non-empty lowercase UTF-8 hex")
    try:
        return bytes.fromhex(encoded_id).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("encoded history entity ID is not valid UTF-8") from exc
