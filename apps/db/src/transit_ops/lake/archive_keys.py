"""Table archive identities and versions; callers serialize copy processes."""

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory

from transit_ops.history.datasets import ArchiveGrain, TableSource, get_dataset, window_start
from transit_ops.ingestion.storage import BronzeStorage
from transit_ops.lake.objects import object_digest, put_create_only
from transit_ops.lake.table_schema import TableSchema


@dataclass(frozen=True)
class CopyKey:
    dataset_id: str
    provider_id: str
    revision: int
    grain: ArchiveGrain
    window_key: str
    version: int
    schema_version: int


def _integer(value: int, name: str, minimum: int = 1) -> None:
    if type(value) is not int or value < minimum:
        raise ValueError(f"{name} must be an integer >= {minimum}")


def _dataset(dataset_id: str) -> str:
    if not isinstance(get_dataset(dataset_id).source, TableSource):
        raise ValueError(f"Not a table dataset: {dataset_id}")
    return f"archive/v1/tables/{dataset_id}"


def table_copy_key(
    dataset_id: str,
    provider_id: str,
    revision: int,
    grain: ArchiveGrain,
    window_key: str,
    version: int,
    schema_version: int,
) -> str:
    prefix = _dataset(dataset_id)
    dataset = get_dataset(dataset_id)
    if grain != dataset.archive_grain:
        raise ValueError(f"grain does not match {dataset_id}")
    if not re.fullmatch(r"(?:[A-Za-z0-9][A-Za-z0-9_-]*|_shared)", provider_id):
        raise ValueError(f"Invalid provider_id: {provider_id}")
    _integer(revision, "revision", 0)
    _integer(version, "version")
    _integer(schema_version, "schema_version")
    start = window_start(dataset, window_key)
    folder = "editions" if start is None else f"{start.year:04d}"
    return (
        f"{prefix}/{provider_id}/r{revision}/{folder}/"
        f"{window_key}.c{version}.s{schema_version}.parquet"
    )


def parse_copy_key(key: str) -> CopyKey | None:
    match = re.fullmatch(
        r"archive/v1/tables/([^/]+)/([^/]+)/r([0-9]+)/([^/]+)/"
        r"([^/]+)\.c([0-9]+)\.s([0-9]+)\.parquet",
        key,
    )
    if match is None:
        return None
    dataset, provider, revision, _, window, version, schema = match.groups()
    try:
        grain = get_dataset(dataset).archive_grain
        parts = CopyKey(dataset, provider, int(revision), grain, window, int(version), int(schema))
        canonical = table_copy_key(
            dataset, provider, parts.revision, grain, window, parts.version, parts.schema_version
        )
        return parts if canonical == key else None
    except (ValueError, LookupError):
        return None


def proof_key(copy_key: str) -> str:
    if parse_copy_key(copy_key) is None:
        raise ValueError(f"Invalid table copy key: {copy_key}")
    return copy_key.removesuffix(".parquet") + ".proof.json"


def schema_key(dataset_id: str, schema_version: int) -> str:
    _integer(schema_version, "schema_version")
    return f"{_dataset(dataset_id)}/schemas/s{schema_version}.json"


def resolve_schema_version(storage: BronzeStorage, dataset_id: str, schema: TableSchema) -> int:
    """Reuse identical schema bytes or create max + 1; callers serialize writers.

    The create-only upload refuses a racing writer with different bytes.
    """
    prefix = f"{_dataset(dataset_id)}/schemas/"
    payload = schema.to_json()
    expected = (hashlib.sha256(payload).hexdigest(), len(payload))
    versions = sorted(
        (int(match[1]), key)
        for key in storage.list_keys(prefix)
        if (match := re.fullmatch(re.escape(prefix) + r"s([1-9][0-9]*)\.json", key))
    )
    for version, key in versions:
        if object_digest(storage, key) == expected and storage.read_bytes(key) == payload:
            return version
    version = max((version for version, _ in versions), default=0) + 1
    with TemporaryDirectory(prefix="transit-schema-") as directory:
        path = Path(directory) / "schema.json"
        path.write_bytes(payload)
        put_create_only(storage, path, schema_key(dataset_id, version), expected=expected)
    return version


@dataclass(frozen=True)
class CopyVersion:
    """An existing proven copy's key, or the next unreserved content version."""

    version: int
    key: str | None


def resolve_copy_version(
    storage: BronzeStorage,
    dataset_id: str,
    provider_id: str,
    revision: int,
    grain: ArchiveGrain,
    window_key: str,
    content_sha256: str,
) -> CopyVersion:
    """Read receipts for deduplication and reserve above objects and receipts.

    This does not write or reserve a key. Only one copy process may run at a time;
    the caller must publish with put_create_only after resolving the version.
    """
    if not re.fullmatch(r"[0-9a-f]{64}", content_sha256):
        raise ValueError("Invalid content_sha256")
    first = table_copy_key(dataset_id, provider_id, revision, grain, window_key, 1, 1)
    prefix = first.removesuffix("1.s1.parquet")
    maximum = 0
    existing: list[tuple[int, str]] = []
    for key in storage.list_keys(prefix):
        receipt = key.endswith(".proof.json")
        copy_key = key.removesuffix(".proof.json") + ".parquet" if receipt else key
        parts = parse_copy_key(copy_key)
        if parts is None or not copy_key.startswith(prefix):
            continue
        maximum = max(maximum, parts.version)
        if receipt:
            value = json.loads(storage.read_bytes(key))
            if not isinstance(value, dict) or not re.fullmatch(
                r"[0-9a-f]{64}", str(value.get("content_sha256", ""))
            ):
                raise ValueError(f"Invalid table copy receipt: {key}")
            if value["content_sha256"] == content_sha256:
                existing.append((parts.version, copy_key))
    if existing:
        version, key = max(existing)
        return CopyVersion(version, key)
    return CopyVersion(maximum + 1, None)
