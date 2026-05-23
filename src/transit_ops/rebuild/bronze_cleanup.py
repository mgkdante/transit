from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Protocol

from transit_ops.ingestion.storage import BronzeObjectInfo

REBUILD_ENDPOINTS = ("static_schedule", "trip_updates", "vehicle_positions")

_PARTITION_BY_ENDPOINT = {
    "static_schedule": "ingested_at_utc",
    "trip_updates": "captured_at_utc",
    "vehicle_positions": "captured_at_utc",
}

_REALTIME_FILENAME_BY_ENDPOINT = {
    "trip_updates": "trip_updates.pb",
    "vehicle_positions": "vehicle_positions.pb",
}

_CHECKSUM_PREFIX_PATTERN = re.compile(r"^[0-9a-fA-F]{12}$")


class BronzeCleanupStorage(Protocol):
    def list_objects(self, prefix: str) -> Iterable[BronzeObjectInfo]: ...

    def delete_object(self, storage_path: str) -> None: ...


@dataclass(frozen=True)
class ParsedBronzeKey:
    provider_id: str
    endpoint_key: str
    key_date: date
    observed_at_utc: datetime
    checksum_prefix: str
    filename: str


@dataclass(frozen=True)
class BronzeCleanupItem:
    storage_path: str
    parsed_key: ParsedBronzeKey
    byte_size: int | None
    last_modified: datetime | None


@dataclass(frozen=True)
class BronzeCleanupPlan:
    provider_id: str
    keep_from_date: date
    eligible_objects: list[BronzeCleanupItem]
    retained_objects: list[BronzeCleanupItem]
    skipped_unknown_keys: list[str]


@dataclass(frozen=True)
class BronzeCleanupResult:
    provider_id: str
    keep_from_date: date
    delete_requested: bool
    eligible_count: int
    retained_count: int
    skipped_unknown_keys: list[str]
    deleted_keys: list[str]
    failed_keys: list[str]

    @classmethod
    def from_plan(
        cls,
        plan: BronzeCleanupPlan,
        *,
        delete_requested: bool,
        deleted_keys: list[str],
        failed_keys: list[str],
    ) -> BronzeCleanupResult:
        return cls(
            provider_id=plan.provider_id,
            keep_from_date=plan.keep_from_date,
            delete_requested=delete_requested,
            eligible_count=len(plan.eligible_objects),
            retained_count=len(plan.retained_objects),
            skipped_unknown_keys=list(plan.skipped_unknown_keys),
            deleted_keys=deleted_keys,
            failed_keys=failed_keys,
        )


def parse_bronze_key(storage_path: str) -> ParsedBronzeKey | None:
    parts = storage_path.split("/")
    if len(parts) != 4:
        return None

    provider_id, endpoint_key, partition, object_name = parts
    expected_partition_label = _PARTITION_BY_ENDPOINT.get(endpoint_key)
    if expected_partition_label is None:
        return None

    partition_label, separator, partition_date = partition.partition("=")
    if separator != "=" or partition_label != expected_partition_label:
        return None

    object_parts = object_name.split("__", maxsplit=2)
    if len(object_parts) != 3:
        return None

    timestamp_fragment, checksum_prefix, filename = object_parts
    if _CHECKSUM_PREFIX_PATTERN.fullmatch(checksum_prefix) is None:
        return None

    expected_filename = _REALTIME_FILENAME_BY_ENDPOINT.get(endpoint_key)
    if expected_filename is not None and filename != expected_filename:
        return None

    try:
        key_date = date.fromisoformat(partition_date)
        observed_at_utc = datetime.strptime(
            timestamp_fragment,
            "%Y%m%dT%H%M%S%fZ",
        ).replace(tzinfo=UTC)
    except ValueError:
        return None

    return ParsedBronzeKey(
        provider_id=provider_id,
        endpoint_key=endpoint_key,
        key_date=key_date,
        observed_at_utc=observed_at_utc,
        checksum_prefix=checksum_prefix,
        filename=filename,
    )


def build_bronze_cleanup_plan(
    storage: BronzeCleanupStorage,
    *,
    provider_id: str,
    keep_from_date: date,
) -> BronzeCleanupPlan:
    prefixes = [f"{provider_id}/{endpoint}/" for endpoint in REBUILD_ENDPOINTS]
    scanned = [obj for prefix in prefixes for obj in storage.list_objects(prefix)]

    eligible_objects: list[BronzeCleanupItem] = []
    retained_objects: list[BronzeCleanupItem] = []
    skipped_unknown_keys: list[str] = []

    for obj in scanned:
        parsed_key = parse_bronze_key(obj.storage_path)
        if parsed_key is None:
            skipped_unknown_keys.append(obj.storage_path)
            continue

        item = BronzeCleanupItem(
            storage_path=obj.storage_path,
            parsed_key=parsed_key,
            byte_size=obj.byte_size,
            last_modified=obj.last_modified,
        )
        if parsed_key.key_date < keep_from_date:
            eligible_objects.append(item)
        else:
            retained_objects.append(item)

    return BronzeCleanupPlan(
        provider_id=provider_id,
        keep_from_date=keep_from_date,
        eligible_objects=eligible_objects,
        retained_objects=retained_objects,
        skipped_unknown_keys=skipped_unknown_keys,
    )


def execute_bronze_cleanup_plan(
    storage: BronzeCleanupStorage,
    plan: BronzeCleanupPlan,
    *,
    delete: bool,
) -> BronzeCleanupResult:
    if not delete:
        return BronzeCleanupResult.from_plan(
            plan,
            delete_requested=False,
            deleted_keys=[],
            failed_keys=[],
        )

    deleted_keys: list[str] = []
    failed_keys: list[str] = []
    for item in plan.eligible_objects:
        try:
            storage.delete_object(item.storage_path)
        except Exception:
            failed_keys.append(item.storage_path)
            continue
        deleted_keys.append(item.storage_path)

    return BronzeCleanupResult.from_plan(
        plan,
        delete_requested=True,
        deleted_keys=deleted_keys,
        failed_keys=failed_keys,
    )
