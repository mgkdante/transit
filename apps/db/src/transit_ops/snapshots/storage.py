"""Snapshot storage layer — PUT /v1 JSON to Cloudflare R2 (or local disk).

The R2 backend reuses the existing Bronze S3 client builder (`build_s3_client`)
which reads BRONZE_S3_* credentials.  The snapshot-specific settings control
which *bucket* the published snapshots land in and whether to use local disk
instead (useful for development and CI).
"""

from __future__ import annotations

import hashlib
import json
import pathlib
import threading
from dataclasses import dataclass

from botocore.exceptions import ClientError
from pydantic import BaseModel

from transit_ops.ingestion.storage import build_s3_client
from transit_ops.settings import Settings
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


# Backward-compatible import surface for older tests and callers. Serialization
# itself lives only in snapshots.serialization.
_body = snapshot_json_bytes


class ImmutableKeyCollisionError(RuntimeError):
    """An immutable key already exists with bytes different from the request."""

    def __init__(self, rel_key: str) -> None:
        super().__init__(f"immutable key collision: {rel_key}")


@dataclass(frozen=True)
class ImmutablePutOutcome:
    """Atomic immutable write result used by the hash-gate accounting seam."""

    key: str
    written: bool


def _lock_for_key(
    rel_key: str,
    *,
    registry_lock: threading.Lock,
    locks: dict[str, threading.Lock],
) -> threading.Lock:
    with registry_lock:
        return locks.setdefault(rel_key, threading.Lock())


