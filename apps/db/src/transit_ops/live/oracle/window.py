"""Portable inputs for replaying the live path with production identities."""

import json
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from datetime import datetime

from transit_ops.history.poll_record import CaptureEntry, PollRecord, canonical_json, typed_value


class WindowInvalid(ValueError):
    pass


@dataclass(frozen=True)
class EditionInput:
    feed_endpoint_id: int
    ingestion_run_id: int
    ingestion_object_id: int
    storage_backend: str
    storage_path: str
    checksum_sha256: str
    byte_size: int
    source_url: str | None
    requested_at_utc: datetime
    started_at_utc: datetime
    completed_at_utc: datetime
    object_created_at_utc: datetime


@dataclass(frozen=True)
class CycleSpec:
    generated_utc: datetime
    captures: tuple[tuple[str, int], ...]


@dataclass(frozen=True)
class ReplayWindow:
    provider_id: str
    feed_endpoints: Mapping[str, int]
    poll_records: tuple[PollRecord, ...]
    edition: EditionInput
    serving_initialized_at_utc: datetime
    cycles: tuple[CycleSpec, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "feed_endpoints", dict(self.feed_endpoints))
        _validate(self)

    def to_json(self) -> bytes:
        return canonical_json(asdict(self))

    @classmethod
    def from_json(cls, data: bytes) -> "ReplayWindow":
        try:
            value = json.loads(data, object_hook=_decode_times)
            value["poll_records"] = typed_value(tuple[PollRecord, ...], value["poll_records"])
            value["edition"] = typed_value(EditionInput, value["edition"])
            value["serving_initialized_at_utc"] = typed_value(
                datetime, value["serving_initialized_at_utc"]
            )
            value["cycles"] = tuple(
                CycleSpec(
                    typed_value(datetime, c["generated_utc"]),
                    tuple((typed_value(str, f), typed_value(int, i)) for f, i in c["captures"]),
                )
                for c in value["cycles"]
            )
            return cls(**value)
        except (TypeError, ValueError, KeyError) as exc:
            raise WindowInvalid(str(exc)) from exc

    def capture(self, index_family: str, capture_row_id: int) -> tuple[PollRecord, CaptureEntry]:
        for record in self.poll_records:
            for entry in record.captures:
                if (entry.index_family, entry.capture_row_id) == (index_family, capture_row_id):
                    return record, entry
        raise WindowInvalid(f"capture {index_family}/{capture_row_id} missing from polls")


def _decode_times(value: dict[str, object]) -> dict[str, object]:
    for key, item in value.items():
        if key.endswith("_utc") and isinstance(item, str):
            value[key] = datetime.fromisoformat(item)
    _aware(value, "window")
    return value


def _aware(value: object, path: str) -> None:
    if isinstance(value, datetime) and value.utcoffset() is None:
        raise WindowInvalid(f"{path}: naive datetime")
    if isinstance(value, dict):
        for key, item in value.items():
            _aware(item, f"{path}.{key}")
    if isinstance(value, (tuple, list)):
        for index, item in enumerate(value):
            _aware(item, f"{path}[{index}]")


def _validate(window: ReplayWindow) -> None:
    _aware(asdict(window), "window")
    for record in window.poll_records:
        if record.feed_day.provider_id != window.provider_id:
            raise WindowInvalid(f"poll record provider {record.feed_day.provider_id} differs")
    previous = None
    seen: set[tuple[str, int]] = set()
    for cycle in window.cycles:
        if cycle.generated_utc.microsecond:
            raise WindowInvalid(f"cycle {cycle.generated_utc}: must be whole seconds")
        if previous is not None and cycle.generated_utc <= previous:
            raise WindowInvalid(f"cycle {cycle.generated_utc}: must be strictly increasing")
        previous = cycle.generated_utc
        for ref in cycle.captures:
            if ref in seen:
                raise WindowInvalid(f"capture {ref}: listed twice")
            seen.add(ref)
            record, entry = window.capture(*ref)
            if not any(
                p.ingestion_run_id == entry.ingestion_run_id
                and (p.index_family, p.capture_row_id) == ref
                and p.run_status == "succeeded"
                for p in record.polls
            ):
                raise WindowInvalid(f"capture {ref}: poll did not succeed or is missing")
            if window.serving_initialized_at_utc >= entry.captured_at_utc:
                raise WindowInvalid(f"serving_initialized_at_utc must be before capture {ref}")
