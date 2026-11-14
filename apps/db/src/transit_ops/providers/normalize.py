"""Byte decoding shell; rules, alert normalization and evidence have no implementation yet."""

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Literal, Protocol

from google.protobuf.message import DecodeError  # type: ignore[import-untyped]
from google.transit.gtfs_realtime_pb2 import FeedMessage

from transit_ops.providers.declaration import Provider
from transit_ops.providers.formats import decode_gtfs_rt
from transit_ops.providers.modes import WORKER_MODES, RuleMode, normalizer_fingerprint


class ScheduleIdentity(Protocol):
    @property
    def context_id(self) -> str: ...


@dataclass(frozen=True)
class RawCapture:
    family: str
    format: str
    payload: bytes
    captured_at_utc: datetime
    label: str


@dataclass(frozen=True)
class Fill:
    entity_index: int
    stop_time_update_index: int | None
    field: str
    rule: str


@dataclass(frozen=True)
class RuleOutcome:
    rule: str
    mode: RuleMode
    seen: int
    changed: int
    unresolved: int
    reasons: Mapping[str, int]


@dataclass(frozen=True)
class NormalizedCapture:
    status: Literal["ok", "rejected"]
    rejected_reason: str | None
    message: FeedMessage | None
    alerts: tuple[()]
    fills: tuple[Fill, ...]
    outcomes: tuple[RuleOutcome, ...]
    evidence: None
    schedule_context_id: str | None
    normalizer: str


def normalize_capture(
    provider: Provider,
    capture: RawCapture,
    schedule: ScheduleIdentity | None = None,
    *,
    modes: Mapping[str, RuleMode],
    collect: bool = False,
) -> NormalizedCapture:
    fingerprint = normalizer_fingerprint(modes)
    if set(modes) != set(WORKER_MODES):
        raise ValueError("All normalizer rule modes are required")
    feed = provider.feed(capture.family)
    if feed is None or feed.format != capture.format:
        raise ValueError("Capture does not match a declared feed")
    if capture.format != "gtfs-rt" or capture.family not in ("trip_updates", "vehicle_positions"):
        raise ValueError("Declared feed adapter is not implemented")
    context_id = (
        schedule.context_id
        if schedule is not None and (collect or any(v == "apply" for v in modes.values()))
        else None
    )
    try:
        message = decode_gtfs_rt(capture.payload)
    except DecodeError:
        return NormalizedCapture(
            "rejected", "undecodable", None, (), (), (), None, context_id, fingerprint
        )
    return NormalizedCapture("ok", None, message, (), (), (), None, context_id, fingerprint)
