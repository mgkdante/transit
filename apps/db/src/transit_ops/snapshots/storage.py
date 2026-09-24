"""Versioned snapshots and conditional publication on local disk or S3."""

from __future__ import annotations

import fcntl
import hashlib
import json
import os
import pathlib
import re
import stat
import threading
from collections.abc import Iterator
from contextlib import contextmanager, suppress
from dataclasses import dataclass
from datetime import UTC, datetime
from uuid import uuid4

from botocore.exceptions import ClientError
from pydantic import BaseModel

from transit_ops.s3 import build_s3_client, validate_s3_bucket_name
from transit_ops.settings import Settings
from transit_ops.snapshots.protocols import (
    HistoricObjectStore,
    SnapshotObjectStore,
    SnapshotPayload,
)
from transit_ops.snapshots.protocols import ImmutablePutOutcome as ImmutablePutOutcome
from transit_ops.snapshots.protocols import StableActivationOutcome as StableActivationOutcome
from transit_ops.snapshots.protocols import StableObjectVersion as StableObjectVersion
from transit_ops.snapshots.serialization import snapshot_json_bytes

# Cache-Control header per data tier.
# live    — 30 s TTL; realtime vehicle positions / alerts
# static  — 1-day TTL + stale-while-revalidate; GTFS-derived shapes, stops, routes
# historic — 1-hour TTL + stale-while-revalidate; the tier is REWRITTEN daily and
#            its indexes/aggregates are mutable, so a 24 h client cache could pin a
#            returning visitor a full publish behind (observed 2026-07-09: a cached
#            receipts index kept the picker a week stale). Per-day files are
#            immutable and only pay a cheap ETag 304 on revalidation.
# internal — private, no-store; per-tier hash-state objects (never client-cached)
CACHE_CONTROL: dict[str, str] = {
    "live": "public, max-age=30",
    "static": "public, max-age=86400, stale-while-revalidate=86400",
    "historic": "public, max-age=3600, stale-while-revalidate=86400",
    "historic_immutable": "public, max-age=31536000, immutable",
    "internal": "private, no-store",
}

# S3/R2 error codes that mean "object does not exist" (mirror ingestion/storage).
_NOT_FOUND_CODES = {"404", "NoSuchKey", "NotFound"}
_PRECONDITION_FAILED_CODES = {"412", "PreconditionFailed"}


# Backward-compatible import surface for older tests and callers. Serialization
# itself lives only in snapshots.serialization.
_body = snapshot_json_bytes


class ImmutableKeyCollisionError(RuntimeError):
    """An immutable key already exists with bytes different from the request."""

    def __init__(self, rel_key: str) -> None:
        super().__init__(f"immutable key collision: {rel_key}")


class StableActivationConflictError(RuntimeError):
    """A stable object changed after its activation version was captured."""

    def __init__(self, rel_key: str) -> None:
        super().__init__(f"stable activation conflict: {rel_key}")


class StoredObjectVersionMismatchError(RuntimeError):
    """An object no longer matches the version captured by an inventory."""

    def __init__(self, rel_key: str, *, reason: str = "version_mismatch") -> None:
        self.reason = reason
        super().__init__(f"snapshot object version changed: {rel_key}:{reason}")


@dataclass(frozen=True)
class StoredObjectVersion:
    """Stable object metadata used by fail-closed historic generation scans."""

    rel_key: str
    etag: str
    last_modified_utc: datetime
    size: int


def _lock_for_key(
    rel_key: str,
    *,
    registry_lock: threading.Lock,
    locks: dict[str, threading.Lock],
) -> threading.Lock:
    with registry_lock:
        return locks.setdefault(rel_key, threading.Lock())


