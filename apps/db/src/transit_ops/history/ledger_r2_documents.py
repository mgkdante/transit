"""Write-ahead window documents; immutable events arbitrate competing writers."""

import json
import re
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime
from hashlib import sha256
from typing import Any, cast

from pydantic import JsonValue, TypeAdapter

from transit_ops.control.objects import key_part
from transit_ops.history import datasets, ledger
from transit_ops.snapshots.serialization import snapshot_json_bytes

type Identity = tuple[str, str, int, str]


class LedgerDocumentInvalid(ValueError):
    """A stored document cannot be trusted."""


@dataclass(frozen=True)
class WindowDocument(ledger.WindowState):
    seq: int
    copies: tuple[ledger.ArchiveCopy, ...]


@dataclass(frozen=True)
class EventRecord:
    kind: ledger.EventKind
    content_version: int | None
    actor: str
    reason: str | None
    details: dict[str, object]
    sequence: tuple[int, int] | None = None  # Assigned when the envelope commits.


@dataclass(frozen=True, kw_only=True)
class RecordedEvent(EventRecord):
    at_utc: datetime


@dataclass(frozen=True)
class Transition:
    after: WindowDocument | None
    records: tuple[EventRecord, ...]


def _identity(doc: ledger.WindowState | ledger.ArchiveCopy) -> Identity:
    return doc.dataset_id, doc.provider_id, doc.revision, doc.window_key


def _path(identity: Identity) -> str:
    dataset, provider, revision, window = map(lambda v: key_part(str(v)), identity)
    return f"{dataset}/{provider}/r{revision}/{window}"


def window_key(identity: Identity) -> str:
    return f"windows/{_path(identity)}.json"


def transition_key(identity: Identity, seq: int) -> str:
    return f"transitions/{_path(identity)}/{seq:010d}.json"


def _json(value: Any) -> Any:
    if isinstance(value, datetime):
        if value.utcoffset() is None:
            raise LedgerDocumentInvalid("naive time")
        return value.astimezone(UTC).isoformat(timespec="microseconds").replace("+00:00", "Z")
    if isinstance(value, date):
        return value.isoformat()
    raise TypeError("not JSON native")


def encode_window(doc: WindowDocument) -> dict[str, Any]:
    values = asdict(doc)
    if doc.hold_until_utc == ledger.HOLD_NO_END:
        values["hold_until_utc"] = "infinity"
    return {"format": 1, **json.loads(json.dumps(values, default=_json, allow_nan=False))}


def encode_event(record: EventRecord) -> dict[str, Any]:
    return {
        "format": 1,
        **asdict(record),
        "sequence": list(record.sequence) if record.sequence is not None else None,
    }


def _require(valid: bool) -> None:
    if not valid:
        raise LedgerDocumentInvalid("invalid ledger document")


def _decode[T: WindowDocument | EventRecord](cls: type[T], raw: dict[str, Any]) -> T:
    values = dict(raw)
    _require(type(values.pop("format")) is int and raw["format"] == 1)
    if values.get("hold_until_utc") == "infinity":
        values["hold_until_utc"] = ledger.HOLD_NO_END
    result = TypeAdapter(cls).validate_python(values)
    details = (
        [result.details] if isinstance(result, EventRecord) else [c.details for c in result.copies]
    )
    for item in details:
        TypeAdapter(JsonValue).validate_python(item, strict=True)
    canonical = json.dumps(asdict(result), default=_json, allow_nan=False, sort_keys=True)
    _require(canonical == json.dumps(values, default=_json, allow_nan=False, sort_keys=True))
    return result


def decode_event(raw: dict[str, Any]) -> EventRecord:
    try:
        record = _decode(EventRecord, raw)
        _require(bool(record.actor))
        _require(record.content_version is None or record.content_version >= 1)
        _require(record.sequence is None or (record.sequence[0] >= 1 and record.sequence[1] >= 0))
        return record
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise LedgerDocumentInvalid("invalid event record") from exc


