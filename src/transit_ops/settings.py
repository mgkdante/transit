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
    STM_STATIC_GTFS_BETA_URL: str | None = (
        "https://www.stm.info/sites/default/files/gtfs/gtfs_stm_26m-beta.zip"
    )
    STM_RT_TRIP_UPDATES_URL: str | None = None
    STM_RT_VEHICLE_POSITIONS_URL: str | None = None

    BRONZE_STORAGE_BACKEND: str = "s3"
    BRONZE_LOCAL_ROOT: str = "./data/bronze"
    BRONZE_S3_ENDPOINT: str | None = (
        "https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com"
    )
    BRONZE_S3_BUCKET: str | None = "transit-raw"
    BRONZE_S3_ACCESS_KEY: str | None = None
    BRONZE_S3_SECRET_KEY: str | None = None
    BRONZE_S3_REGION: str = "auto"
    PIPELINE_PAUSED: bool = False
    REALTIME_POLL_SECONDS: int = 30
    REALTIME_STARTUP_DELAY_SECONDS: int = 0
    HEALTH_DATABASE_TIMEOUT_SECONDS: float = 5.0
    HEALTH_FEED_TIMEOUT_SECONDS: float = 10.0
    HEALTH_MAX_PIPELINE_AGE_SECONDS: int = 900
    STATIC_DATASET_RETENTION_COUNT: int = 1
    SILVER_REALTIME_RETENTION_DAYS: int = 30
    GOLD_FACT_RETENTION_DAYS: int = 30
    BRONZE_REALTIME_RETENTION_DAYS: int = 90
    BRONZE_STATIC_RETENTION_DAYS: int = 30
    GOLD_WARM_ROLLUP_RETENTION_DAYS: int = 365

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
            "STM_STATIC_GTFS_BETA_URL": self.STM_STATIC_GTFS_BETA_URL,
            "STM_RT_TRIP_UPDATES_URL": self.STM_RT_TRIP_UPDATES_URL,
            "STM_RT_VEHICLE_POSITIONS_URL": self.STM_RT_VEHICLE_POSITIONS_URL,
            "BRONZE_STORAGE_BACKEND": self.BRONZE_STORAGE_BACKEND,
            "BRONZE_LOCAL_ROOT": self.BRONZE_LOCAL_ROOT,
            "BRONZE_S3_ENDPOINT": self.BRONZE_S3_ENDPOINT,
            "BRONZE_S3_BUCKET": self.BRONZE_S3_BUCKET,
            "BRONZE_S3_ACCESS_KEY": "***configured***" if self.BRONZE_S3_ACCESS_KEY else None,
            "BRONZE_S3_SECRET_KEY": "***configured***" if self.BRONZE_S3_SECRET_KEY else None,
            "BRONZE_S3_REGION": self.BRONZE_S3_REGION,
            "PIPELINE_PAUSED": self.PIPELINE_PAUSED,
            "REALTIME_POLL_SECONDS": self.REALTIME_POLL_SECONDS,
            "REALTIME_STARTUP_DELAY_SECONDS": self.REALTIME_STARTUP_DELAY_SECONDS,
            "HEALTH_DATABASE_TIMEOUT_SECONDS": self.HEALTH_DATABASE_TIMEOUT_SECONDS,
            "HEALTH_FEED_TIMEOUT_SECONDS": self.HEALTH_FEED_TIMEOUT_SECONDS,
            "HEALTH_MAX_PIPELINE_AGE_SECONDS": self.HEALTH_MAX_PIPELINE_AGE_SECONDS,
            "STATIC_DATASET_RETENTION_COUNT": self.STATIC_DATASET_RETENTION_COUNT,
            "SILVER_REALTIME_RETENTION_DAYS": self.SILVER_REALTIME_RETENTION_DAYS,
            "GOLD_FACT_RETENTION_DAYS": self.GOLD_FACT_RETENTION_DAYS,
            "BRONZE_REALTIME_RETENTION_DAYS": self.BRONZE_REALTIME_RETENTION_DAYS,
            "BRONZE_STATIC_RETENTION_DAYS": self.BRONZE_STATIC_RETENTION_DAYS,
            "GOLD_WARM_ROLLUP_RETENTION_DAYS": self.GOLD_WARM_ROLLUP_RETENTION_DAYS,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
