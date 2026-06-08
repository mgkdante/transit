"""Snapshot storage layer — PUT /v1 JSON to Cloudflare R2 (or local disk).

The R2 backend reuses the existing Bronze S3 client builder (`build_s3_client`)
which reads BRONZE_S3_* credentials.  The snapshot-specific settings control
which *bucket* the published snapshots land in and whether to use local disk
instead (useful for development and CI).
"""

from __future__ import annotations

import json
import pathlib

from pydantic import BaseModel

from transit_ops.ingestion.storage import build_s3_client
from transit_ops.settings import Settings

# Cache-Control header per data tier.
# live    — 30 s TTL; realtime vehicle positions / alerts
# static  — 7-day TTL; GTFS-derived shapes, stops, routes
# historic — 1-day TTL; aggregated summaries that change once per day
CACHE_CONTROL: dict[str, str] = {
    "live": "public, max-age=30",
    "static": "public, max-age=604800",
    "historic": "public, max-age=86400",
}


def _body(payload: BaseModel | dict) -> bytes:  # type: ignore[type-arg]
    """Serialize a Pydantic model or plain dict to compact UTF-8 JSON bytes."""
    if isinstance(payload, BaseModel):
        return payload.model_dump_json().encode("utf-8")
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


class SnapshotStorage:
    """PUT JSON objects to an S3-compatible bucket (Cloudflare R2)."""

    def __init__(self, client: object, *, bucket: str, base_prefix: str) -> None:
        self._client = client
        self._bucket = bucket
        self._prefix = base_prefix.strip("/")

    def put_json(self, rel_key: str, payload: BaseModel | dict, *, tier: str) -> str:  # type: ignore[type-arg]
        """PUT *payload* at ``{base_prefix}/{rel_key}`` and return the full key.

        Parameters
        ----------
        rel_key:
            Path relative to the base prefix, e.g. ``"live/vehicles.json"``.
        payload:
            Pydantic model or plain dict to serialise as JSON.
        tier:
            One of ``"live"``, ``"static"``, or ``"historic"``; controls the
            ``Cache-Control`` header.
        """
        key = f"{self._prefix}/{rel_key}"
        self._client.put_object(  # type: ignore[attr-defined]
            Bucket=self._bucket,
            Key=key,
            Body=_body(payload),
            ContentType="application/json",
            CacheControl=CACHE_CONTROL[tier],
        )
        return key


class LocalSnapshotStorage:
    """Write JSON snapshots to the local filesystem (development / CI)."""

    def __init__(self, root: str, base_prefix: str) -> None:
        self._root = pathlib.Path(root)
        self._prefix = base_prefix.strip("/")

    def put_json(self, rel_key: str, payload: BaseModel | dict, *, tier: str) -> str:  # type: ignore[type-arg]
        """Write *payload* to ``{root}/{base_prefix}/{rel_key}`` and return the path."""
        dest = self._root / self._prefix / rel_key
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(_body(payload))
        return str(dest)


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

    resolved_client = client if client is not None else build_s3_client(settings)
    return SnapshotStorage(
        resolved_client,
        bucket=settings.SNAPSHOT_R2_BUCKET,
        base_prefix=base_prefix,
    )