class SnapshotStorage:
    """PUT JSON objects to an S3-compatible bucket (Cloudflare R2).

    Thread-safety
    -------------
    The stage-2 publish (slice-9.1.1r) uploads per-entity files through a
    ThreadPoolExecutor. boto3 low-level clients are not documented as safe to
    share across threads, so when a *client_factory* is supplied each worker
    thread lazily builds and caches **its own** client in thread-local storage
    (``put_bytes`` then never shares a client between threads). When only a bare
    *client* is supplied the same instance is used on every thread, which is
    fine for the single-threaded path and the test fakes.
    """

    def __init__(
        self,
        client: object,
        *,
        bucket: str,
        base_prefix: str,
        client_factory: object | None = None,
    ) -> None:
        self._client = client
        self._bucket = bucket
        self._prefix = base_prefix.strip("/")
        self._client_factory = client_factory
        self._local = threading.local()
        self._immutable_registry_lock = threading.Lock()
        self._immutable_locks: dict[str, threading.Lock] = {}

    def _thread_client(self) -> object:
        """Return the client for the calling thread.

        With a *client_factory* every thread gets its own cached client; without
        one the shared *client* is returned (the single-threaded / fake path).
        """
        if self._client_factory is None:
            return self._client
        cached = getattr(self._local, "client", None)
        if cached is None:
            cached = self._client_factory()  # type: ignore[operator]
            self._local.client = cached
        return cached

    def full_key(self, rel_key: str) -> str:
        """Return the full bucket key for *rel_key* (``{base_prefix}/{rel_key}``)."""
        return f"{self._prefix}/{rel_key}"

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:
        """PUT raw *body* bytes at ``{base_prefix}/{rel_key}`` and return the full key."""
        key = self.full_key(rel_key)
        self._thread_client().put_object(  # type: ignore[attr-defined]
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

    def _immutable_head(self, rel_key: str) -> dict | None:  # type: ignore[type-arg]
        key = self.full_key(rel_key)
        try:
            return self._thread_client().head_object(  # type: ignore[attr-defined,no-any-return]
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
                self._thread_client().put_object(  # type: ignore[attr-defined]
                    Bucket=self._bucket,
                    Key=key,
                    Body=body,
                    ContentType="application/json",
                    CacheControl=CACHE_CONTROL["historic_immutable"],
                    Metadata={"sha256": digest},
                )
                return ImmutablePutOutcome(key=key, written=True)

            metadata = existing.get("Metadata") or {}
            prior_digest = metadata.get("sha256")
            if prior_digest is not None:
                if prior_digest == digest and existing.get("ContentLength") == len(body):
                    return ImmutablePutOutcome(key=self.full_key(rel_key), written=False)
                raise ImmutableKeyCollisionError(rel_key)

            key = self.full_key(rel_key)
            response = self._thread_client().get_object(  # type: ignore[attr-defined]
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

    def put_immutable_json(self, rel_key: str, payload: BaseModel | dict) -> str:  # type: ignore[type-arg]
        """Create or byte-verify a content-addressed historic object."""

        return self.put_immutable_json_outcome(rel_key, payload).key

    def get_json(self, rel_key: str) -> dict | None:  # type: ignore[type-arg]
        """GET and JSON-decode the object at *rel_key*; ``None`` if it is absent.

        Missing objects (404 / NoSuchKey / NotFound) return ``None`` so callers
        treat "never published" as an empty hash-state; any other error re-raises.
        """
        key = self.full_key(rel_key)
        try:
            resp = self._thread_client().get_object(Bucket=self._bucket, Key=key)  # type: ignore[attr-defined]
        except ClientError as exc:
            code = str(exc.response.get("Error", {}).get("Code", ""))
            if code in _NOT_FOUND_CODES:
                return None
            raise
        body = resp["Body"]
        try:
            return json.loads(body.read())
        finally:
            if hasattr(body, "close"):
                body.close()


class LocalSnapshotStorage:
    """Write JSON snapshots to the local filesystem (development / CI)."""

    def __init__(self, root: str, base_prefix: str) -> None:
        self._root = pathlib.Path(root)
        self._prefix = base_prefix.strip("/")
        self._immutable_registry_lock = threading.Lock()
        self._immutable_locks: dict[str, threading.Lock] = {}

    def full_key(self, rel_key: str) -> str:
        """Return the on-disk path for *rel_key* as a string."""
        return str(self._root / self._prefix / rel_key)

    def put_bytes(self, rel_key: str, body: bytes, *, tier: str) -> str:  # noqa: ARG002
        """Write raw *body* bytes to ``{root}/{base_prefix}/{rel_key}``; return path."""
        dest = self._root / self._prefix / rel_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(body)
        return str(dest)

    def put_json(self, rel_key: str, payload: BaseModel | dict, *, tier: str) -> str:  # type: ignore[type-arg]
        """Write *payload* to ``{root}/{base_prefix}/{rel_key}`` and return the path."""
        return self.put_bytes(rel_key, snapshot_json_bytes(payload), tier=tier)

    def immutable_exists(self, rel_key: str) -> bool:
        """Return whether an immutable local object exists."""

        lock = _lock_for_key(
            rel_key,
            registry_lock=self._immutable_registry_lock,
            locks=self._immutable_locks,
        )
        with lock:
            return (self._root / self._prefix / rel_key).exists()

    def put_immutable_json_outcome(
        self,
        rel_key: str,
        payload: BaseModel | dict,  # type: ignore[type-arg]
    ) -> ImmutablePutOutcome:
        """Exclusively create an immutable file or verify exact existing bytes."""

        body = snapshot_json_bytes(payload)
        dest = self._root / self._prefix / rel_key
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

            dest.parent.mkdir(parents=True, exist_ok=True)
            try:
                with dest.open("xb") as destination:
                    destination.write(body)
            except FileExistsError:
                if dest.read_bytes() != body:
                    raise ImmutableKeyCollisionError(rel_key) from None
                return ImmutablePutOutcome(key=str(dest), written=False)
            return ImmutablePutOutcome(key=str(dest), written=True)

    def put_immutable_json(self, rel_key: str, payload: BaseModel | dict) -> str:  # type: ignore[type-arg]
        """Create or byte-verify a content-addressed historic file."""

        return self.put_immutable_json_outcome(rel_key, payload).key

    def get_json(self, rel_key: str) -> dict | None:  # type: ignore[type-arg]
        """Read and JSON-decode the object at *rel_key*; ``None`` if the file is missing."""
        path = self._root / self._prefix / rel_key
        if not path.exists():
            return None
        return json.loads(path.read_bytes())


def state_fingerprint(tier: str) -> str:
    """Stable fingerprint for a tier's hash-state object.

    Embeds the tier's ``Cache-Control`` string so that a header-policy change
    (e.g. the static 7-day -> 1-day+SWR move) invalidates every prior hash and
    forces a one-time full rewrite that re-stamps the new header on every object.
    """
    return f"v1|cc:{CACHE_CONTROL[tier]}"


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

    def __init__(self, inner: object, *, state_rel_key: str, fingerprint: str) -> None:
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
        """Load prior hashes from the state object; empty on fingerprint mismatch/absence."""
        doc = self._inner.get_json(self._state_rel_key)  # type: ignore[attr-defined]
        if doc and doc.get("fingerprint") == self._fingerprint:
            self._prior = dict(doc.get("hashes", {}))
            self.fingerprint_matched = True
        else:
            self._prior = {}
            self.fingerprint_matched = False

    def full_key(self, rel_key: str) -> str:
        return self._inner.full_key(rel_key)  # type: ignore[attr-defined]

    def put_json(self, rel_key: str, payload: BaseModel | dict, *, tier: str) -> str:  # type: ignore[type-arg]
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
            return self._inner.full_key(rel_key)  # type: ignore[attr-defined]
        # PUT happens outside the lock: the slow network round-trips run in
        # parallel; only the bookkeeping below is serialised again.
        key = self._inner.put_bytes(rel_key, body, tier=tier)  # type: ignore[attr-defined]
        with self._lock:
            self.written.append(rel_key)
        return key

    def put_immutable_json(self, rel_key: str, payload: BaseModel | dict) -> str:  # type: ignore[type-arg]
        """Create-or-verify immutable bytes without growing mutable hash state."""

        outcome = self._inner.put_immutable_json_outcome(  # type: ignore[attr-defined]
            rel_key,
            payload,
        )
        with self._lock:
            if outcome.written:
                self.immutable_written.append(rel_key)
            else:
                self.immutable_skipped.append(rel_key)
        return outcome.key

    def flush_state(self) -> str:
        """Persist the merged (prior + new) hash map as the tier's state object.

        Merging keeps hashes for stable keys not produced in the current run
        (dated artifacts or entities no longer in current discovery) so they stay
        skippable if they ever reappear unchanged — state entries are not deleted.
        """
        merged = {**self._prior, **self._new}
        doc = {"fingerprint": self._fingerprint, "hashes": merged}
        body = snapshot_json_bytes(doc)
        return self._inner.put_bytes(self._state_rel_key, body, tier="internal")  # type: ignore[attr-defined]


def build_snapshot_storage(
    settings: Settings,
    *,
    provider_id: str,
    client: object | None = None,
) -> SnapshotStorage | LocalSnapshotStorage:
    """Construct the appropriate snapshot storage backend from *settings*.

    Parameters
    ----------
    settings:
        Loaded application settings.
    provider_id:
        Transit provider identifier (e.g. ``"stm"``).  Used as the second
        path segment so that all objects land under ``v1/{provider_id}/``.
    client:
        Optional pre-built boto3-compatible S3 client.  When omitted the
        real ``build_s3_client(settings)`` is called (reads BRONZE_S3_*
        credentials, which are shared between Bronze ingest and snapshot
        publishing).

    Raises
    ------
    ValueError
        If required settings are absent for the requested backend.
    """
    base_prefix = f"v1/{provider_id}"

    if settings.SNAPSHOT_STORAGE_BACKEND == "local":
        if not settings.SNAPSHOT_LOCAL_ROOT:
            raise ValueError("SNAPSHOT_LOCAL_ROOT required for local backend")
        return LocalSnapshotStorage(settings.SNAPSHOT_LOCAL_ROOT, base_prefix)

    # s3 / R2 backend
    if not settings.SNAPSHOT_R2_BUCKET:
        raise ValueError("SNAPSHOT_R2_BUCKET required for s3 backend")

    # A per-thread client factory lets the stage-2 parallel publish give each
    # worker thread its own boto3 client (boto3 clients are not safe to share
    # across threads). Skipped when a *client* is injected (tests pass a fake).
    if client is not None:
        return SnapshotStorage(
            client,
            bucket=settings.SNAPSHOT_R2_BUCKET,
            base_prefix=base_prefix,
        )
    return SnapshotStorage(
        build_s3_client(settings),
        bucket=settings.SNAPSHOT_R2_BUCKET,
        base_prefix=base_prefix,
        client_factory=lambda: build_s3_client(settings),
    )
