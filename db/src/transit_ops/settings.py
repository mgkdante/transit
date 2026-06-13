from __future__ import annotations

from collections.abc import Mapping
from functools import lru_cache
from pathlib import Path
from typing import Any
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

    BRONZE_STORAGE_BACKEND: str = "s3"
    BRONZE_LOCAL_ROOT: str = "./data/bronze"
    BRONZE_S3_ENDPOINT: str | None = (
        "https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com"
    )
    BRONZE_S3_BUCKET: str | None = "transit-raw"
    BRONZE_S3_ACCESS_KEY: str | None = None
    BRONZE_S3_SECRET_KEY: str | None = None
    BRONZE_S3_REGION: str = "auto"

    # --- /v1 snapshot publisher (reuses BRONZE_S3_* credentials) ---
    SNAPSHOT_STORAGE_BACKEND: str = "s3"          # "s3" | "local"
    SNAPSHOT_LOCAL_ROOT: str | None = None         # used when backend == "local"
    SNAPSHOT_R2_BUCKET: str | None = None          # public snapshot bucket
    SNAPSHOT_PUBLIC_BASE_URL: str | None = None    # e.g. https://data.example.com (manifests)

    PIPELINE_PAUSED: bool = False
    REALTIME_POLL_SECONDS: int = 30
    REALTIME_STARTUP_DELAY_SECONDS: int = 0
    HEALTH_DATABASE_TIMEOUT_SECONDS: float = 5.0
    HEALTH_FEED_TIMEOUT_SECONDS: float = 10.0
    HEALTH_MAX_PIPELINE_AGE_SECONDS: int = 900
    HEALTH_RUNTIME_CACHE_SECONDS: int = 30
    STATIC_DATASET_RETENTION_COUNT: int = 1
    SILVER_REALTIME_RETENTION_DAYS: int = 14
    # Max rows deleted per realtime-history table per prune cycle. The prune runs
    # on every ~57s worker cycle; an unbounded DELETE of the accumulated backlog
    # (e.g. ~252M-row silver.rt_trip_update_stop_times after a redeploy) in a
    # single transaction is the unbounded-heavy-op hang class. Bounding each
    # DELETE to this many rows/table/cycle drains the one-time backlog gradually
    # over many cycles while a steady-state delta clears in one quick pass.
    SILVER_REALTIME_PRUNE_BATCH: int = 50000
    GOLD_FACT_RETENTION_DAYS: int = 14
    # Max rows deleted per gold-fact table per prune cycle. Like the silver
    # realtime prune, prune_gold_fact_history runs on every ~57s worker cycle; an
    # unbounded DELETE of the whole backlog (the first cycle after a worker
    # outage must drain the entire 18.7M-scale fact_trip_delay_snapshot in ONE
    # transaction — long lock hold, WAL/bloat spike) is the unbounded-heavy-op
    # hang class the silver prunes were already batched to avoid. Bounding each
    # DELETE drains a one-time backlog gradually while steady-state clears fast.
    GOLD_FACT_PRUNE_BATCH: int = 50000
    # The per-cycle ANALYZE of the realtime silver tables (incl. the ~500M-row
    # rt_trip_update_stop_times) takes SHARE UPDATE EXCLUSIVE + heavy sampling
    # I/O inside the advisory-locked gold-refresh TX. Per-snapshot upserts filter
    # on a constant rt_feed_snapshot_id, so stale stats barely move the plan —
    # throttle ANALYZE to at most once per this many seconds (rely on tuned
    # autovacuum/autoanalyze between runs). 0 disables the throttle (always run).
    GOLD_REALTIME_ANALYZE_MIN_INTERVAL_SECONDS: int = 3600
    GOLD_REPORTING_OPEN_WINDOW_DAYS: int = 10
    BRONZE_REALTIME_RETENTION_DAYS: int = 30
    BRONZE_STATIC_RETENTION_DAYS: int = 365
    GOLD_WARM_ROLLUP_RETENTION_DAYS: int = 365
    BRONZE_I3_RETENTION_DAYS: int = 30
    SILVER_I3_CLOSED_RETENTION_DAYS: int = 90
    BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH: int = 5000
    BRONZE_PRUNE_MAX_BATCHES: int = 1

    # --- Nightly logical Postgres backups (stream pg_dump to Bronze R2) ---
    BACKUP_S3_PREFIX: str = "backups/postgres"
    BACKUP_RETENTION_COUNT: int = 14
    BACKUP_EXCLUDE_TABLE_DATA: str = "silver.rt_trip_update_stop_times"
    BACKUP_COMPRESSION: str = "zstd:3"

    @property
    def backup_exclude_tables(self) -> list[str]:
        """Tables whose data is excluded from pg_dump, blanks filtered out."""

        return [
            table.strip()
            for table in self.BACKUP_EXCLUDE_TABLE_DATA.split(",")
            if table.strip()
        ]

    @property
    def sqlalchemy_database_url(self) -> str | None:
        """Return a SQLAlchemy-compatible URL for psycopg."""

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
        """Mask the credential portion of the configured database URL."""

        if not self.DATABASE_URL:
            return None

        parts = urlsplit(self.DATABASE_URL)
        host = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
        masked_netloc = host + port
        return urlunsplit((parts.scheme, masked_netloc, parts.path, parts.query, parts.fragment))

    def display_dict(self) -> dict[str, object]:
        """Return a safe summary of the active settings."""

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
            "PIPELINE_PAUSED": self.PIPELINE_PAUSED,
            "REALTIME_POLL_SECONDS": self.REALTIME_POLL_SECONDS,
            "REALTIME_STARTUP_DELAY_SECONDS": self.REALTIME_STARTUP_DELAY_SECONDS,
            "HEALTH_DATABASE_TIMEOUT_SECONDS": self.HEALTH_DATABASE_TIMEOUT_SECONDS,
            "HEALTH_FEED_TIMEOUT_SECONDS": self.HEALTH_FEED_TIMEOUT_SECONDS,
            "HEALTH_MAX_PIPELINE_AGE_SECONDS": self.HEALTH_MAX_PIPELINE_AGE_SECONDS,
            "HEALTH_RUNTIME_CACHE_SECONDS": self.HEALTH_RUNTIME_CACHE_SECONDS,
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
