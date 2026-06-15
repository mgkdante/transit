from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import text

SUPPORTED_DATASET_KINDS = frozenset({"static_schedule", "gis_static"})


@dataclass(frozen=True)
class DatasetVersionResult:
    dataset_version_id: int
    content_changed: bool
    status: str


def _current_dataset_version(  # noqa: ANN202
    connection,  # noqa: ANN001
    *,
    provider_id: str,
    feed_endpoint_id: int,
    dataset_kind: str,
):
    return (
        connection.execute(
            text(
                """
                SELECT
                    dataset_version_id,
                    COALESCE(checksum_sha256, content_hash) AS checksum_sha256
                FROM core.dataset_versions
                WHERE provider_id = :provider_id
                  AND feed_endpoint_id = :feed_endpoint_id
                  AND dataset_kind = :dataset_kind
                  AND is_current = true
                ORDER BY loaded_at_utc DESC
                LIMIT 1
                """
            ),
            {
                "provider_id": provider_id,
                "feed_endpoint_id": feed_endpoint_id,
                "dataset_kind": dataset_kind,
            },
        )
        .mappings()
        .one_or_none()
    )


def _touch_dataset_version(
    connection,  # noqa: ANN001
    *,
    dataset_version_id: int,
    observed_at_utc: datetime,
) -> None:
    connection.execute(
        text(
            """
            UPDATE core.dataset_versions
            SET
                last_seen_at_utc = :observed_at_utc,
                observed_until_utc = :observed_at_utc
            WHERE dataset_version_id = :dataset_version_id
            """
        ),
        {
            "dataset_version_id": dataset_version_id,
            "observed_at_utc": observed_at_utc,
        },
    )


def _close_current_dataset_versions(
    connection,  # noqa: ANN001
    *,
    provider_id: str,
    feed_endpoint_id: int,
    dataset_kind: str,
    observed_until_utc: datetime,
) -> None:
    connection.execute(
        text(
            """
            UPDATE core.dataset_versions
            SET
                is_current = false,
                observed_until_utc = :observed_until_utc
            WHERE provider_id = :provider_id
              AND feed_endpoint_id = :feed_endpoint_id
              AND dataset_kind = :dataset_kind
              AND is_current = true
            """
        ),
        {
            "provider_id": provider_id,
            "feed_endpoint_id": feed_endpoint_id,
            "dataset_kind": dataset_kind,
            "observed_until_utc": observed_until_utc,
        },
    )


def _insert_dataset_version(
    connection,  # noqa: ANN001
    *,
    provider_id: str,
    feed_endpoint_id: int,
    dataset_kind: str,
    checksum_sha256: str,
    source_url: str,
    storage_backend: str,
    storage_path: str,
    byte_size: int,
    observed_at_utc: datetime,
    parser_version: str,
    source_ingestion_run_id: int | None,
    source_ingestion_object_id: int | None,
    manifest_json: dict[str, Any] | None,
) -> int:
    result = connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions (
                provider_id,
                feed_endpoint_id,
                source_ingestion_run_id,
                source_ingestion_object_id,
                dataset_kind,
                source_version,
                content_hash,
                loaded_at_utc,
                effective_at_utc,
                is_current,
                source_url,
                storage_backend,
                storage_path,
                checksum_sha256,
                byte_size,
                first_seen_at_utc,
                last_seen_at_utc,
                observed_from_utc,
                observed_until_utc,
                parser_version,
                manifest_json
            )
            VALUES (
                :provider_id,
                :feed_endpoint_id,
                :source_ingestion_run_id,
                :source_ingestion_object_id,
                :dataset_kind,
                :source_version,
                :content_hash,
                :loaded_at_utc,
                :effective_at_utc,
                true,
                :source_url,
                :storage_backend,
                :storage_path,
                :checksum_sha256,
                :byte_size,
                :first_seen_at_utc,
                :last_seen_at_utc,
                :observed_from_utc,
                :observed_until_utc,
                :parser_version,
                :manifest_json
            )
            RETURNING dataset_version_id
            """
        ),
        {
            "provider_id": provider_id,
            "feed_endpoint_id": feed_endpoint_id,
            "source_ingestion_run_id": source_ingestion_run_id,
            "source_ingestion_object_id": source_ingestion_object_id,
            "dataset_kind": dataset_kind,
            "source_version": storage_path,
            "content_hash": checksum_sha256,
            "loaded_at_utc": observed_at_utc,
            "effective_at_utc": observed_at_utc,
            "source_url": source_url,
            "storage_backend": storage_backend,
            "storage_path": storage_path,
            "checksum_sha256": checksum_sha256,
            "byte_size": byte_size,
            "first_seen_at_utc": observed_at_utc,
            "last_seen_at_utc": observed_at_utc,
            "observed_from_utc": observed_at_utc,
            "observed_until_utc": observed_at_utc,
            "parser_version": parser_version,
            "manifest_json": manifest_json,
        },
    )
    return int(result.scalar_one())


def register_or_touch_dataset_version(
    connection,  # noqa: ANN001
    *,
    provider_id: str,
    feed_endpoint_id: int,
    dataset_kind: str,
    checksum_sha256: str,
    source_url: str,
    storage_backend: str,
    storage_path: str,
    byte_size: int,
    observed_at_utc: datetime,
    parser_version: str,
    source_ingestion_run_id: int | None = None,
    source_ingestion_object_id: int | None = None,
    manifest_json: dict[str, Any] | None = None,
) -> DatasetVersionResult:
    if dataset_kind not in SUPPORTED_DATASET_KINDS:
        supported = ", ".join(sorted(SUPPORTED_DATASET_KINDS))
        raise ValueError(
            f"Unsupported dataset_kind '{dataset_kind}'. Expected one of: {supported}."
        )
    if source_ingestion_run_id is None:
        raise ValueError("source_ingestion_run_id is required to register a dataset version.")

    current = _current_dataset_version(
        connection,
        provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id,
        dataset_kind=dataset_kind,
    )

    if current is not None:
        current_id = int(current["dataset_version_id"])
        if current["checksum_sha256"] == checksum_sha256:
            _touch_dataset_version(
                connection,
                dataset_version_id=current_id,
                observed_at_utc=observed_at_utc,
            )
            return DatasetVersionResult(
                dataset_version_id=current_id,
                content_changed=False,
                status="skipped_unchanged",
            )
        _close_current_dataset_versions(
            connection,
            provider_id=provider_id,
            feed_endpoint_id=feed_endpoint_id,
            dataset_kind=dataset_kind,
            observed_until_utc=observed_at_utc,
        )

    dataset_version_id = _insert_dataset_version(
        connection,
        provider_id=provider_id,
        feed_endpoint_id=feed_endpoint_id,
        dataset_kind=dataset_kind,
        checksum_sha256=checksum_sha256,
        source_url=source_url,
        storage_backend=storage_backend,
        storage_path=storage_path,
        byte_size=byte_size,
        observed_at_utc=observed_at_utc,
        parser_version=parser_version,
        source_ingestion_run_id=source_ingestion_run_id,
        source_ingestion_object_id=source_ingestion_object_id,
        manifest_json=manifest_json,
    )
    return DatasetVersionResult(
        dataset_version_id=dataset_version_id,
        content_changed=True,
        status="changed",
    )
