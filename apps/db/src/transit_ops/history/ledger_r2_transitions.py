"""Write-ahead window transitions. Creating the envelope is the commit point.

After commit, LedgerTransitionCommitted carries the decided state on publication
failure; callers must not repeat the change. At most one transition is pending.
"""

import json
from collections.abc import Callable
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from hashlib import sha256
from typing import Any, cast

from transit_ops.control.objects import ConditionalObjects, ObjectConflict
from transit_ops.history.ledger_r2_documents import (
    EventRecord,
    Identity,
    LedgerDocumentInvalid,
    WindowDocument,
    _identity,
    _json,
    _path,
    _require,
    decode_event,
    decode_window,
    encode_event,
    encode_window,
    transition_key,
    window_key,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes


class LedgerTransitionCommitted(RuntimeError):
    """The transition is durable; publication or confirmation failed."""

    def __init__(self, after: WindowDocument) -> None:
        self.after = after
        super().__init__("transition committed; do not repeat the change")


class LedgerContention(RuntimeError):
    """The bounded transition attempts were exhausted."""


@dataclass(frozen=True)
class Transition:
    after: WindowDocument
    records: tuple[EventRecord, ...]


def _decode_envelope(
    raw: bytes, identity: Identity, seq: int, before: bytes | None
) -> WindowDocument:
    try:
        event = json.loads(raw)
        _require(type(event["format"]) is int and event["format"] == 1 and event["seq"] == seq)
        _require(event["before_sha256"] == (sha256(before).hexdigest() if before else None))
        _require(
            datetime.fromisoformat(event["at_utc"].replace("Z", "+00:00")).utcoffset() is not None
        )
        _require(isinstance(event["records"], list))
        for record in event["records"]:
            decode_event(record)
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
    """Commit the envelope first; a committed failure carries after and must not be retried."""
    _require(type(max_attempts) is int and 1 <= max_attempts <= 20)
    committed = None
    for _ in range(max_attempts):
        try:
            if committed is not None:
                return _recover(objects, identity, committed)
            doc, before, token = _read_window(objects, identity)
            seq = (doc.seq if doc else 0) + 1
            pending = objects.read(transition_key(identity, seq))
            if pending:
                after = _decode_envelope(pending.body, identity, seq, before)
                objects.replace(window_key(identity), encode_window(after), expected=token)
                continue
            now = clock()
            transition = change(doc, now)
            if transition is None:
                return doc
            after = decode_window({"format": 1, **asdict(transition.after)})
            if not transition.records and doc and replace(after, seq=doc.seq) == doc:
                return doc
            if after.seq != seq or _identity(after) != identity:
                raise ValueError("transition must advance one event with unchanged identity")
            after, event = _prepare(after, transition.records, before, now)
            objects.create(transition_key(identity, seq), event)
            committed = after
        except ObjectConflict:
            continue
        except Exception as exc:
            if committed is None:
                raise
            raise LedgerTransitionCommitted(committed) from exc
        if _publish(objects, identity, after, token):
            return after
    if committed is not None:
        raise LedgerTransitionCommitted(committed)
    raise LedgerContention("window transition attempts exhausted")


def _read_window(
    objects: ConditionalObjects,
    identity: Identity,
) -> tuple[WindowDocument | None, bytes | None, str | None]:
    current = objects.read(window_key(identity))
    if current is None:
        return None, None, None
    doc = decode_window(json.loads(current.body))
    _require(_identity(doc) == identity and current.body == snapshot_json_bytes(encode_window(doc)))
    return doc, current.body, current.token


def _publish(
    objects: ConditionalObjects,
    identity: Identity,
    after: WindowDocument,
    token: str | None,
) -> bool:
    try:
        objects.replace(window_key(identity), encode_window(after), expected=token)
        return True
    except ObjectConflict:
        return False
    except Exception as exc:
        raise LedgerTransitionCommitted(after) from exc


def _prepare(
    after: WindowDocument,
    records: tuple[EventRecord, ...],
    before: bytes | None,
    at: datetime,
) -> tuple[WindowDocument, dict[str, Any]]:
    for record in records:
        if record.kind == "trim":
            fingerprint = record.details.get("remainder_fingerprint")
            after = replace(after, remainder_fingerprint=cast(str | None, fingerprint))
    event = {
        "format": 1,
        "seq": after.seq,
        "at_utc": _json(at),
        "before_sha256": sha256(before).hexdigest() if before else None,
        "records": [encode_event(decode_event(encode_event(r))) for r in records],
        "after": encode_window(after),
    }
    after = _decode_envelope(snapshot_json_bytes(event), _identity(after), after.seq, before)
    event["after"] = encode_window(after)
    return after, event


def _recover(
    objects: ConditionalObjects, identity: Identity, after: WindowDocument
) -> WindowDocument:
    result, _, _ = _read_window(objects, identity)
    if result is None:
        raise LedgerDocumentInvalid("event was not applied")
    _require(result.seq >= after.seq and _identity(result) == identity)
    for number in range(after.seq + 1, result.seq + 1):
        following = objects.read(transition_key(identity, number))
        if following is None:
            raise LedgerDocumentInvalid("missing applied event")
        after = _decode_envelope(
            following.body, identity, number, snapshot_json_bytes(encode_window(after))
        )
    _require(encode_window(after) == encode_window(result))
    return result


def rebuild_window(objects: ConditionalObjects, identity: Identity) -> WindowDocument | None:
    doc, before = None, None
    for seq, key in enumerate(sorted(objects.list_keys(f"transitions/{_path(identity)}/")), 1):
        _require(key == transition_key(identity, seq))
        event = objects.read(key)
        _require(event is not None)
        assert event is not None
        doc = _decode_envelope(event.body, identity, seq, before)
        before = snapshot_json_bytes(encode_window(doc))
    return doc
