"""Bounded projection repair shared by live ledger readers and writers."""

import json
from collections.abc import Collection, Iterator
from dataclasses import dataclass, replace
from typing import cast

from transit_ops.control.objects import ConditionalObjects, ObjectConflict
from transit_ops.history.ledger_r2_documents import (
    Identity,
    LedgerDocumentInvalid,
    RecordedEvent,
    WindowDocument,
    decode_transition,
    decode_window,
    encode_window,
    identity_of,
    recorded_event,
    require,
    transition_key,
    transitions_prefix,
    window_key,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes


class LedgerContention(RuntimeError):
    """The bounded recovery attempts were exhausted."""


@dataclass(frozen=True)
class WindowCursor:
    doc: WindowDocument | None
    body: bytes | None
    token: str | None
    next_seq: int
    next_record: int = 1

    def unchanged(self, after: WindowDocument | None) -> bool:
        return bool(self.doc and after and replace(after, seq=self.doc.seq) == self.doc)


def _projection(objects: ConditionalObjects, identity: Identity) -> WindowCursor:
    current = objects.read(window_key(identity))
    if current is None:
        return WindowCursor(None, None, None, 1)
    doc = decode_window(current.body)
    require(
        identity_of(doc) == identity and current.body == snapshot_json_bytes(encode_window(doc))
    )
    return WindowCursor(
        doc, current.body, current.token, doc.seq + 1, _record_tail(objects, identity, doc.seq)
    )


def _record_tail(objects: ConditionalObjects, identity: Identity, seq: int) -> int:
    entry = objects.read(transition_key(identity, seq))
    if entry is None:
        raise LedgerDocumentInvalid("missing transition for projection")
    try:
        value = json.loads(entry.body)["next_record"]
        require(type(value) is int and value >= 1)
        return cast(int, value)
    except (KeyError, TypeError, ValueError) as exc:
        raise LedgerDocumentInvalid("invalid record counter") from exc


def recover_step(objects: ConditionalObjects, identity: Identity) -> WindowCursor | None:
    cursor = _projection(objects, identity)
    seq = cursor.next_seq
    while (entry := objects.read(transition_key(identity, seq))) is not None:
        after = decode_transition(entry.body, identity, seq, cursor.body)
        envelope = json.loads(entry.body)
        require(envelope["next_record"] == cursor.next_record + len(envelope["records"]))
        cursor = replace(cursor, next_record=envelope["next_record"])
        if after is not None:
            objects.replace(window_key(identity), encode_window(after), expected=cursor.token)
            repaired = _projection(objects, identity)
            require(repaired.doc is not None and repaired.doc.seq >= after.seq)
            return (
                repaired
                if objects.read(transition_key(identity, repaired.next_seq)) is None
                else None
            )
        seq += 1
    return replace(cursor, next_seq=seq)


def recover(
    objects: ConditionalObjects,
    identity: Identity,
    *,
    max_attempts: int = 10,
) -> WindowCursor:
    if type(max_attempts) is not int or not 1 <= max_attempts <= 20:
        raise ValueError("max_attempts must be from 1 to 20")
    for _ in range(max_attempts):
        try:
            cursor = recover_step(objects, identity)
            if cursor is not None:
                return cursor
        except ObjectConflict:
            continue
    raise LedgerContention("window recovery attempts exhausted")


def current_window(
    objects: ConditionalObjects,
    identity: Identity,
    *,
    max_attempts: int = 10,
) -> WindowDocument | None:
    return recover(objects, identity, max_attempts=max_attempts).doc


def confirm_committed(
    objects: ConditionalObjects,
    identity: Identity,
    after: WindowDocument,
    result: WindowDocument | None,
) -> WindowDocument:
    committed = after
    if result is None:
        raise LedgerDocumentInvalid("committed state is absent")
    require(result.seq >= after.seq and identity_of(result) == identity)
    for number in range(after.seq + 1, result.seq + 1):
        following = objects.read(transition_key(identity, number))
        if following is None:
            raise LedgerDocumentInvalid("missing applied transition")
        after = cast(
            WindowDocument,
            decode_transition(
                following.body, identity, number, snapshot_json_bytes(encode_window(after))
            ),
        )
    require(encode_window(after) == encode_window(result))
    return committed


def _history(
    objects: ConditionalObjects,
    identity: Identity,
) -> Iterator[tuple[WindowDocument | None, list[RecordedEvent]]]:
    """Replay the immutable journal for reconciliation and audit validation."""
    before = None
    next_record = 1
    for seq, key in enumerate(sorted(objects.list_keys(transitions_prefix(identity))), 1):
        require(key == transition_key(identity, seq))
        entry = objects.read(key)
        if entry is None:
            raise LedgerDocumentInvalid("missing transition")
        doc = decode_transition(entry.body, identity, seq, before)
        envelope = json.loads(entry.body)
        require(envelope["next_record"] == next_record + len(envelope["records"]))
        next_record = envelope["next_record"]
        before = snapshot_json_bytes(encode_window(doc)) if doc is not None else None
        yield doc, [recorded_event(r, envelope["at_utc"]) for r in envelope["records"]]


def rebuild_window(objects: ConditionalObjects, identity: Identity) -> WindowDocument | None:
    """Reconstruct and repair journal state for reconciliation."""
    result = None
    for doc, _ in _history(objects, identity):
        result = doc
    recover(objects, identity)
    return result


def events(
    objects: ConditionalObjects,
    identity: Identity,
    *,
    kinds: Collection[str] | None = None,
    max_attempts: int = 10,
) -> list[RecordedEvent]:
    records = [
        r
        for _, batch in _history(objects, identity)
        for r in batch
        if kinds is None or r.kind in kinds
    ]
    recover(objects, identity, max_attempts=max_attempts)
    return records