def decode_window(raw: dict[str, Any]) -> WindowDocument:
    try:
        doc = _decode(WindowDocument, raw)
        _require(doc.window_start == _window_start(_identity(doc)))
        _require(doc.seq >= 1)
        versions = [copy.content_version for copy in doc.copies]
        _require(versions == sorted(set(versions)))
        _require(doc.current_version is None or doc.current_version in versions)
        for copy in doc.copies:
            _require(_identity(copy) == _identity(doc) and copy.content_version >= 1)
            _require(copy.content_version < doc.next_version)
            _require(copy.window_start == doc.window_start)
            _require(copy.is_current == (copy.content_version == doc.current_version))
            _require(copy.storage_backend in {"local", "s3"})
            for name in ("sha256", "manifest_sha256", "content_sha256", "poll_record_sha256"):
                digest = getattr(copy, name)
                _require(digest is None or re.fullmatch(r"[0-9a-f]{64}", digest) is not None)
            allocated = copy.allocated_at_utc
            sealed, verified = copy.sealed_at_utc, copy.verified_at_utc
            _require(sealed is None or sealed >= allocated)
            _require(verified is None or (sealed is not None and verified >= sealed))
            _require((copy.rejected_at_utc is None) == (copy.reject_reason is None))
            _require(
                copy.rejected_at_utc is None
                or copy.rejected_at_utc
                >= max(t for t in (allocated, sealed, verified) if t is not None)
            )
        return doc
    except (KeyError, TypeError, ValueError, AttributeError, datasets.UndeclaredDataset) as exc:
        raise LedgerDocumentInvalid("invalid window document") from exc


def _window_start(identity: Identity) -> date | None:
    dataset = datasets.get_dataset(identity[0])
    ledger._check_revision(dataset, identity[2])
    return datasets.window_start(dataset, identity[3])


def normalize_candidate(
    after: WindowDocument | None,
    current: WindowDocument | None,
    identity: Identity,
    seq: int,
) -> WindowDocument | None:
    if after is None:
        _require(current is None)
        return None
    after = decode_window({"format": 1, **asdict(after)})
    if current is None and after.seq == 1:
        after = replace(after, seq=seq)
    if after.seq != seq or _identity(after) != identity:
        raise ValueError("transition must advance one event with unchanged identity")
    return after


def event_time(value: str) -> datetime:
    stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    _require(stamp.utcoffset() is not None)
    return stamp.astimezone(UTC)


def recorded_event(raw: dict[str, Any], at: str) -> RecordedEvent:
    return RecordedEvent(**asdict(decode_event(raw)), at_utc=event_time(at))


def decode_transition(
    raw: bytes,
    identity: Identity,
    seq: int,
    before: bytes | None,
) -> WindowDocument | None:
    """Validate a write-ahead envelope, including an event-only absent state."""
    try:
        event = json.loads(raw)
        _require(type(event["format"]) is int and event["format"] == 1)
        _require(type(event["seq"]) is int and event["seq"] == seq)
        _require(isinstance(event["operation_id"], str) and bool(event["operation_id"]))
        _require(event["before_sha256"] == (sha256(before).hexdigest() if before else None))
        event_time(event["at_utc"])
        _require(isinstance(event["records"], list))
        for index, record in enumerate(event["records"]):
            _require(decode_event(record).sequence == (seq, index))
        if event["after"] is None:
            _require(before is None and bool(event["records"]))
            _window_start(identity)
            return None
        doc = decode_window(event["after"])
        _require(_identity(doc) == identity and doc.seq == seq)
        return doc
    except (KeyError, TypeError, ValueError, AttributeError, datasets.UndeclaredDataset) as exc:
        raise LedgerDocumentInvalid("invalid window transition") from exc


def prepare_transition(
    after: WindowDocument | None,
    records: tuple[EventRecord, ...],
    identity: Identity,
    seq: int,
    before: bytes | None,
    at: datetime,
    *,
    operation_id: str,
) -> tuple[WindowDocument | None, dict[str, Any]]:
    for record in records:
        if after is not None and record.kind == "trim":
            fingerprint = record.details.get("remainder_fingerprint")
            after = replace(after, remainder_fingerprint=cast(str | None, fingerprint))
    event = {
        "format": 1,
        "seq": seq,
        "operation_id": operation_id,
        "at_utc": _json(at),
        "before_sha256": sha256(before).hexdigest() if before else None,
        "records": [
            encode_event(replace(decode_event(encode_event(r)), sequence=(seq, index)))
            for index, r in enumerate(records)
        ],
        "after": encode_window(after) if after is not None else None,
    }
    after = decode_transition(snapshot_json_bytes(event), identity, seq, before)
    event["after"] = encode_window(after) if after is not None else None
    return after, event