@contextmanager
def _exclusive_directory_lock(directory: pathlib.Path) -> Iterator[None]:
    """Hold a process-safe advisory lock on an existing snapshot directory."""

    directory.mkdir(parents=True, exist_ok=True)
    descriptor = os.open(directory, os.O_RDONLY | getattr(os, "O_DIRECTORY", 0))
    try:
        fcntl.flock(descriptor, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(descriptor, fcntl.LOCK_UN)
    finally:
        os.close(descriptor)


class SnapshotStorage:
    """PUT JSON objects to an S3-compatible bucket (Cloudflare R2).

    Thread-safety
    -------------
    Boto3 low-level clients may be shared between threads. A provider publish
    therefore owns one client whose connection pool is sized for the bounded
    publisher executor.
    """

    def __init__(
        self,
        client: object,
        *,
        bucket: str,
        base_prefix: str,
    ) -> None:
        self._client = client
        self._bucket = bucket
        self._prefix = base_prefix.strip("/")
        self._close_lock = threading.Lock()
        self._closed = False
        self._immutable_registry_lock = threading.Lock()
        self._immutable_locks: dict[str, threading.Lock] = {}

    def close(self) -> None:
        """Close the owned low-level client once all publisher workers have drained."""

        with self._close_lock:
            if self._closed:
                return
            close = getattr(self._client, "close", None)
            if callable(close):
                close()
            self._closed = True

    def full_key(self, rel_key: str) -> str:
        """Return the full bucket key for *rel_key* (``{base_prefix}/{rel_key}``)."""
        return f"{self._prefix}/{rel_key}"

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        """PUT raw *body* bytes at ``{base_prefix}/{rel_key}`` and return the full key."""
        key = self.full_key(rel_key)
        self._client.put_object(  # type: ignore[attr-defined]
            Bucket=self._bucket,
            Key=key,
            Body=body,
            ContentType="application/json",
            CacheControl=CACHE_CONTROL[tier],
        )
        return key

    def put_json(self, rel_key: str, payload: BaseModel | dict, *, tier: str) -> str:  # type: ignore[type-arg]
        """PUT *payload* at ``{base_prefix}/{rel_key}`` and return the full key.

        Parameters
        ----------
        rel_key:
            Path relative to the base prefix, e.g. ``"live/vehicles.json"``.
        payload:
            Pydantic model or plain dict to serialise as JSON.
        tier:
            One of ``"live"``, ``"static"``, ``"historic"``, or ``"internal"``;
            controls the ``Cache-Control`` header.
        """
        return self.put_bytes(rel_key, snapshot_json_bytes(payload), tier=tier)

    def read_bytes(self, rel_key: str) -> bytes | None:
        """Read exact object bytes, returning ``None`` only for a missing key."""

        key = self.full_key(rel_key)
        try:
            response = self._client.get_object(  # type: ignore[attr-defined]
                Bucket=self._bucket,
                Key=key,
            )
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in _NOT_FOUND_CODES:
                return None
            raise
        body = response["Body"]
        try:
            payload: bytes = body.read()
            return payload
        finally:
            if hasattr(body, "close"):
                body.close()

    def read_bytes_at_version(
        self,
        rel_key: str,
        expected_version: StoredObjectVersion,
    ) -> bytes:
        """Read bytes only when R2 still serves the inventoried object version."""

        if expected_version.rel_key != rel_key:
            raise ValueError("stored object version belongs to a different key")
        key = self.full_key(rel_key)
        try:
            response = self._client.get_object(  # type: ignore[attr-defined]
                Bucket=self._bucket,
                Key=key,
                IfMatch=expected_version.etag,
            )
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if (
                code in _NOT_FOUND_CODES
                or code in _PRECONDITION_FAILED_CODES
                or status == 404
                or status == 412
            ):
                reason = (
                    "precondition_failed"
                    if code in _PRECONDITION_FAILED_CODES or status == 412
                    else "object_missing"
                )
                raise StoredObjectVersionMismatchError(rel_key, reason=reason) from exc
            raise

        body = response.get("Body")
        try:
            if body is None or not hasattr(body, "read"):
                raise StoredObjectVersionMismatchError(rel_key, reason="response_body_missing")
            try:
                actual_version = self._stored_version(rel_key, response)
            except RuntimeError as exc:
                raise StoredObjectVersionMismatchError(
                    rel_key,
                    reason="response_metadata_invalid",
                ) from exc
            if actual_version != expected_version:
                mismatches = [
                    name
                    for name, actual, expected in (
                        ("etag", actual_version.etag, expected_version.etag),
                        (
                            "last_modified",
                            actual_version.last_modified_utc,
                            expected_version.last_modified_utc,
                        ),
                        ("size", actual_version.size, expected_version.size),
                    )
                    if actual != expected
                ]
                raise StoredObjectVersionMismatchError(
                    rel_key,
                    reason=f"metadata_mismatch:{','.join(mismatches)}",
                )
            raw = body.read()
            if not isinstance(raw, bytes):
                raise StoredObjectVersionMismatchError(rel_key, reason="response_body_not_bytes")
            if len(raw) != expected_version.size:
                raise StoredObjectVersionMismatchError(rel_key, reason="response_body_size")
            return raw
        finally:
            if hasattr(body, "close"):
                body.close()

    @staticmethod
    def _stored_version(rel_key: str, metadata: dict) -> StoredObjectVersion:  # type: ignore[type-arg]
        etag = metadata.get("ETag")
        modified = metadata.get("LastModified")
        size = metadata.get("ContentLength", metadata.get("Size"))
        if not isinstance(etag, str) or not etag:
            raise RuntimeError(f"snapshot object has no ETag: {rel_key}")
        if not isinstance(modified, datetime):
            raise RuntimeError(f"snapshot object has no LastModified: {rel_key}")
        if modified.tzinfo is None:
            modified = modified.replace(tzinfo=UTC)
        else:
            modified = modified.astimezone(UTC)
        # LIST may preserve milliseconds that GET/HEAD HTTP-date headers cannot represent.
        modified = modified.replace(microsecond=0)
        if not isinstance(size, int) or isinstance(size, bool) or size < 0:
            raise RuntimeError(f"snapshot object has invalid size: {rel_key}")
        return StoredObjectVersion(
            rel_key=rel_key,
            etag=etag,
            last_modified_utc=modified,
            size=size,
        )

    def capture_object_version(self, rel_key: str) -> StoredObjectVersion | None:
        """Capture one object's provider version metadata, or absence."""

        metadata = self._immutable_head(rel_key)
        if metadata is None:
            return None
        return self._stored_version(rel_key, metadata)

    def iter_object_versions(self, rel_prefix: str) -> Iterator[StoredObjectVersion]:
        """Yield every object below *rel_prefix* across all S3 result pages."""

        full_prefix = self.full_key(rel_prefix)
        token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": self._bucket, "Prefix": full_prefix}
            if token is not None:
                request["ContinuationToken"] = token
            response = self._client.list_objects_v2(**request)  # type: ignore[attr-defined]
            contents = response.get("Contents", [])
            if not isinstance(contents, list):
                raise RuntimeError("snapshot inventory returned malformed Contents")
            for item in contents:
                if not isinstance(item, dict):
                    raise RuntimeError("snapshot inventory returned malformed object metadata")
                key = item.get("Key")
                base = f"{self._prefix}/"
                if not isinstance(key, str) or not key.startswith(base):
                    raise RuntimeError(
                        "snapshot inventory returned an object outside provider prefix"
                    )
                yield self._stored_version(key[len(base) :], item)
            if not response.get("IsTruncated"):
                break
            next_token = response.get("NextContinuationToken")
            if not isinstance(next_token, str) or not next_token:
                raise RuntimeError("snapshot inventory omitted its continuation token")
            token = next_token

    def _immutable_head(self, rel_key: str) -> dict | None:  # type: ignore[type-arg]
        key = self.full_key(rel_key)
        try:
            return self._client.head_object(  # type: ignore[attr-defined,no-any-return]
                Bucket=self._bucket,
                Key=key,
            )
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in _NOT_FOUND_CODES:
                return None
            raise

    def immutable_exists(self, rel_key: str) -> bool:
        """Return whether an immutable object exists; propagate non-missing errors."""

        lock = _lock_for_key(
            rel_key,
            registry_lock=self._immutable_registry_lock,
            locks=self._immutable_locks,
        )
        with lock:
            return self._immutable_head(rel_key) is not None

    def capture_stable_version(self, rel_key: str) -> StableObjectVersion:
        """Capture the current stable object's R2 ETag, or absence."""

        existing = self._immutable_head(rel_key)
        if existing is None:
            return StableObjectVersion(rel_key=rel_key, token=None)
        etag = existing.get("ETag")
        if not isinstance(etag, str) or not etag:
            raise RuntimeError(f"stable object has no ETag: {rel_key}")
        return StableObjectVersion(rel_key=rel_key, token=etag)

    def activate_stable_json_outcome(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> StableActivationOutcome:
        """Conditionally activate stable JSON against a captured version."""

        if expected_version.rel_key != rel_key:
            raise ValueError("stable activation version belongs to a different key")

        body = snapshot_json_bytes(payload)
        key = self.full_key(rel_key)
        condition = (
            {"IfNoneMatch": "*"}
            if expected_version.token is None
            else {"IfMatch": expected_version.token}
        )
        try:
            self._client.put_object(  # type: ignore[attr-defined]
                Bucket=self._bucket,
                Key=key,
                Body=body,
                ContentType="application/json",
                CacheControl=CACHE_CONTROL[tier],
                **condition,
            )
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
            if code not in _PRECONDITION_FAILED_CODES and status != 412:
                raise
            try:
                response = self._client.get_object(  # type: ignore[attr-defined]
                    Bucket=self._bucket,
                    Key=key,
                )
            except ClientError as read_exc:
                read_code = str(read_exc.response.get("Error", {}).get("Code", ""))
                if read_code in _NOT_FOUND_CODES:
                    raise StableActivationConflictError(rel_key) from exc
                raise
            response_body = response["Body"]
            try:
                active_body = response_body.read()
            finally:
                if hasattr(response_body, "close"):
                    response_body.close()
            if active_body == body:
                return StableActivationOutcome(key=key, written=False)
            raise StableActivationConflictError(rel_key) from exc
        return StableActivationOutcome(key=key, written=True)

    def activate_stable_json(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> str:
        """Conditionally activate stable JSON and return its full key."""

        return self.activate_stable_json_outcome(
            rel_key,
            payload,
            expected_version=expected_version,
            tier=tier,
        ).key

    def _verify_existing_immutable(
        self,
        rel_key: str,
        body: bytes,
        digest: str,
        existing: dict,  # type: ignore[type-arg]
        *,
        require_exact_body: bool = False,
    ) -> ImmutablePutOutcome:
        metadata = existing.get("Metadata") or {}
        prior_digest = metadata.get("sha256")
        if prior_digest is not None and not require_exact_body:
            if prior_digest == digest and existing.get("ContentLength") == len(body):
                return ImmutablePutOutcome(key=self.full_key(rel_key), written=False)
            raise ImmutableKeyCollisionError(rel_key)

        key = self.full_key(rel_key)
        response = self._client.get_object(  # type: ignore[attr-defined]
            Bucket=self._bucket,
            Key=key,
        )
        response_body = response["Body"]
        try:
            prior_body = response_body.read()
        finally:
            if hasattr(response_body, "close"):
                response_body.close()
        if prior_body != body:
            raise ImmutableKeyCollisionError(rel_key)
        return ImmutablePutOutcome(key=key, written=False)

    def put_immutable_json_outcome(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
    ) -> ImmutablePutOutcome:
        """Create an immutable object or prove an existing object is byte-identical."""

        body = snapshot_json_bytes(payload)
        digest = hashlib.sha256(body).hexdigest()
        lock = _lock_for_key(
            rel_key,
            registry_lock=self._immutable_registry_lock,
            locks=self._immutable_locks,
        )
        with lock:
            existing = self._immutable_head(rel_key)
            if existing is None:
                key = self.full_key(rel_key)
                try:
                    self._client.put_object(  # type: ignore[attr-defined]
                        Bucket=self._bucket,
                        Key=key,
                        Body=body,
                        ContentType="application/json",
                        CacheControl=CACHE_CONTROL["historic_immutable"],
                        Metadata={"sha256": digest},
                        IfNoneMatch="*",
                    )
                except ClientError as exc:
                    code = str(exc.response.get("Error", {}).get("Code", ""))
                    status = exc.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
                    if code not in _PRECONDITION_FAILED_CODES and status != 412:
                        raise
                    existing = self._immutable_head(rel_key)
                    if existing is None:
                        raise
                    return self._verify_existing_immutable(
                        rel_key,
                        body,
                        digest,
                        existing,
                        require_exact_body=True,
                    )
                return ImmutablePutOutcome(key=key, written=True)

            return self._verify_existing_immutable(rel_key, body, digest, existing)

    def put_immutable_json(self, rel_key: str, payload: BaseModel | dict) -> str:  # type: ignore[type-arg]
        """Create or byte-verify a content-addressed historic object."""

        return self.put_immutable_json_outcome(rel_key, payload).key

    def get_json(self, rel_key: str) -> object:
        """GET and JSON-decode the object at *rel_key*; ``None`` if it is absent.

        Missing objects (404 / NoSuchKey / NotFound) return ``None`` so callers
        treat "never published" as an empty hash-state; any other error re-raises.
        """
        key = self.full_key(rel_key)
        try:
            resp = self._client.get_object(Bucket=self._bucket, Key=key)  # type: ignore[attr-defined]
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in _NOT_FOUND_CODES:
                return None
            raise
        body = resp["Body"]
        try:
            payload: object = json.loads(body.read())
            return payload
        finally:
            if hasattr(body, "close"):
                body.close()


_LOCAL_TEMPORARY_NAME = re.compile(r"\.transit-snapshot-[0-9a-f]{32}\.tmp")


class LocalSnapshotStorage:
    """Publish complete local objects without adding fsync durability.

    Names `.transit-snapshot-<32 lowercase hex>.tmp` are reserved preparations,
    excluded from object inventories.
    """

    def __init__(self, root: str, base_prefix: str) -> None:
        self._root = pathlib.Path(root)
        self._prefix = base_prefix.strip("/")
        prefix_path = pathlib.PurePosixPath(self._prefix)
        if prefix_path.is_absolute() or ".." in prefix_path.parts:
            raise ValueError("unsafe_local_snapshot_path")
        self._provider_root = self._root.joinpath(*prefix_path.parts)
        try:
            self._resolved_root = self._root.resolve()
            self._resolved_provider_root = self._provider_root.resolve()
            self._resolved_provider_root.relative_to(self._resolved_root)
        except (OSError, RuntimeError, ValueError):
            raise ValueError("unsafe_local_snapshot_path") from None
        self._immutable_registry_lock = threading.Lock()
        self._immutable_locks: dict[str, threading.Lock] = {}

    def _path(self, rel_key: str) -> pathlib.Path:
        """Resolve one logical key without crossing the configured provider root."""

        try:
            rel_path = pathlib.PurePosixPath(rel_key)
            if (
                not rel_key
                or not rel_path.parts
                or rel_path.is_absolute()
                or ".." in rel_path.parts
                or _LOCAL_TEMPORARY_NAME.fullmatch(rel_path.name) is not None
            ):
                raise ValueError
            path = self._provider_root.joinpath(*rel_path.parts)
            path.resolve().relative_to(self._resolved_provider_root)
        except (OSError, RuntimeError, TypeError, ValueError):
            raise ValueError("unsafe_local_snapshot_path") from None
        return path

    def full_key(self, rel_key: str) -> str:
        """Return the on-disk path for *rel_key* as a string."""
        return str(self._path(rel_key))

    @staticmethod
    def _publish_bytes(dest: pathlib.Path, body: bytes, *, create_only: bool = False) -> bool:
        """Return false only when exclusive publication finds an existing destination."""
        dest.parent.mkdir(parents=True, exist_ok=True)
        temporary = dest.with_name(f".transit-snapshot-{uuid4().hex}.tmp")
        created = False
        published = True
        try:
            handle = temporary.open("xb")
            created = True
            try:
                if handle.write(body) != len(body):
                    raise OSError("Incomplete temporary snapshot write")
            except BaseException:
                with suppress(Exception):
                    handle.close()
                raise
            else:
                handle.close()
            if create_only:
                try:
                    os.link(temporary, dest)
                except FileExistsError:
                    published = False
            else:
                try:
                    existing_mode = stat.S_IMODE(dest.stat().st_mode)
                except FileNotFoundError:
                    existing_mode = None
                if existing_mode is not None:
                    temporary.chmod(existing_mode)
                temporary.replace(dest)
        except BaseException as failure:
            if created:
                try:
                    temporary.unlink(missing_ok=True)
                except OSError as cleanup_error:
                    failure.add_note(f"Temporary snapshot cleanup failed: {cleanup_error}")
            raise
        else:
            temporary.unlink(missing_ok=True)
        return published

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:  # noqa: ARG002
        """Publish complete bytes atomically; no fsync or crash-durability guarantee."""
        dest = self._path(rel_key)
        self._publish_bytes(dest, body)
        return str(dest)

    def put_json(self, rel_key: str, payload: BaseModel | dict, *, tier: str) -> str:  # type: ignore[type-arg]
        """Write *payload* to ``{root}/{base_prefix}/{rel_key}`` and return the path."""
        return self.put_bytes(rel_key, snapshot_json_bytes(payload), tier=tier)

    def read_bytes(self, rel_key: str) -> bytes | None:
        """Read exact local snapshot bytes, returning ``None`` when absent."""

        path = self._path(rel_key)
        try:
            return path.read_bytes()
        except FileNotFoundError:
            return None

    def read_bytes_at_version(
        self,
        rel_key: str,
        expected_version: StoredObjectVersion,
    ) -> bytes:
        """Read local bytes only while their captured version remains current."""

        if expected_version.rel_key != rel_key:
            raise ValueError("stored object version belongs to a different key")
        path = self._path(rel_key)
        try:
            raw = path.read_bytes()
            stat = path.stat()
        except FileNotFoundError:
            raise StoredObjectVersionMismatchError(rel_key, reason="object_missing") from None
        actual_version = StoredObjectVersion(
            rel_key=rel_key,
            etag=hashlib.sha256(raw).hexdigest(),
            last_modified_utc=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
            size=len(raw),
        )
        if actual_version != expected_version:
            raise StoredObjectVersionMismatchError(rel_key, reason="metadata_mismatch")
        return raw

    def capture_object_version(self, rel_key: str) -> StoredObjectVersion | None:
        """Capture a content token plus filesystem time and size."""

        path = self._path(rel_key)
        try:
            body = path.read_bytes()
            stat = path.stat()
        except FileNotFoundError:
            return None
        return StoredObjectVersion(
            rel_key=rel_key,
            etag=hashlib.sha256(body).hexdigest(),
            last_modified_utc=datetime.fromtimestamp(stat.st_mtime, tz=UTC),
            size=len(body),
        )

    def iter_object_versions(self, rel_prefix: str) -> Iterator[StoredObjectVersion]:
        """Yield deterministic recursive local inventory below *rel_prefix*."""

        provider_root = self._provider_root
        prefix_path = self._path(rel_prefix)
        if not prefix_path.exists():
            return
        paths = [prefix_path] if prefix_path.is_file() else sorted(prefix_path.rglob("*"))
        for path in paths:
            if _LOCAL_TEMPORARY_NAME.fullmatch(path.name) or not path.is_file():
                continue
            rel_key = path.relative_to(provider_root).as_posix()
            version = self.capture_object_version(rel_key)
            if version is None:
                raise RuntimeError(f"snapshot object disappeared during inventory: {rel_key}")
            yield version

    def immutable_exists(self, rel_key: str) -> bool:
        """Return whether an immutable local object exists."""

        lock = _lock_for_key(
            rel_key,
            registry_lock=self._immutable_registry_lock,
            locks=self._immutable_locks,
        )
        path = self._path(rel_key)
        with lock:
            return path.exists()

    def capture_stable_version(self, rel_key: str) -> StableObjectVersion:
        """Capture a stable local file's content version, or absence."""

        dest = self._path(rel_key)
        try:
            body = dest.read_bytes()
        except FileNotFoundError:
            return StableObjectVersion(rel_key=rel_key, token=None)
        return StableObjectVersion(rel_key=rel_key, token=hashlib.sha256(body).hexdigest())

    def activate_stable_json_outcome(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
        *,
        expected_version: StableObjectVersion,
        tier: str,  # noqa: ARG002
    ) -> StableActivationOutcome:
        """Conditionally activate a stable local JSON file."""

        if expected_version.rel_key != rel_key:
            raise ValueError("stable activation version belongs to a different key")

        body = snapshot_json_bytes(payload)
        dest = self._path(rel_key)
        with _exclusive_directory_lock(dest.parent):
            try:
                active_body = dest.read_bytes()
            except FileNotFoundError:
                active_body = None
            active_token = (
                hashlib.sha256(active_body).hexdigest() if active_body is not None else None
            )
            if active_token != expected_version.token:
                if active_body == body:
                    return StableActivationOutcome(key=str(dest), written=False)
                raise StableActivationConflictError(rel_key)
            if active_body == body:
                return StableActivationOutcome(key=str(dest), written=False)

            if not self._publish_bytes(dest, body, create_only=active_body is None):
                if dest.read_bytes() == body:
                    return StableActivationOutcome(key=str(dest), written=False)
                raise StableActivationConflictError(rel_key) from None
            return StableActivationOutcome(key=str(dest), written=True)

    def activate_stable_json(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> str:
        """Conditionally activate stable JSON and return its local path."""

        return self.activate_stable_json_outcome(
            rel_key,
            payload,
            expected_version=expected_version,
            tier=tier,
        ).key

    def put_immutable_json_outcome(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
    ) -> ImmutablePutOutcome:
        """Exclusively create an immutable file or verify exact existing bytes."""

        body = snapshot_json_bytes(payload)
        dest = self._path(rel_key)
        lock = _lock_for_key(
            rel_key,
            registry_lock=self._immutable_registry_lock,
            locks=self._immutable_locks,
        )
        with lock:
            if dest.exists():
                if dest.read_bytes() != body:
                    raise ImmutableKeyCollisionError(rel_key)
                return ImmutablePutOutcome(key=str(dest), written=False)

            if not self._publish_bytes(dest, body, create_only=True):
                if dest.read_bytes() != body:
                    raise ImmutableKeyCollisionError(rel_key) from None
                return ImmutablePutOutcome(key=str(dest), written=False)
            return ImmutablePutOutcome(key=str(dest), written=True)

    def put_immutable_json(self, rel_key: str, payload: BaseModel | dict) -> str:  # type: ignore[type-arg]
        """Create or byte-verify a content-addressed historic file."""

        return self.put_immutable_json_outcome(rel_key, payload).key

    def get_json(self, rel_key: str) -> object:
        """Read and JSON-decode the object at *rel_key*; ``None`` if the file is missing."""
        path = self._path(rel_key)
        if not path.exists():
            return None
        payload: object = json.loads(path.read_bytes())
        return payload


def state_fingerprint(tier: str) -> str:
    """Stable fingerprint for a tier's hash-state object.

    Embeds the tier's ``Cache-Control`` string so that a header-policy change
    (e.g. the static 7-day -> 1-day+SWR move) invalidates every prior hash and
    forces a one-time full rewrite that re-stamps the new header on every object.
    """
    revision = 2 if tier == "static" else 1
    return f"v{revision}|cc:{CACHE_CONTROL[tier]}"


class HashGatedStorage:
    """Skip-if-unchanged wrapper around an *inner* snapshot storage backend.

    Compares each payload's content md5 against a bucket-stored per-tier
    publish-state object (``{rel_key}`` = fingerprint + ``{rel_key: md5}``).
    When the prior hash matches the current bytes AND the loaded state carries
    the current fingerprint, the put is skipped entirely (no network write) and
    the would-be key is still returned. Otherwise the bytes are written and the
    new hash recorded. :meth:`flush_state` persists the merged hash map at the
    very end so a mid-run crash leaves the prior state intact and changed files
    retry next run — the write-then-flush order is what makes a wrongly-skipped
    PUT impossible.
    """

    def __init__(self, inner: SnapshotObjectStore, *, state_rel_key: str, fingerprint: str) -> None:
        self._inner = inner
        self._state_rel_key = state_rel_key
        self._fingerprint = fingerprint
        self._prior: dict[str, str] = {}
        self._new: dict[str, str] = {}
        self.written: list[str] = []
        self.skipped: list[str] = []
        self.immutable_written: list[str] = []
        self.immutable_skipped: list[str] = []
        # True after load() iff a prior state object existed AND carried the current
        # fingerprint (cache-policy / format version unchanged). Lets a caller make a
        # dataset-level skip decision (skip the whole rebuild) without trusting stale
        # hashes across a format change. False on absence or fingerprint mismatch.
        self.fingerprint_matched: bool = False
        # Guards the shared _new / written / skipped state so put_json can be
        # called concurrently from a ThreadPoolExecutor (slice-9.1.1r stage 2).
        # The actual PUT (slow, network) runs OUTSIDE the lock so threads still
        # upload in parallel — only the bookkeeping is serialised.
        self._lock = threading.Lock()

    def load(self) -> None:
        """Reuse only a matching, usable hash map; missing or malformed cache rebuilds."""
        self._prior = {}
        self.fingerprint_matched = False
        try:
            doc = self._inner.get_json(self._state_rel_key)
        except (json.JSONDecodeError, UnicodeDecodeError):
            return
        if not isinstance(doc, dict) or doc.get("fingerprint") != self._fingerprint:
            return
        hashes = doc.get("hashes")
        if (
            not isinstance(hashes, dict)
            or not hashes
            or any(
                not isinstance(key, str)
                or not isinstance(value, str)
                or re.fullmatch(r"[0-9a-f]{32}", value) is None
                for key, value in hashes.items()
            )
        ):
            return
        self._prior = dict(hashes)
        self.fingerprint_matched = True

    def full_key(self, rel_key: str) -> str:
        return self._inner.full_key(rel_key)

    def put_json(self, rel_key: str, payload: SnapshotPayload, *, tier: str) -> str:
        body = snapshot_json_bytes(payload)
        digest = hashlib.md5(body).hexdigest()  # noqa: S324 — content fingerprint, not security
        # Decide skip-vs-write under the lock so the shared hash map and the
        # written/skipped lists stay consistent across worker threads. A skipped
        # file does NO put_bytes (network) — the stage-1 hash-gate is preserved.
        with self._lock:
            self._new[rel_key] = digest
            skip = self._prior.get(rel_key) == digest
            if skip:
                self.skipped.append(rel_key)
        if skip:
            return self._inner.full_key(rel_key)
        # PUT happens outside the lock: the slow network round-trips run in
        # parallel; only the bookkeeping below is serialised again.
        key = self._inner.put_bytes(rel_key, body, tier=tier)
        with self._lock:
            self.written.append(rel_key)
        return key

    def flush_state(self) -> str:
        """Persist the merged (prior + new) hash map as the tier's state object.

        Merging keeps hashes for stable keys not produced in the current run
        (dated artifacts or entities no longer in current discovery) so they stay
        skippable if they ever reappear unchanged — state entries are not deleted.
        """
        merged = {**self._prior, **self._new}
        doc = {"fingerprint": self._fingerprint, "hashes": merged}
        body = snapshot_json_bytes(doc)
        return self._inner.put_bytes(self._state_rel_key, body, tier="internal")


class HistoricHashGatedStorage(HashGatedStorage):
    def __init__(self, inner: HistoricObjectStore, *, state_rel_key: str, fingerprint: str) -> None:
        if not isinstance(inner, HistoricObjectStore):
            raise TypeError("historic storage requires immutable writes and conditional activation")
        super().__init__(inner, state_rel_key=state_rel_key, fingerprint=fingerprint)
        self._historic_store = inner

    def capture_stable_version(self, rel_key: str) -> StableObjectVersion:
        return self._historic_store.capture_stable_version(rel_key)

    def put_immutable_json(self, rel_key: str, payload: SnapshotPayload) -> str:
        """Create-or-verify immutable bytes without growing mutable hash state."""

        outcome = self._historic_store.put_immutable_json_outcome(
            rel_key,
            payload,
        )
        with self._lock:
            if outcome.written:
                self.immutable_written.append(rel_key)
            else:
                self.immutable_skipped.append(rel_key)
        return outcome.key

    def activate_stable_json(
        self,
        rel_key: str,
        payload: SnapshotPayload,
        *,
        expected_version: StableObjectVersion,
        tier: str,
    ) -> str:
        """Activate through backend CAS without using prior hash state to skip."""

        body = snapshot_json_bytes(payload)
        digest = hashlib.md5(body).hexdigest()  # noqa: S324 — content fingerprint, not security
        outcome = self._historic_store.activate_stable_json_outcome(
            rel_key,
            payload,
            expected_version=expected_version,
            tier=tier,
        )
        with self._lock:
            self._new[rel_key] = digest
            if outcome.written:
                self.written.append(rel_key)
            else:
                self.skipped.append(rel_key)
        return outcome.key


def _snapshot_publish_pool_size(settings: Settings) -> int:
    try:
        concurrency = int(settings.SNAPSHOT_PUBLISH_CONCURRENCY)
    except (TypeError, ValueError):
        concurrency = 16
    return max(16, concurrency)


def build_snapshot_storage(
    settings: Settings,
    *,
    provider_id: str,
    client: object | None = None,
) -> SnapshotStorage | LocalSnapshotStorage:
    """Construct storage for the provider with snapshot-owned bucket validation."""
    base_prefix = f"v1/{provider_id}"

    if settings.SNAPSHOT_STORAGE_BACKEND == "local":
        if not settings.SNAPSHOT_LOCAL_ROOT:
            raise ValueError("SNAPSHOT_LOCAL_ROOT required for local backend")
        return LocalSnapshotStorage(settings.SNAPSHOT_LOCAL_ROOT, base_prefix)

    bucket = validate_s3_bucket_name(settings.SNAPSHOT_R2_BUCKET, setting="SNAPSHOT_R2_BUCKET")
    return SnapshotStorage(
        client
        if client is not None
        else build_s3_client(
            settings,
            bucket_setting="SNAPSHOT_R2_BUCKET",
            max_pool_connections=_snapshot_publish_pool_size(settings),
        ),
        bucket=bucket,
        base_prefix=base_prefix,
    )
