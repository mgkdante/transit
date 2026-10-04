from __future__ import annotations

import os
from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any, Literal
from urllib.parse import urlsplit, urlunsplit

from pydantic.fields import FieldInfo
from pydantic_settings import BaseSettings, PydanticBaseSettingsSource, SettingsConfigDict

LEGACY_DATABASE_URL_KEY = "NEON" "_DATABASE_URL"
LEGACY_DATABASE_URL_MESSAGE = (
    f"{LEGACY_DATABASE_URL_KEY} is no longer supported; use DATABASE_URL instead."
)


class LegacyDatabaseUrlGuardSource(PydanticBaseSettingsSource):
    def __init__(self, wrapped: PydanticBaseSettingsSource) -> None:
        super().__init__(wrapped.settings_cls)
        self.wrapped = wrapped

    def get_field_value(self, field: FieldInfo, field_name: str) -> tuple[Any, str, bool]:
        return self.wrapped.get_field_value(field, field_name)

    def __call__(self) -> dict[str, Any]:
        self._raise_if_legacy_key_present(self._legacy_keys_from_env_vars())
        self._raise_if_legacy_key_present(self._legacy_keys_from_file_secrets())

        data = self.wrapped()
        self._raise_if_legacy_key_present(data)
        return data

    def _legacy_keys_from_env_vars(self) -> Mapping[str, str | None]:
        env_vars = getattr(self.wrapped, "env_vars", None)
        if isinstance(env_vars, Mapping):
            return env_vars
        return {}

    def _legacy_keys_from_file_secrets(self) -> Mapping[str, str | None]:
        secrets_dir = getattr(self.wrapped, "secrets_dir", None)
        if secrets_dir is None:
            return {}

        secrets_dirs = [secrets_dir] if isinstance(secrets_dir, str | Path) else secrets_dir
        for entry in secrets_dirs:
            candidate = Path(entry).expanduser() / LEGACY_DATABASE_URL_KEY
            if candidate.is_file():
                return {LEGACY_DATABASE_URL_KEY: candidate.read_text().strip()}

        return {}

    @staticmethod
    def _raise_if_legacy_key_present(data: Mapping[str, Any]) -> None:
        if LEGACY_DATABASE_URL_KEY in data:
            raise ValueError(LEGACY_DATABASE_URL_MESSAGE)


