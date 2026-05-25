from __future__ import annotations

import csv
import tempfile
from collections.abc import Callable
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from io import TextIOWrapper
from pathlib import Path
from zipfile import BadZipFile, ZipFile

from transit_ops.ingestion.common import DownloadedArtifact, download_to_tempfile, project_root
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.silver.static_gtfs import (
    OPTIONAL_SERVICE_MEMBERS,
    REQUIRED_COLUMNS_BY_MEMBER,
    REQUIRED_STATIC_MEMBERS,
    discover_gtfs_members,
    validate_required_static_members,
)

ACTIVE_STATIC_FEED_ENDPOINT_KEY = "static_schedule"
IMPORTANT_STATIC_MEMBERS = REQUIRED_STATIC_MEMBERS | OPTIONAL_SERVICE_MEMBERS
BETA_FIRST_CONTRACT_MEMBERS = {
    "directions.txt",
    "feed_info.txt",
    "route_patterns.txt",
    "routes.txt",
    "shapes.txt",
    "trips.txt",
}
Downloader = Callable[..., DownloadedArtifact]


@dataclass(frozen=True)
class StaticFeedValidationDetail:
    label: str
    endpoint_key: str
    source_url: str | None
    status: str
    http_status_code: int | None
    byte_size: int | None
    checksum_sha256: str | None
    member_count: int
    required_members_present: list[str]
    optional_service_members_present: list[str]
    row_counts: dict[str, int]
    member_headers: dict[str, list[str]]
    feed_info_rows: list[dict[str, str]]
    message: str
    error_type: str | None

    def display_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class StaticFeedsValidationResult:
    provider_id: str
    validated_at_utc: datetime
    beta: StaticFeedValidationDetail
    schema_comparison: dict[str, object]

    def display_dict(self) -> dict[str, object]:
        return {
            "provider_id": self.provider_id,
            "validated_at_utc": self.validated_at_utc.isoformat(),
            "beta": self.beta.display_dict(),
            "schema_comparison": self.schema_comparison,
        }


def _default_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
    return download_to_tempfile(
        source_url=source_url,
        temp_dir=temp_dir,
        default_filename="static_gtfs.zip",
    )


def _unavailable_detail(
    *, label: str, endpoint_key: str, source_url: str | None, message: str, error_type: str
) -> StaticFeedValidationDetail:
    return StaticFeedValidationDetail(
        label=label,
        endpoint_key=endpoint_key,
        source_url=source_url,
        status="unavailable",
        http_status_code=None,
        byte_size=None,
        checksum_sha256=None,
        member_count=0,
        required_members_present=[],
        optional_service_members_present=[],
        row_counts={},
        member_headers={},
        feed_info_rows=[],
        message=message,
        error_type=error_type,
    )


def _invalid_detail(
    *,
    label: str,
    endpoint_key: str,
    source_url: str | None,
    artifact: DownloadedArtifact | None,
    message: str,
    error_type: str,
) -> StaticFeedValidationDetail:
    return StaticFeedValidationDetail(
        label=label,
        endpoint_key=endpoint_key,
        source_url=source_url,
        status="invalid",
        http_status_code=artifact.http_status_code if artifact else None,
        byte_size=artifact.byte_size if artifact else None,
        checksum_sha256=artifact.checksum_sha256 if artifact else None,
        member_count=0,
        required_members_present=[],
        optional_service_members_present=[],
        row_counts={},
        member_headers={},
        feed_info_rows=[],
        message=message,
        error_type=error_type,
    )


def _count_member_rows(zip_file: ZipFile, member_name: str, member_key: str) -> int:
    required_columns = REQUIRED_COLUMNS_BY_MEMBER[member_key]
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle,
        encoding="utf-8-sig",
        newline="",
    ) as text_handle:
        reader = csv.DictReader(text_handle)
        fieldnames = set(reader.fieldnames or [])
        if not fieldnames:
            raise ValueError(f"{member_name} is missing a header row.")

        missing_columns = sorted(required_columns - fieldnames)
        if missing_columns:
            missing_display = ", ".join(missing_columns)
            raise ValueError(f"{member_name} is missing required columns: {missing_display}")

        return sum(1 for _ in reader)


def _read_member_headers(zip_file: ZipFile, member_name: str) -> list[str]:
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle,
        encoding="utf-8-sig",
        newline="",
    ) as text_handle:
        reader = csv.DictReader(text_handle)
        fieldnames = reader.fieldnames or []
        if not fieldnames:
            raise ValueError(f"{member_name} is missing a header row.")
        return list(fieldnames)


def _read_feed_info_rows(zip_file: ZipFile, member_name: str) -> list[dict[str, str]]:
    with zip_file.open(member_name, "r") as raw_handle, TextIOWrapper(
        raw_handle,
        encoding="utf-8-sig",
        newline="",
    ) as text_handle:
        return [
            {key: value or "" for key, value in row.items() if key is not None}
            for row in csv.DictReader(text_handle)
        ]


