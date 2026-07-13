"""Shared identity, coverage, and serialization helpers for retained history."""

from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime, timedelta
from typing import Any

from pydantic import BaseModel

from transit_ops.snapshots.contract import (
    HistoricCoverageGap,
    HistoricMetricCoverage,
    HistoricPartitionRef,
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
