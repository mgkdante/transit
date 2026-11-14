"""Create-only objects checked by the digest and size of their stored bytes."""

import hashlib
from pathlib import Path
from typing import Literal

from transit_ops.ingestion.storage import BronzeStorage, ByteStream, ObjectAlreadyExists

PutOutcome = Literal["created", "already_equal"]


class ObjectKeyTaken(FileExistsError):
    """An existing key holds different bytes."""


def object_digest(storage: BronzeStorage, key: str) -> tuple[str, int]:
    """Stream an object's SHA-256 and byte size without loading it into memory."""
    with storage.open_stream(key) as source:
        return _digest(source)


def _digest(source: ByteStream) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    while chunk := source.read(64 * 1024):
        digest.update(chunk)
        size += len(chunk)
    return digest.hexdigest(), size


def put_create_only(
    storage: BronzeStorage, path: Path, key: str, *, expected: tuple[str, int] | None = None
) -> PutOutcome:
    """Create an object, accepting an occupied key only when its bytes match.

    Successful creation consumes the source through the storage adapter. An
    equal or conflicting existing object leaves the source available to callers.
    A supplied digest and size must match the source before upload or ValueError
    is raised. Callers must keep the source unchanged until this call returns.
    """
    # A successful put consumes the file, so its identity must be captured first.
    with path.open("rb") as source:
        actual = _digest(source)
    if expected is not None and actual != expected:
        raise ValueError(f"Source does not match expected object digest and size: {key}")
    expected = actual if expected is None else expected
    try:
        storage.put_if_absent(path, key)
    except ObjectAlreadyExists as exc:
        if object_digest(storage, key) == expected:
            return "already_equal"
        raise ObjectKeyTaken(f"Object key holds different bytes: {key}") from exc
    return "created"
