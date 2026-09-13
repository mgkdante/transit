from __future__ import annotations

import hashlib
import json
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
    """Byte-backed publication adapter with immutable collision and CAS behavior."""

    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}
        self._condition = RLock()

    def full_key(self, rel_key: str) -> str:
        return rel_key

    def get_json(self, rel_key: str) -> dict[str, object] | None:
        body = self.objects.get(rel_key)
        return json.loads(body) if body is not None else None

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        with self._condition:
            self.objects[rel_key] = body
        return self.full_key(rel_key)

    def put_json(self, rel_key: str, payload: SnapshotPayload, *, tier: str) -> str:
        return self.put_bytes(rel_key, snapshot_json_bytes(payload), tier=tier)

    def put_immutable_json_outcome(
        self, rel_key: str, payload: SnapshotPayload
    ) -> ImmutablePutOutcome:
        body = snapshot_json_bytes(payload)
        with self._condition:
            current = self.objects.get(rel_key)
            if current is not None:
                if current != body:
                    raise ImmutableKeyCollisionError(rel_key)
                return ImmutablePutOutcome(key=self.full_key(rel_key), written=False)
            key = self.put_bytes(rel_key, body, tier="historic_immutable")
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
