"""Write-ahead window transitions. Creating the envelope is the commit point.

After commit, LedgerTransitionCommitted carries the decided state on publication
failure; callers must not repeat the change. At most one transition is pending.
"""

import json
from collections.abc import Callable, Collection, Iterator
from dataclasses import asdict, dataclass, replace
from datetime import datetime
from typing import cast

from transit_ops.control.objects import ConditionalObjects, ObjectConflict
from transit_ops.history.ledger_r2_documents import (
    EventRecord,
    Identity,
    LedgerDocumentInvalid,
    WindowDocument,
    _identity,
    _path,
    _require,
    decode_event,
    decode_transition,
    decode_window,
    encode_window,
    prepare_transition,
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
    after: WindowDocument | None
    records: tuple[EventRecord, ...]


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
            seq, pending = _pending(objects, identity, (doc.seq if doc else 0) + 1, before)
            if pending is not None:
                objects.replace(window_key(identity), encode_window(pending), expected=token)
                continue
            now = clock()
            transition = change(doc, now)
            if transition is None or (transition.after is None and not transition.records):
                return doc
            after = _candidate(transition.after, doc, identity, seq)
            if not transition.records and doc and after and replace(after, seq=doc.seq) == doc:
                return doc
            after, event = prepare_transition(after, transition.records, identity, seq, before, now)
            objects.create(transition_key(identity, seq), event)
            if after is None:
                return None
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


def _pending(
    objects: ConditionalObjects,
    identity: Identity,
    seq: int,
    before: bytes | None,
) -> tuple[int, WindowDocument | None]:
    while (entry := objects.read(transition_key(identity, seq))) is not None:
        after = decode_transition(entry.body, identity, seq, before)
        if after is not None:
            return seq, after
        seq += 1
    return seq, None


def _candidate(
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
        after = replace(after, seq=seq)  # First state follows any event-only history.
    if after.seq != seq or _identity(after) != identity:
        raise ValueError("transition must advance one event with unchanged identity")
    return after


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
        after = cast(
            WindowDocument,
            decode_transition(
                following.body, identity, number, snapshot_json_bytes(encode_window(after))
            ),
        )
    _require(encode_window(after) == encode_window(result))
    return result


def rebuild_window(objects: ConditionalObjects, identity: Identity) -> WindowDocument | None:
    result = None
    for doc, _ in _history(objects, identity):
        result = doc
    return result


def events(
    objects: ConditionalObjects,
    identity: Identity,
    *,
    kinds: Collection[str] | None = None,
) -> list[EventRecord]:
    """Read public records in sequence without writing or requiring window state."""
    return [
        r
        for _, records in _history(objects, identity)
        for r in records
        if kinds is None or r.kind in kinds
    ]


def _history(
    objects: ConditionalObjects,
    identity: Identity,
) -> Iterator[tuple[WindowDocument | None, list[EventRecord]]]:
    before = None
    for seq, key in enumerate(sorted(objects.list_keys(f"transitions/{_path(identity)}/")), 1):
        _require(key == transition_key(identity, seq))
        event = objects.read(key)
        _require(event is not None)
        assert event is not None
        doc = decode_transition(event.body, identity, seq, before)
        before = snapshot_json_bytes(encode_window(doc)) if doc is not None else None
        yield doc, [decode_event(r) for r in json.loads(event.body)["records"]]
