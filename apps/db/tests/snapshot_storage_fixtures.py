from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Callable
from threading import RLock

from transit_ops.snapshots.protocols import (
    ImmutablePutOutcome,
    SnapshotPayload,
    StableActivationOutcome,
    StableObjectVersion,
)
from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.snapshots.storage import ImmutableKeyCollisionError, StableActivationConflictError


class MemorySnapshotStore:
    """Record write attempts; inject failures before bytes change.

    Patterns use fullmatch; fail_at counts all write attempts (one based), including
    immutable repeats. keys records successful physical writes in completion order.
    """

    def __init__(
        self,
        *,
        fail_key: str | None = None,
        fail_pattern: str | None = None,
        fail_at: int | None = None,
        error: Exception | None = None,
        pause: Callable[[str], None] | None = None,
        event_sink: list[str] | None = None,
    ) -> None:
        self.objects: dict[str, bytes] = {}
        self.store = self.objects
        self.calls: list[tuple[str, str]] = []
        self.keys: list[str] = []
        self.tiers: list[str] = []
        self.payloads: list[SnapshotPayload] = []
        self.get_json_calls: list[str] = []
        self.fail_key, self.fail_pattern, self.fail_at = fail_key, fail_pattern, fail_at
        self.error = error if error is not None else RuntimeError("snapshot write failed")
        self.pause, self.events = pause, event_sink
        self._condition = RLock()

    def _before_write(self, kind: str, rel_key: str) -> None:
        # Pause outside the object lock so another upload can reach its barrier.
        if self.pause is not None:
            self.pause(rel_key)
        with self._condition:
            self.calls.append((kind, rel_key))
            if self.events is not None:
                self.events.append(f"put:{rel_key}")
            if (
                rel_key == self.fail_key
                or (self.fail_pattern is not None and re.fullmatch(self.fail_pattern, rel_key))
                or len(self.calls) == self.fail_at
            ):
                raise self.error

    def full_key(self, rel_key: str) -> str:
        return rel_key

    def get_json(self, rel_key: str) -> dict[str, object] | None:
        self.get_json_calls.append(rel_key)
        if self.events is not None:
            self.events.append(f"get:{rel_key}")
        body = self.objects.get(rel_key)
        return json.loads(body) if body is not None else None

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        self._before_write("normal", rel_key)
        return self._write_bytes(rel_key, body, tier=tier)

    def _write_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        with self._condition:
            self.objects[rel_key] = body
            self.keys.append(rel_key)
            self.tiers.append(tier)
        return self.full_key(rel_key)

    def put_json(self, rel_key: str, payload: SnapshotPayload, *, tier: str) -> str:
        self.payloads.append(payload)
        return self.put_bytes(rel_key, snapshot_json_bytes(payload), tier=tier)

    def put_immutable_json_outcome(
        self, rel_key: str, payload: SnapshotPayload
    ) -> ImmutablePutOutcome:
        body = snapshot_json_bytes(payload)
        self._before_write("immutable", rel_key)
        with self._condition:
            current = self.objects.get(rel_key)
            if current is not None:
                if current != body:
                    raise ImmutableKeyCollisionError(rel_key)
                return ImmutablePutOutcome(key=self.full_key(rel_key), written=False)
            key = self._write_bytes(rel_key, body, tier="historic_immutable")
            return ImmutablePutOutcome(key=key, written=True)

    def put_immutable_json(self, rel_key: str, payload: SnapshotPayload) -> str:
        return self.put_immutable_json_outcome(rel_key, payload).key

    def capture_stable_version(self, rel_key: str) -> StableObjectVersion:
        with self._condition:
            body = self.objects.get(rel_key)
            token = hashlib.sha256(body).hexdigest() if body is not None else None
            return StableObjectVersion(rel_key=rel_key, token=token)

    def activate_stable_json_outcome(
        self,
        rel_key: str,
        payload: SnapshotPayload,
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> StableActivationOutcome:
        if expected_version.rel_key != rel_key:
            raise ValueError("stable activation version belongs to a different key")
        body = snapshot_json_bytes(payload)
        with self._condition:
            current = self.objects.get(rel_key)
            version = self.capture_stable_version(rel_key)
            if version.token != expected_version.token and current != body:
                raise StableActivationConflictError(rel_key)
            if current == body:
                return StableActivationOutcome(key=self.full_key(rel_key), written=False)
            key = self.put_json(rel_key, payload, tier=tier)
            return StableActivationOutcome(key=key, written=True)

    def activate_stable_json(
        self,
        rel_key: str,
        payload: SnapshotPayload,
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> str:
        return self.activate_stable_json_outcome(
            rel_key,
            payload,
            expected_version=expected_version,
            tier=tier,
        ).key
