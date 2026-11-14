"""Conditional private objects backed by the snapshot storage primitives."""

import time
from collections.abc import Callable, Iterator, Mapping
from dataclasses import dataclass
from typing import Protocol
from urllib.parse import quote

from botocore.exceptions import ClientError

from transit_ops.s3 import build_s3_client, validate_s3_bucket_name
from transit_ops.settings import Settings
from transit_ops.snapshots.serialization import snapshot_json_bytes
from transit_ops.snapshots.storage import (
    ImmutableKeyCollisionError,
    LocalSnapshotStorage,
    SnapshotStorage,
    StableActivationConflictError,
    StableObjectVersion,
    StoredObjectVersionMismatchError,
)


@dataclass(frozen=True)
class Versioned:
    key: str
    body: bytes
    token: str


class ObjectConflict(RuntimeError):
    """The object changed during a conditional operation."""


class ObjectCollision(ObjectConflict):
    """A create-only key already contains different bytes."""


class ObjectRateLimited(RuntimeError):
    """Storage refused an operation with HTTP 429."""


class ConditionalObjects(Protocol):
    """List below a directory ending in '/'; keys are relative, with no promised order."""

    def read(self, key: str) -> Versioned | None: ...
    def create(self, key: str, payload: Mapping[str, object]) -> bool: ...
    def replace(self, key: str, payload: Mapping[str, object], *, expected: str | None) -> bool: ...
    def list_keys(self, prefix: str) -> Iterator[str]: ...


def key_part(value: str) -> str:
    return quote(value, safe="._-")


def _key(key: str) -> None:
    if (
        not key
        or key.startswith("/")
        or "\\" in key
        or any(part in {".", ".."} for part in key.split("/"))
    ):
        raise ValueError("unsafe object key")


def _call[T](action: Callable[[], T]) -> T:
    try:
        return action()
    except ImmutableKeyCollisionError as exc:
        raise ObjectCollision(str(exc)) from exc
    except (StableActivationConflictError, StoredObjectVersionMismatchError) as exc:
        raise ObjectConflict(str(exc)) from exc
    except ClientError as exc:
        if exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode") == 429:
            raise ObjectRateLimited(str(exc)) from exc
        raise


class SnapshotConditionalObjects:
    def __init__(
        self,
        store: SnapshotStorage | LocalSnapshotStorage,
        *,
        min_interval_s: float = 1.0,
        monotonic: Callable[[], float] = time.monotonic,
        sleep: Callable[[float], None] = time.sleep,
    ) -> None:
        self._store, self._interval = store, min_interval_s
        self._monotonic, self._sleep = monotonic, sleep
        self._written: dict[str, float] = {}

    def _path(self, key: str) -> str:
        _key(key)
        # Encode every component so Windows case folding and dot trimming cannot alias keys.
        return (
            "/".join("x" + p.encode().hex() for p in key.split("/"))
            if isinstance(self._store, LocalSnapshotStorage)
            else key
        )

    def read(self, key: str) -> Versioned | None:
        path = self._path(key)
        version = _call(lambda: self._store.capture_object_version(path))
        if version is None:
            return None
        body = _call(lambda: self._store.read_bytes_at_version(path, version))
        return Versioned(key, body, version.etag)

    def create(self, key: str, payload: Mapping[str, object]) -> bool:
        path = self._path(key)
        try:
            result = _call(
                lambda: self._store.put_immutable_json_outcome(path, dict(payload)).written
            )
        except ClientError as exc:
            if (
                exc.response.get("Error", {}).get("Code"),
                exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode"),
            ) != ("ObjectLockedByBucketPolicy", 409):
                raise
            existing = _call(lambda: self._store.read_bytes(path))
            if existing is None:
                raise
            if existing != snapshot_json_bytes(dict(payload)):
                raise ObjectCollision(key) from exc
            return False
        if result:
            self._written[key] = self._monotonic()
        return bool(result)

    def replace(self, key: str, payload: Mapping[str, object], *, expected: str | None) -> bool:
        path = self._path(key)
        if key in self._written:
            remainder = self._interval - (self._monotonic() - self._written[key])
            if remainder > 0:
                self._sleep(remainder)
        result = _call(
            lambda: (
                self._store.activate_stable_json_outcome(
                    path,
                    dict(payload),
                    expected_version=StableObjectVersion(path, expected),
                    tier="internal",
                ).written
            )
        )
        if result:
            self._written[key] = self._monotonic()
        return bool(result)

    def list_keys(self, prefix: str) -> Iterator[str]:
        _key(prefix)
        if not prefix.endswith("/"):
            raise ValueError("listing requires a directory prefix ending in '/'")
        iterator = self._store.iter_object_versions(self._path(prefix.removesuffix("/")))
        while (version := _call(lambda: next(iterator, None))) is not None:
            yield (
                "/".join(bytes.fromhex(p[1:]).decode() for p in version.rel_key.split("/"))
                if (isinstance(self._store, LocalSnapshotStorage))
                else version.rel_key
            )


def _bronze_objects(settings: Settings, prefix: str) -> SnapshotConditionalObjects:
    store: SnapshotStorage | LocalSnapshotStorage
    if settings.BRONZE_STORAGE_BACKEND == "local":
        store = LocalSnapshotStorage(settings.BRONZE_LOCAL_ROOT, prefix)
    else:
        bucket = validate_s3_bucket_name(settings.BRONZE_S3_BUCKET, setting="BRONZE_S3_BUCKET")
        store = SnapshotStorage(build_s3_client(settings), bucket=bucket, base_prefix=prefix)
    return SnapshotConditionalObjects(store)


def ledger_objects(settings: Settings) -> SnapshotConditionalObjects:
    return _bronze_objects(settings, "ledger/v1")


def control_objects(settings: Settings) -> SnapshotConditionalObjects:
    return _bronze_objects(settings, "control/v1")