def _validate_archive(
    *,
    label: str,
    endpoint_key: str,
    source_url: str,
    artifact: DownloadedArtifact,
) -> StaticFeedValidationDetail:
    try:
        member_map = discover_gtfs_members(artifact.temp_path)
        validate_required_static_members(member_map)
        row_counts: dict[str, int] = {}
        member_headers: dict[str, list[str]] = {}
        feed_info_rows: list[dict[str, str]] = []
        with ZipFile(artifact.temp_path) as zip_file:
            for member_key in sorted(member_map):
                if member_key.endswith(".txt"):
                    member_headers[member_key] = _read_member_headers(
                        zip_file,
                        member_map[member_key],
                    )
            if "feed_info.txt" in member_map:
                feed_info_rows = _read_feed_info_rows(
                    zip_file,
                    member_map["feed_info.txt"],
                )
            for member_key in sorted(IMPORTANT_STATIC_MEMBERS & set(member_map)):
                row_counts[member_key] = _count_member_rows(
                    zip_file,
                    member_map[member_key],
                    member_key,
                )
    except BadZipFile as exc:
        return _invalid_detail(
            label=label,
            endpoint_key=endpoint_key,
            source_url=source_url,
            artifact=artifact,
            message=f"Downloaded artifact is not a readable ZIP archive: {exc}",
            error_type="invalid_zip",
        )
    except ValueError as exc:
        return _invalid_detail(
            label=label,
            endpoint_key=endpoint_key,
            source_url=source_url,
            artifact=artifact,
            message=str(exc),
            error_type="schema_validation",
        )
    except (UnicodeDecodeError, csv.Error) as exc:
        return _invalid_detail(
            label=label,
            endpoint_key=endpoint_key,
            source_url=source_url,
            artifact=artifact,
            message=f"Archive CSV validation failed: {exc}",
            error_type="archive_validation",
        )

    return StaticFeedValidationDetail(
        label=label,
        endpoint_key=endpoint_key,
        source_url=source_url,
        status="ok",
        http_status_code=artifact.http_status_code,
        byte_size=artifact.byte_size,
        checksum_sha256=artifact.checksum_sha256,
        member_count=len(member_map),
        required_members_present=sorted(REQUIRED_STATIC_MEMBERS & set(member_map)),
        optional_service_members_present=sorted(OPTIONAL_SERVICE_MEMBERS & set(member_map)),
        row_counts=row_counts,
        member_headers=member_headers,
        feed_info_rows=feed_info_rows,
        message="Static GTFS feed passed non-destructive validation.",
        error_type=None,
    )


def _owns_artifact_path(artifact_path: Path, temp_dir: Path) -> bool:
    try:
        artifact_path.resolve().relative_to(temp_dir.resolve())
    except ValueError:
        return False
    return True


def _validate_feed(
    *,
    label: str,
    endpoint_key: str,
    provider,
    settings: Settings,
    downloader: Downloader,
) -> StaticFeedValidationDetail:
    feed = provider.feeds.get(endpoint_key)
    if feed is None:
        return _unavailable_detail(
            label=label,
            endpoint_key=endpoint_key,
            source_url=None,
            message=f"Provider feed '{endpoint_key}' is not configured.",
            error_type="missing_feed",
        )

    source_url = feed.resolved_source_url(settings)
    if not source_url:
        return _unavailable_detail(
            label=label,
            endpoint_key=endpoint_key,
            source_url=None,
            message=f"Provider feed '{endpoint_key}' has no resolved source URL.",
            error_type="missing_source_url",
        )

    artifact: DownloadedArtifact | None = None
    with tempfile.TemporaryDirectory(prefix="static_feed_validation_") as temp_dir_name:
        temp_dir = Path(temp_dir_name)
        try:
            artifact = downloader(source_url=source_url, temp_dir=temp_dir)
        except (OSError, ValueError) as exc:
            return _unavailable_detail(
                label=label,
                endpoint_key=endpoint_key,
                source_url=source_url,
                message=f"Static feed download failed: {exc}",
                error_type="download_error",
            )
        try:
            return _validate_archive(
                label=label,
                endpoint_key=endpoint_key,
                source_url=source_url,
                artifact=artifact,
            )
        finally:
            if artifact is not None and _owns_artifact_path(artifact.temp_path, temp_dir):
                artifact.temp_path.unlink(missing_ok=True)


def _schema_comparison(beta: StaticFeedValidationDetail) -> dict[str, object]:
    beta_members = set(beta.member_headers)

    return {
        "decision_signal": "schema_and_source_semantics",
        "row_count_signal": "diagnostic_only",
        "members_available": sorted(beta_members),
        "headers_by_member": {
            member_name: beta.member_headers[member_name]
            for member_name in sorted(beta.member_headers)
        },
        "beta_first_contract_members": sorted(BETA_FIRST_CONTRACT_MEMBERS & beta_members),
    }


def validate_static_feeds(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    downloader: Downloader | None = None,
) -> StaticFeedsValidationResult:
    resolved_settings = settings or get_settings()
    resolved_registry = registry or ProviderRegistry.from_project_root(
        project_root=project_root(),
        settings=resolved_settings,
    )
    provider = resolved_registry.get_provider(provider_id)
    resolved_downloader = downloader or _default_downloader

    beta = _validate_feed(
        label="beta",
        endpoint_key=ACTIVE_STATIC_FEED_ENDPOINT_KEY,
        provider=provider,
        settings=resolved_settings,
        downloader=resolved_downloader,
    )
    return StaticFeedsValidationResult(
        provider_id=provider_id,
        validated_at_utc=datetime.now(UTC),
        beta=beta,
        schema_comparison=_schema_comparison(beta),
    )
