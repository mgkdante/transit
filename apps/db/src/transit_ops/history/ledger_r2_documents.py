"""Write-ahead window documents; immutable events arbitrate competing writers."""

import json
import re
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import UTC, date, datetime
from hashlib import sha256
from typing import Any, cast

from pydantic import TypeAdapter

from transit_ops.control.objects import ConditionalObjects, ObjectConflict, key_part
from transit_ops.history import datasets, ledger
from transit_ops.snapshots.serialization import snapshot_json_bytes

type Identity = tuple[str, str, int, str]


class LedgerDocumentInvalid(ValueError):
    """A stored document cannot be trusted."""


class LedgerContention(RuntimeError):
    """The bounded transition attempts were exhausted."""


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


@dataclass(frozen=True)
class Transition:
    after: WindowDocument
    records: tuple[EventRecord, ...]


def _identity(doc: ledger.WindowState | ledger.ArchiveCopy) -> Identity:
    return doc.dataset_id, doc.provider_id, doc.revision, doc.window_key


def _path(identity: Identity) -> str:
    dataset, provider, revision, window = map(lambda v: key_part(str(v)), identity)
    return f"{dataset}/{provider}/r{revision}/{window}"


def window_key(identity: Identity) -> str:
    return f"windows/{_path(identity)}.json"


def event_key(identity: Identity, seq: int) -> str:
    return f"events/{_path(identity)}/{seq:010d}.json"


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
    return {"format": 1, **asdict(record)}


def _require(valid: bool) -> None:
    if not valid:
        raise LedgerDocumentInvalid("invalid ledger document")


def _decode[T: WindowDocument | EventRecord](cls: type[T], raw: dict[str, Any]) -> T:
    values = dict(raw)
    _require(type(values.pop("format")) is int and raw["format"] == 1)
    if values.get("hold_until_utc") == "infinity":
        values["hold_until_utc"] = ledger.HOLD_NO_END
    result = TypeAdapter(cls).validate_python(values)
    json.dumps(asdict(result), default=_json, allow_nan=False)
    return result


def decode_event(raw: dict[str, Any]) -> EventRecord:
    try:
        record = _decode(EventRecord, raw)
        _require(bool(record.actor))
        _require(record.content_version is None or record.content_version >= 1)
        return record
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise LedgerDocumentInvalid("invalid event record") from exc


def decode_window(raw: dict[str, Any]) -> WindowDocument:
    try:
        doc = _decode(WindowDocument, raw)
        dataset = datasets.get_dataset(doc.dataset_id)
        ledger._check_revision(dataset, doc.revision)
        _require(doc.window_start == datasets.window_start(dataset, doc.window_key))
        _require(doc.seq >= 1)
        versions = [copy.content_version for copy in doc.copies]
        _require(versions == sorted(set(versions)))
        for copy in doc.copies:
            _require(_identity(copy) == _identity(doc) and copy.content_version >= 1)
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


def _event(raw: bytes, identity: Identity, seq: int, before: bytes | None) -> WindowDocument:
    try:
        event = json.loads(raw)
        _require(type(event["format"]) is int and event["format"] == 1 and event["seq"] == seq)
        _require(event["before_sha256"] == (sha256(before).hexdigest() if before else None))
        _require(
            datetime.fromisoformat(event["at_utc"].replace("Z", "+00:00")).utcoffset() is not None
        )
        _require(bool([decode_event(record) for record in event["records"]]))
        doc = decode_window(event["after"])
        _require(_identity(doc) == identity and doc.seq == seq)
        return doc
    except (KeyError, TypeError, ValueError, AttributeError) as exc:
        raise LedgerDocumentInvalid("invalid window event") from exc


def apply_transition(
    objects: ConditionalObjects,
    identity: Identity,
    change: Callable[[WindowDocument | None, datetime], Transition | None],
    *,
    clock: Callable[[], datetime],
    max_attempts: int,
) -> WindowDocument | None:
    _require(type(max_attempts) is int and 1 <= max_attempts <= 20)
    for _ in range(max_attempts):
        try:
            current = objects.read(window_key(identity))
            doc = decode_window(json.loads(current.body)) if current else None
            _require(doc is None or _identity(doc) == identity)
            seq, token = (doc.seq if doc else 0) + 1, current.token if current else None
            before = current.body if current else None
            pending = objects.read(event_key(identity, seq))
            if pending:
                after = _event(pending.body, identity, seq, before)
                objects.replace(window_key(identity), encode_window(after), expected=token)
                continue
            transition = change(doc, clock())
            if transition is None:
                return doc
            after = transition.after
            if after.seq != seq or _identity(after) != identity or not transition.records:
                raise ValueError("transition must advance one event with unchanged identity")
            for record in transition.records:
                if record.kind == "trim":
                    fingerprint = record.details.get("remainder_fingerprint")
                    after = replace(after, remainder_fingerprint=cast(str | None, fingerprint))
            event = {
                "format": 1,
                "seq": seq,
                "at_utc": _json(clock()),
                "before_sha256": sha256(before).hexdigest() if before else None,
                "records": [encode_event(r) for r in transition.records],
                "after": encode_window(after),
            }
            _event(snapshot_json_bytes(event), identity, seq, before)
            objects.create(event_key(identity, seq), event)
        except ObjectConflict:
            continue
        try:
            objects.replace(window_key(identity), encode_window(after), expected=token)
            return after
        except ObjectConflict:
            return _recover(objects, identity, after)
    raise LedgerContention("window transition attempts exhausted")


def _recover(
    objects: ConditionalObjects, identity: Identity, after: WindowDocument
) -> WindowDocument:
    latest = objects.read(window_key(identity))
    if latest is None:
        raise LedgerDocumentInvalid("event was not applied")
    result = decode_window(json.loads(latest.body))
    _require(result.seq >= after.seq and _identity(result) == identity)
    for number in range(after.seq + 1, result.seq + 1):
        following = objects.read(event_key(identity, number))
        if following is None:
            raise LedgerDocumentInvalid("missing applied event")
        after = _event(following.body, identity, number, snapshot_json_bytes(encode_window(after)))
    _require(encode_window(after) == encode_window(result))
    return result


def rebuild_window(objects: ConditionalObjects, identity: Identity) -> WindowDocument | None:
    doc, before = None, None
    for seq, key in enumerate(sorted(objects.list_keys(f"events/{_path(identity)}/")), 1):
        _require(key == event_key(identity, seq))
        event = objects.read(key)
        _require(event is not None)
        assert event is not None
        doc = _event(event.body, identity, seq, before)
        before = snapshot_json_bytes(encode_window(doc))
    return doc
