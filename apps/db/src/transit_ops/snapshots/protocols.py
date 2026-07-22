from __future__ import annotations

from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel

type SnapshotPayload = BaseModel | dict[Any, Any]


@runtime_checkable
class SnapshotWriter(Protocol):
    def put_json(self, rel_key: str, payload: SnapshotPayload, *, tier: str) -> str: ...

    def put_immutable_json(self, rel_key: str, payload: SnapshotPayload) -> str: ...


@runtime_checkable
class SnapshotOutcomeWriter(SnapshotWriter, Protocol):
    @property
    def written(self) -> list[str]: ...

    @property
    def skipped(self) -> list[str]: ...
