from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol, runtime_checkable

from pydantic import BaseModel

type SnapshotPayload = BaseModel | dict[Any, Any]
type PutItem = tuple[str, SnapshotPayload, str]
type CollectedItem = tuple[str, SnapshotPayload]
type PublishStage = tuple[list[PutItem], str]


@dataclass(frozen=True)
class ImmutablePutOutcome:
    key: str
    written: bool


@dataclass(frozen=True)
class StableObjectVersion:
    rel_key: str
    token: str | None


@dataclass(frozen=True)
class StableActivationOutcome:
    key: str
    written: bool


@runtime_checkable
class PayloadSink(Protocol):
    def put_json(self, rel_key: str, payload: SnapshotPayload, *, tier: str) -> str: ...


@runtime_checkable
class ImmutablePayloadSink(PayloadSink, Protocol):
    def put_immutable_json(self, rel_key: str, payload: SnapshotPayload) -> str: ...


@runtime_checkable
class HistoricWriter(ImmutablePayloadSink, Protocol):
    def capture_stable_version(self, rel_key: str) -> StableObjectVersion: ...

    def activate_stable_json(
        self,
        rel_key: str,
        payload: SnapshotPayload,
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> str: ...


@runtime_checkable
class SnapshotObjectStore(Protocol):
    def get_json(self, rel_key: str) -> object: ...

    def full_key(self, rel_key: str) -> str: ...

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str: ...


@runtime_checkable
class HistoricObjectStore(SnapshotObjectStore, Protocol):
    def put_immutable_json_outcome(
        self,
        rel_key: str,
        payload: SnapshotPayload,
    ) -> ImmutablePutOutcome: ...

    def capture_stable_version(self, rel_key: str) -> StableObjectVersion: ...

    def activate_stable_json_outcome(
        self,
        rel_key: str,
        payload: SnapshotPayload,
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> StableActivationOutcome: ...


@runtime_checkable
class SnapshotOutcomeWriter(Protocol):
    @property
    def written(self) -> list[str]: ...

    @property
    def skipped(self) -> list[str]: ...
