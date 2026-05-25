from __future__ import annotations

import hashlib
import re
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Protocol

from sqlalchemy import text

from transit_ops.ingestion.common import (
    get_feed_endpoint_id,
    insert_ingestion_object,
    insert_ingestion_run,
    mark_ingestion_run_succeeded,
)
from transit_ops.ingestion.realtime_gtfs import extract_realtime_metadata
from transit_ops.ingestion.storage import BronzeObjectInfo
from transit_ops.providers import ProviderRegistry
from transit_ops.rebuild.bronze_cleanup import (
    REBUILD_ENDPOINTS,
    ParsedBronzeKey,
    parse_bronze_key,
)
from transit_ops.settings import Settings
from transit_ops.source_factory.catalog import (
    build_source_factory_reset_statement,
    reset_source_factory_tables,
)

_MONTH_PATTERN = re.compile(r"^\d{4}-\d{2}$")


class BronzeCatalogStorage(Protocol):
    storage_backend: str

    def list_objects(self, prefix: str) -> Iterable[BronzeObjectInfo]: ...

    def read_bytes(self, storage_path: str) -> bytes: ...


@dataclass(frozen=True)
class SelectedBronzeObject:
    storage_path: str
    parsed_key: ParsedBronzeKey
    byte_size: int | None
    last_modified: datetime | None

    @property
    def endpoint_key(self) -> str:
        return self.parsed_key.endpoint_key

    @property
    def observed_at_utc(self) -> datetime:
        return self.parsed_key.observed_at_utc

    @property
    def checksum_prefix(self) -> str:
        return self.parsed_key.checksum_prefix

    def display_dict(self) -> dict[str, object]:
        return {
            "storage_path": self.storage_path,
            "parsed_key": self.parsed_key.display_dict(),
            "byte_size": self.byte_size,
            "last_modified": self.last_modified.isoformat() if self.last_modified else None,
        }


@dataclass(frozen=True)
class BronzeRebuildSelection:
    provider_id: str
    month: str
    static_archive: SelectedBronzeObject
    realtime_snapshots: list[SelectedBronzeObject]
    skipped_unknown_keys: list[str]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "month": self.month,
            "static_archive": self.static_archive.display_dict(),
            "realtime_snapshots": [item.display_dict() for item in self.realtime_snapshots],
            "skipped_unknown_keys": list(self.skipped_unknown_keys),
        }


@dataclass(frozen=True)
class RawCatalogRebuildResult:
    provider_id: str
    static_selected_count: int
    realtime_selected_count: int
    static_ingestion_run_id: int
    static_ingestion_object_id: int
    realtime_ingestion_run_ids: list[int]
    realtime_ingestion_object_ids: list[int]
    realtime_snapshot_ids: list[int]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "static_selected_count": self.static_selected_count,
            "realtime_selected_count": self.realtime_selected_count,
            "static_ingestion_run_id": self.static_ingestion_run_id,
            "static_ingestion_object_id": self.static_ingestion_object_id,
            "realtime_ingestion_run_ids": list(self.realtime_ingestion_run_ids),
            "realtime_ingestion_object_ids": list(self.realtime_ingestion_object_ids),
            "realtime_snapshot_ids": list(self.realtime_snapshot_ids),
        }


RESET_REBUILD_TABLES = build_source_factory_reset_statement()


def month_bounds(month: str) -> tuple[datetime, datetime]:
    if _MONTH_PATTERN.fullmatch(month) is None:
        raise ValueError("Rebuild month must use YYYY-MM format.")

    try:
        year_fragment, month_fragment = month.split("-", maxsplit=1)
        year = int(year_fragment)
        month_number = int(month_fragment)
        start = datetime(year, month_number, 1, tzinfo=UTC)
    except ValueError as exc:
        raise ValueError("Rebuild month must use YYYY-MM format.") from exc

    if month_number == 12:
        end = datetime(year + 1, 1, 1, tzinfo=UTC)
    else:
        end = datetime(year, month_number + 1, 1, tzinfo=UTC)
    return start, end


