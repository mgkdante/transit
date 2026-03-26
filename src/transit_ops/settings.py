from __future__ import annotations

from functools import lru_cache
from urllib.parse import urlsplit, urlunsplit

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings for the Transit Ops foundation."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=True,
        extra="ignore",
    )

    APP_ENV: str = "local"
    LOG_LEVEL: str = "INFO"
    NEON_DATABASE_URL: str | None = None

    PROVIDER_TIMEZONE: str = "America/Toronto"
    STM_PROVIDER_ID: str = "stm"
    STM_API_KEY: str | None = None
    STM_STATIC_GTFS_URL: str | None = None
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
    REALTIME_POLL_SECONDS: int = 300
    REALTIME_STARTUP_DELAY_SECONDS: int = 0
    STATIC_DATASET_RETENTION_COUNT: int = 1
    SILVER_REALTIME_RETENTION_DAYS: int = 2

    @property
    def sqlalchemy_database_url(self) -> str | None:
        """Return a SQLAlchemy-compatible URL for psycopg."""

        if not self.NEON_DATABASE_URL:
            return None

        parts = urlsplit(self.NEON_DATABASE_URL)
        if parts.scheme in {"postgresql", "postgres"}:
            return urlunsplit(
                ("postgresql+psycopg", parts.netloc, parts.path, parts.query, parts.fragment)
            )
        return self.NEON_DATABASE_URL

    @property
    def redacted_database_url(self) -> str | None:
        """Mask the credential portion of the configured database URL."""

        if not self.NEON_DATABASE_URL:
            return None

        parts = urlsplit(self.NEON_DATABASE_URL)
        host = parts.hostname or ""
        port = f":{parts.port}" if parts.port else ""
        masked_netloc = host + port
        return urlunsplit((parts.scheme, masked_netloc, parts.path, parts.query, parts.fragment))

    def display_dict(self) -> dict[str, str | None]:
        """Return a safe summary of the active settings."""

        return {
            "APP_ENV": self.APP_ENV,
            "LOG_LEVEL": self.LOG_LEVEL,
            "NEON_DATABASE_URL": self.redacted_database_url,
            "PROVIDER_TIMEZONE": self.PROVIDER_TIMEZONE,
            "STM_PROVIDER_ID": self.STM_PROVIDER_ID,
            "STM_API_KEY": "***configured***" if self.STM_API_KEY else None,
            "STM_STATIC_GTFS_URL": self.STM_STATIC_GTFS_URL,
            "STM_RT_TRIP_UPDATES_URL": self.STM_RT_TRIP_UPDATES_URL,
            "STM_RT_VEHICLE_POSITIONS_URL": self.STM_RT_VEHICLE_POSITIONS_URL,
            "BRONZE_STORAGE_BACKEND": self.BRONZE_STORAGE_BACKEND,
            "BRONZE_LOCAL_ROOT": self.BRONZE_LOCAL_ROOT,
            "BRONZE_S3_ENDPOINT": self.BRONZE_S3_ENDPOINT,
            "BRONZE_S3_BUCKET": self.BRONZE_S3_BUCKET,
            "BRONZE_S3_ACCESS_KEY": "***configured***" if self.BRONZE_S3_ACCESS_KEY else None,
            "BRONZE_S3_SECRET_KEY": "***configured***" if self.BRONZE_S3_SECRET_KEY else None,
            "BRONZE_S3_REGION": self.BRONZE_S3_REGION,
            "REALTIME_POLL_SECONDS": self.REALTIME_POLL_SECONDS,
            "REALTIME_STARTUP_DELAY_SECONDS": self.REALTIME_STARTUP_DELAY_SECONDS,
            "STATIC_DATASET_RETENTION_COUNT": self.STATIC_DATASET_RETENTION_COUNT,
            "SILVER_REALTIME_RETENTION_DAYS": self.SILVER_REALTIME_RETENTION_DAYS,
        }


@lru_cache
def get_settings() -> Settings:
    return Settings()
