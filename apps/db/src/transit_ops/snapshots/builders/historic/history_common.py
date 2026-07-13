"""Shared identity helpers for retained-history family artifacts."""

from __future__ import annotations

import re

from transit_ops.snapshots.serialization import snapshot_sha256

_CANONICAL_ENTITY_ID = re.compile(r"(?:[0-9a-f]{2})+")


def history_collection_generation_id(canonical: dict) -> str:  # type: ignore[type-arg]
    """Digest canonical collection identity through the shared byte authority."""

    return snapshot_sha256(canonical)


def encode_history_entity_id(entity_id: str) -> str:
    """Encode an entity ID as its bijective, path-safe lowercase UTF-8 hex."""

    if not entity_id:
        raise ValueError("history entity ID cannot be empty")
    return entity_id.encode("utf-8").hex()


def decode_history_entity_id(encoded_id: str) -> str:
    """Decode one canonical retained-history entity path segment."""

    if _CANONICAL_ENTITY_ID.fullmatch(encoded_id) is None:
        raise ValueError("encoded history entity ID must be non-empty lowercase UTF-8 hex")
    try:
        return bytes.fromhex(encoded_id).decode("utf-8")
    except UnicodeDecodeError as exc:
        raise ValueError("encoded history entity ID is not valid UTF-8") from exc