def select_rebuild_bronze_objects(
    storage: BronzeCatalogStorage,
    *,
    provider_id: str,
    month: str,
) -> BronzeRebuildSelection:
    month_start, month_end = month_bounds(month)
    static_candidates: list[SelectedBronzeObject] = []
    realtime_snapshots: list[SelectedBronzeObject] = []
    skipped_unknown_keys: list[str] = []

    for endpoint_key in REBUILD_ENDPOINTS:
        for obj in storage.list_objects(f"{provider_id}/{endpoint_key}/"):
            parsed_key = parse_bronze_key(obj.storage_path)
            if parsed_key is None:
                skipped_unknown_keys.append(obj.storage_path)
                continue
            if parsed_key.provider_id != provider_id:
                continue
            if not month_start <= parsed_key.observed_at_utc < month_end:
                continue

            selected = SelectedBronzeObject(
                storage_path=obj.storage_path,
                parsed_key=parsed_key,
                byte_size=obj.byte_size,
                last_modified=obj.last_modified,
            )
            if parsed_key.endpoint_key == "static_schedule":
                static_candidates.append(selected)
            else:
                realtime_snapshots.append(selected)

    if not static_candidates:
        raise ValueError(
            f"No static_schedule Bronze archive found for provider '{provider_id}' in {month}."
        )

    return BronzeRebuildSelection(
        provider_id=provider_id,
        month=month,
        static_archive=max(
            static_candidates,
            key=lambda item: (item.observed_at_utc, item.storage_path),
        ),
        realtime_snapshots=sorted(
            realtime_snapshots,
            key=lambda item: (item.observed_at_utc, item.endpoint_key, item.storage_path),
        ),
        skipped_unknown_keys=sorted(skipped_unknown_keys),
    )


def reset_rebuild_tables(connection) -> None:  # noqa: ANN001
    reset_source_factory_tables(connection)


def rebuild_raw_catalog(
    connection,
    *,
    provider_id: str,
    selection: BronzeRebuildSelection,
    settings: Settings,
    registry: ProviderRegistry,
    storage: BronzeCatalogStorage,
) -> RawCatalogRebuildResult:
    manifest = registry.get_provider(provider_id)
    static_run_id, static_object_id = _insert_static_catalog_rows(
        connection,
        provider_id=provider_id,
        selected=selection.static_archive,
        settings=settings,
        manifest=manifest,
        storage=storage,
    )

    realtime_run_ids: list[int] = []
    realtime_object_ids: list[int] = []
    realtime_snapshot_ids: list[int] = []
    for selected in selection.realtime_snapshots:
        run_id, object_id, snapshot_id = _insert_realtime_catalog_rows(
            connection,
            provider_id=provider_id,
            selected=selected,
            settings=settings,
            manifest=manifest,
            storage=storage,
        )
        realtime_run_ids.append(run_id)
        realtime_object_ids.append(object_id)
        realtime_snapshot_ids.append(snapshot_id)

    return RawCatalogRebuildResult(
        provider_id=provider_id,
        static_selected_count=1,
        realtime_selected_count=len(selection.realtime_snapshots),
        static_ingestion_run_id=static_run_id,
        static_ingestion_object_id=static_object_id,
        realtime_ingestion_run_ids=realtime_run_ids,
        realtime_ingestion_object_ids=realtime_object_ids,
        realtime_snapshot_ids=realtime_snapshot_ids,
    )


def _insert_static_catalog_rows(
    connection,
    *,
    provider_id: str,
    selected: SelectedBronzeObject,
    settings: Settings,
    manifest,
    storage: BronzeCatalogStorage,
) -> tuple[int, int]:
    feed = manifest.static_feed()
    payload = storage.read_bytes(selected.storage_path)
    feed_endpoint_id = get_feed_endpoint_id(
        connection,
        provider_id=provider_id,
        endpoint_key=selected.endpoint_key,
        missing_message="Static schedule feed endpoint was not found in core.feed_endpoints.",
    )
    ingestion_run_id = insert_ingestion_run(
        connection,
        provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id,
        run_kind="static_schedule",
        requested_at_utc=selected.observed_at_utc,
        started_at_utc=selected.observed_at_utc,
    )
    ingestion_object_id = insert_ingestion_object(
        connection,
        ingestion_run_id=ingestion_run_id,
        provider_id=provider_id,
        object_kind=str(feed.source_format),
        storage_backend=storage.storage_backend,
        storage_path=selected.storage_path,
        source_url=feed.resolved_source_url(settings) or "",
        checksum_sha256=_sha256_hex(payload),
        byte_size=selected.byte_size or 0,
    )
    mark_ingestion_run_succeeded(
        connection,
        ingestion_run_id=ingestion_run_id,
        completed_at_utc=selected.observed_at_utc,
        http_status_code=200,
    )
    return ingestion_run_id, ingestion_object_id


