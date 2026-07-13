"""Canonical JSON bytes for snapshot hashing, validation, and publication."""

from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel


def snapshot_json_bytes(payload: BaseModel | dict) -> bytes:  # type: ignore[type-arg]
    """Return the exact compact UTF-8 bytes published for a snapshot payload."""

    if isinstance(payload, BaseModel):
        return payload.model_dump_json().encode("utf-8")
    return json.dumps(payload, separators=(",", ":"), sort_keys=True).encode("utf-8")


def snapshot_sha256(payload: BaseModel | dict) -> str:  # type: ignore[type-arg]
    """Return the SHA-256 digest of :func:`snapshot_json_bytes`."""

    return hashlib.sha256(snapshot_json_bytes(payload)).hexdigest()