class Settings(BaseSettings):
    """Application settings for the Transit Ops foundation."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    @classmethod
    def settings_customise_sources(
        cls,
        settings_cls: type[BaseSettings],
        init_settings: PydanticBaseSettingsSource,
        env_settings: PydanticBaseSettingsSource,
        dotenv_settings: PydanticBaseSettingsSource,
        file_secret_settings: PydanticBaseSettingsSource,
    ) -> tuple[PydanticBaseSettingsSource, ...]:
        return (
            LegacyDatabaseUrlGuardSource(init_settings),
            LegacyDatabaseUrlGuardSource(env_settings),
            LegacyDatabaseUrlGuardSource(dotenv_settings),
            LegacyDatabaseUrlGuardSource(file_secret_settings),
        )

    def env_value(self, name: str | None) -> str | None:
        if not name:
            return None
        if name in type(self).model_fields:
            value = getattr(self, name, None)
            return str(value) if value else None
        return os.environ.get(name) or None

    APP_ENV: str = "local"
    LOG_LEVEL: str = "INFO"
    DATABASE_URL: str | None = None

    PROVIDER_TIMEZONE: str = "America/Toronto"
    STM_PROVIDER_ID: str = "stm"
    STM_API_KEY: str | None = None
    STM_STATIC_GTFS_URL: str | None = None
    STM_GIS_URL: str | None = None
    STM_RT_TRIP_UPDATES_URL: str | None = None
    STM_RT_VEHICLE_POSITIONS_URL: str | None = None
    STM_I3_ALERTS_URL: str | None = None

    BRONZE_STORAGE_BACKEND: Literal["local", "s3"] = "local"
    BRONZE_LOCAL_ROOT: str = "./data/bronze"
    BRONZE_S3_ENDPOINT: str | None = None
    BRONZE_S3_BUCKET: str | None = None
    BRONZE_S3_ACCESS_KEY: str | None = None
    BRONZE_S3_SECRET_KEY: str | None = None
    BRONZE_S3_REGION: str = "auto"

    SNAPSHOT_STORAGE_BACKEND: Literal["local", "s3"] = "local"
    SNAPSHOT_LOCAL_ROOT: str | None = "./data/snapshots"
    SNAPSHOT_R2_BUCKET: str | None = None
    SNAPSHOT_PUBLIC_BASE_URL: str | None = None
    SNAPSHOT_BASEMAP_STYLE_URL: str | None = None
    SNAPSHOT_BASEMAP_ATTRIBUTION: str = "© OpenStreetMap contributors, © Protomaps"
    # Values <=1 disable upload concurrency; publish the manifest after its files.
    SNAPSHOT_PUBLISH_CONCURRENCY: int = 16

    PIPELINE_PAUSED: bool = False
    REALTIME_POLL_SECONDS: int = 30
    REALTIME_STARTUP_DELAY_SECONDS: int = 0
    # Pruning cadence is independent of realtime capture cadence.
    PRUNER_SLEEP_SECONDS: int = 15
    HEALTH_DATABASE_TIMEOUT_SECONDS: float = 5.0
    HEALTH_FEED_TIMEOUT_SECONDS: float = 10.0
    HEALTH_MAX_PIPELINE_AGE_SECONDS: int = 900
    HEALTH_RUNTIME_CACHE_SECONDS: int = 30
    # Fallback strictness for manifests that omit strict_gtfs.
    STRICT_GTFS: bool = True
    STATIC_DATASET_RETENTION_COUNT: int = 1
    # Silver can be rebuilt from Bronze; retain the immediate predecessor for worker cycles.
    SILVER_REALTIME_RETENTION_DAYS: int = 1
    # Bound each deletion transaction so a backlog drains over successive passes.
    SILVER_REALTIME_PRUNE_BATCH: int = 100000
    # Longer history comes from warm rollups; fact queries bind this retention setting.
    GOLD_FACT_RETENTION_DAYS: int = 14
    # Bound Gold fact deletions to limit locks and WAL while draining backlog.
    GOLD_FACT_PRUNE_BATCH: int = 100000
    # Throttle expensive ANALYZE; zero analyzes every cycle.
    GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS: int = 3600
    GOLD_REPORTING_OPEN_WINDOW_DAYS: int = 10
    # Bronze raw objects are the replay source and remain in object storage.
    BRONZE_REALTIME_RETENTION_DAYS: int = 90
    BRONZE_STATIC_RETENTION_DAYS: int = 30
    GOLD_WARM_ROLLUP_RETENTION_DAYS: int = 730
    BRONZE_I3_RETENTION_DAYS: int = 30
    SILVER_I3_CLOSED_RETENTION_DAYS: int = 90
    BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH: int = 5000
    BRONZE_PRUNE_MAX_BATCHES: int = 2

    BACKUP_S3_PREFIX: str = "backups/postgres"
    BACKUP_RETENTION_COUNT: int = 14
    BACKUP_EXCLUDE_TABLE_DATA: str = "silver.rt_trip_update_stop_times"
    BACKUP_COMPRESSION: str = "zstd:3"

    @property
    def backup_exclude_tables(self) -> list[str]:

        return [
            table.strip()
            for table in self.BACKUP_EXCLUDE_TABLE_DATA.split(",")
            if table.strip()
        ]

    @property
    def sqlalchemy_database_url(self) -> str | None:

        if not self.DATABASE_URL:
            return None

        parts = urlsplit(self.DATABASE_URL)
        if parts.scheme in {"postgresql", "postgres"}:
            return urlunsplit(
                ("postgresql+psycopg", parts.netloc, parts.path, parts.query, parts.fragment)
            )
        return self.DATABASE_URL

    @property
    def redacted_database_url(self) -> str | None:

        if not self.DATABASE_URL:
            return None

        parts = urlsplit(self.DATABASE_URL)
        host = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
        masked_netloc = host + port
        return urlunsplit((parts.scheme, masked_netloc, parts.path, parts.query, parts.fragment))

    def display_dict(self) -> dict[str, object]:

        return {
            "APP_ENV": self.APP_ENV,
            "LOG_LEVEL": self.LOG_LEVEL,
            "DATABASE_URL": self.redacted_database_url,
            "PROVIDER_TIMEZONE": self.PROVIDER_TIMEZONE,
            "STM_PROVIDER_ID": self.STM_PROVIDER_ID,
            "STM_API_KEY": "***configured***" if self.STM_API_KEY else None,
            "STM_STATIC_GTFS_URL": self.STM_STATIC_GTFS_URL,
            "STM_GIS_URL": self.STM_GIS_URL,
            "STM_RT_TRIP_UPDATES_URL": self.STM_RT_TRIP_UPDATES_URL,
            "STM_RT_VEHICLE_POSITIONS_URL": self.STM_RT_VEHICLE_POSITIONS_URL,
            "STM_I3_ALERTS_URL": self.STM_I3_ALERTS_URL,
            "BRONZE_STORAGE_BACKEND": self.BRONZE_STORAGE_BACKEND,
            "BRONZE_LOCAL_ROOT": self.BRONZE_LOCAL_ROOT,
            "BRONZE_S3_ENDPOINT": self.BRONZE_S3_ENDPOINT,
            "BRONZE_S3_BUCKET": self.BRONZE_S3_BUCKET,
            "BRONZE_S3_ACCESS_KEY": "***configured***" if self.BRONZE_S3_ACCESS_KEY else None,
            "BRONZE_S3_SECRET_KEY": "***configured***" if self.BRONZE_S3_SECRET_KEY else None,
            "BRONZE_S3_REGION": self.BRONZE_S3_REGION,
            "SNAPSHOT_STORAGE_BACKEND": self.SNAPSHOT_STORAGE_BACKEND,
            "SNAPSHOT_LOCAL_ROOT": self.SNAPSHOT_LOCAL_ROOT,
            "SNAPSHOT_R2_BUCKET": self.SNAPSHOT_R2_BUCKET,
            "SNAPSHOT_PUBLIC_BASE_URL": self.SNAPSHOT_PUBLIC_BASE_URL,
            "SNAPSHOT_BASEMAP_STYLE_URL": self.SNAPSHOT_BASEMAP_STYLE_URL,
            "SNAPSHOT_BASEMAP_ATTRIBUTION": self.SNAPSHOT_BASEMAP_ATTRIBUTION,
            "SNAPSHOT_PUBLISH_CONCURRENCY": self.SNAPSHOT_PUBLISH_CONCURRENCY,
            "PIPELINE_PAUSED": self.PIPELINE_PAUSED,
            "REALTIME_POLL_SECONDS": self.REALTIME_POLL_SECONDS,
            "REALTIME_STARTUP_DELAY_SECONDS": self.REALTIME_STARTUP_DELAY_SECONDS,
            "PRUNER_SLEEP_SECONDS": self.PRUNER_SLEEP_SECONDS,
            "HEALTH_DATABASE_TIMEOUT_SECONDS": self.HEALTH_DATABASE_TIMEOUT_SECONDS,
            "HEALTH_FEED_TIMEOUT_SECONDS": self.HEALTH_FEED_TIMEOUT_SECONDS,
            "HEALTH_MAX_PIPELINE_AGE_SECONDS": self.HEALTH_MAX_PIPELINE_AGE_SECONDS,
            "HEALTH_RUNTIME_CACHE_SECONDS": self.HEALTH_RUNTIME_CACHE_SECONDS,
            "STRICT_GTFS": self.STRICT_GTFS,
            "STATIC_DATASET_RETENTION_COUNT": self.STATIC_DATASET_RETENTION_COUNT,
            "SILVER_REALTIME_RETENTION_DAYS": self.SILVER_REALTIME_RETENTION_DAYS,
            "SILVER_REALTIME_PRUNE_BATCH": self.SILVER_REALTIME_PRUNE_BATCH,
            "GOLD_FACT_RETENTION_DAYS": self.GOLD_FACT_RETENTION_DAYS,
            "GOLD_FACT_PRUNE_BATCH": self.GOLD_FACT_PRUNE_BATCH,
            "GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS": (
                self.GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS
            ),
            "GOLD_REPORTING_OPEN_WINDOW_DAYS": self.GOLD_REPORTING_OPEN_WINDOW_DAYS,
            "BRONZE_REALTIME_RETENTION_DAYS": self.BRONZE_REALTIME_RETENTION_DAYS,
            "BRONZE_STATIC_RETENTION_DAYS": self.BRONZE_STATIC_RETENTION_DAYS,
            "GOLD_WARM_ROLLUP_RETENTION_DAYS": self.GOLD_WARM_ROLLUP_RETENTION_DAYS,
            "BRONZE_I3_RETENTION_DAYS": self.BRONZE_I3_RETENTION_DAYS,
            "SILVER_I3_CLOSED_RETENTION_DAYS": self.SILVER_I3_CLOSED_RETENTION_DAYS,
            "BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH": self.BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH,
            "BRONZE_PRUNE_MAX_BATCHES": self.BRONZE_PRUNE_MAX_BATCHES,
            "BACKUP_S3_PREFIX": self.BACKUP_S3_PREFIX,
            "BACKUP_RETENTION_COUNT": self.BACKUP_RETENTION_COUNT,
            "BACKUP_EXCLUDE_TABLE_DATA": self.BACKUP_EXCLUDE_TABLE_DATA,
            "BACKUP_COMPRESSION": self.BACKUP_COMPRESSION,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