def _insert_realtime_catalog_rows(
    connection,
    *,
    provider_id: str,
    selected: SelectedBronzeObject,
    settings: Settings,
    manifest,
    storage: BronzeCatalogStorage,
) -> tuple[int, int, int]:
    feed = manifest.realtime_feed(selected.endpoint_key)
    feed_endpoint_id = get_feed_endpoint_id(
        connection,
        provider_id=provider_id,
        endpoint_key=selected.endpoint_key,
        missing_message="Realtime feed endpoint was not found in core.feed_endpoints.",
    )
    ingestion_run_id = insert_ingestion_run(
        connection,
        provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id,
        run_kind=selected.endpoint_key,
        requested_at_utc=selected.observed_at_utc,
        started_at_utc=selected.observed_at_utc,
    )
    payload = storage.read_bytes(selected.storage_path)
    metadata = extract_realtime_metadata(
        payload,
        provider_id=provider_id,
        endpoint_key=selected.endpoint_key,
    )
    ingestion_object_id = insert_ingestion_object(
        connection,
        ingestion_run_id=ingestion_run_id,
        provider_id=provider_id,
        object_kind=str(feed.source_format),
        storage_backend=storage.storage_backend,
        storage_path=selected.storage_path,
        source_url=feed.resolved_source_url(settings) or "",
        checksum_sha256=_sha256_hex(payload),
        byte_size=selected.byte_size or 0,
    )
    realtime_snapshot_id = _insert_realtime_snapshot_index(
        connection,
        ingestion_run_id=ingestion_run_id,
        ingestion_object_id=ingestion_object_id,
        provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id,
        feed_timestamp_utc=metadata.feed_timestamp_utc,
        entity_count=metadata.entity_count,
        captured_at_utc=selected.observed_at_utc,
    )
    mark_ingestion_run_succeeded(
        connection,
        ingestion_run_id=ingestion_run_id,
        completed_at_utc=selected.observed_at_utc,
        http_status_code=200,
        entity_count=metadata.entity_count,
        feed_timestamp_utc=metadata.feed_timestamp_utc,
    )
    return ingestion_run_id, ingestion_object_id, realtime_snapshot_id


def _sha256_hex(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def _insert_realtime_snapshot_index(
    connection,
    *,
    ingestion_run_id: int,
    ingestion_object_id: int,
    provider_id: str,
    feed_endpoint_id: int,
    feed_timestamp_utc: datetime,
    entity_count: int,
    captured_at_utc: datetime,
) -> int:
    result = connection.execute(
        text(
            """
            INSERT INTO raw.realtime_snapshot_index (
                ingestion_run_id,
                ingestion_object_id,
                provider_id,
                feed_endpoint_id,
                feed_timestamp_utc,
                entity_count,
                captured_at_utc
            )
            VALUES (
                :ingestion_run_id,
                :ingestion_object_id,
                :provider_id,
                :feed_endpoint_id,
                :feed_timestamp_utc,
                :entity_count,
                :captured_at_utc
            )
            RETURNING realtime_snapshot_id
            """
        ),
        {
            "ingestion_run_id": ingestion_run_id,
            "ingestion_object_id": ingestion_object_id,
            "provider_id": provider_id,
            "feed_endpoint_id": feed_endpoint_id,
            "feed_timestamp_utc": feed_timestamp_utc,
            "entity_count": entity_count,
            "captured_at_utc": captured_at_utc,
        },
    )
    return int(result.scalar_one())
