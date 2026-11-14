"""Write-ahead operations with distinct committed and indeterminate outcomes."""

import json
from collections.abc import Callable
from dataclasses import replace
from datetime import datetime
from typing import Any
from uuid import uuid4

from transit_ops.control.objects import ConditionalObjects, ObjectCollision, ObjectConflict
from transit_ops.history.ledger_r2_documents import (
    Identity,
    WindowDocument,
    encode_window,
    normalize_candidate,
    prepare_transition,
    transition_key,
    window_key,
)
from transit_ops.history.ledger_r2_documents import Transition as Transition
from transit_ops.history.ledger_r2_readers import LedgerContention as LedgerContention
from transit_ops.history.ledger_r2_readers import (
    WindowCursor,
    confirm_committed,
    recover_step,
)
from transit_ops.history.ledger_r2_readers import current_window as current_window
from transit_ops.history.ledger_r2_readers import events as events
from transit_ops.history.ledger_r2_readers import rebuild_window as rebuild_window
from transit_ops.snapshots.serialization import snapshot_json_bytes


class LedgerTransitionCommitted(RuntimeError):
    """The transition is durable; do not repeat the logical operation."""

    def __init__(self, after: WindowDocument) -> None:
        self.after = after
        super().__init__("transition committed; do not repeat the change")


class LedgerTransitionIndeterminate(RuntimeError):
    """Resolve the attempted operation identity before any re-execution."""

    def __init__(self, operation_id: str, key: str, after: WindowDocument | None) -> None:
        self.operation_id, self.key, self.after = operation_id, key, after
        super().__init__("transition outcome unknown; do not repeat the change")


def apply_transition(
    objects: ConditionalObjects,
    identity: Identity,
    change: Callable[[WindowDocument | None, datetime], Transition | None],
    *,
    clock: Callable[[], datetime],
    max_attempts: int,
) -> WindowDocument | None:
    """One invocation owns one operation id, including all its internal retries."""
    if type(max_attempts) is not int or not 1 <= max_attempts <= 20:
        raise ValueError("max_attempts must be from 1 to 20")
    operation_id, committed = uuid4().hex, None
    for _ in range(max_attempts):
        try:
            cursor = recover_step(objects, identity)
            if cursor is None:
                continue
            if committed is not None:
                return confirm_committed(objects, identity, committed, cursor.doc)
            now = clock()
            draft = _draft(change(cursor.doc, now), cursor, identity, now, operation_id)
            if draft is None:
                return cursor.doc
            after, envelope = draft
            _create(objects, transition_key(identity, cursor.next_seq), envelope, after)
            if after is None:
                return None
            committed = after
        except ObjectConflict:
            continue
        except LedgerTransitionIndeterminate:
            raise
        except Exception as exc:
            if committed is None:
                raise
            raise LedgerTransitionCommitted(committed) from exc
        try:
            objects.replace(window_key(identity), encode_window(after), expected=cursor.token)
            return after
        except ObjectConflict:
            continue
        except Exception as exc:
            raise LedgerTransitionCommitted(after) from exc
    if committed is not None:
        raise LedgerTransitionCommitted(committed)
    raise LedgerContention("window transition attempts exhausted")


def _draft(
    transition: Transition | None,
    cursor: WindowCursor,
    identity: Identity,
    at: datetime,
    operation_id: str,
) -> tuple[WindowDocument | None, dict[str, Any]] | None:
    if transition is None or (transition.after is None and not transition.records):
        return None
    after = normalize_candidate(transition.after, cursor.doc, identity, cursor.next_seq)
    unchanged = cursor.doc and after and replace(after, seq=cursor.doc.seq) == cursor.doc
    if not transition.records and unchanged:
        return None
    return prepare_transition(
        after,
        transition.records,
        identity,
        cursor.next_seq,
        cursor.body,
        at,
        operation_id=operation_id,
    )


def _create(
    objects: ConditionalObjects,
    key: str,
    envelope: dict[str, Any],
    after: WindowDocument | None,
) -> None:
    try:
        if objects.create(key, envelope):
            return
    except ObjectCollision:
        raise
    except Exception:
        pass
    operation_id = str(envelope["operation_id"])
    try:
        stored = objects.read(key)
        owner = json.loads(stored.body).get("operation_id") if stored is not None else None
    except Exception as exc:
        raise LedgerTransitionIndeterminate(operation_id, key, after) from exc
    if stored is None or owner == operation_id and stored.body != snapshot_json_bytes(envelope):
        raise LedgerTransitionIndeterminate(operation_id, key, after)
    if owner != operation_id:
        raise ObjectCollision(key)
