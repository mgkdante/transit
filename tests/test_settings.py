import re
from pathlib import Path

import pytest

from transit_ops.settings import (
    LEGACY_DATABASE_URL_KEY,
    LEGACY_DATABASE_URL_MESSAGE,
    Settings,
)


def test_settings_defaults() -> None:
    settings = Settings(_env_file=None)

    assert settings.APP_ENV == "local"
    assert settings.LOG_LEVEL == "INFO"
    assert settings.PROVIDER_TIMEZONE == "America/Toronto"
    assert settings.STM_PROVIDER_ID == "stm"
    assert settings.BRONZE_STORAGE_BACKEND == "s3"
    assert settings.BRONZE_LOCAL_ROOT == "./data/bronze"
    assert settings.BRONZE_S3_ENDPOINT == (
        "https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com"
    )
    assert settings.BRONZE_S3_BUCKET == "transit-raw"
    assert settings.BRONZE_S3_REGION == "auto"
    assert settings.REALTIME_POLL_SECONDS == 30
    assert settings.REALTIME_STARTUP_DELAY_SECONDS == 0
    assert settings.STM_STATIC_GTFS_BETA_URL == (
        "https://www.stm.info/sites/default/files/gtfs/gtfs_stm_26m-beta.zip"
    )
    assert settings.STATIC_DATASET_RETENTION_COUNT == 1
    assert settings.SILVER_REALTIME_RETENTION_DAYS == 30
    assert settings.GOLD_FACT_RETENTION_DAYS == 30
    assert settings.BRONZE_REALTIME_RETENTION_DAYS == 90
    assert settings.BRONZE_STATIC_RETENTION_DAYS == 30
    assert settings.GOLD_WARM_ROLLUP_RETENTION_DAYS == 365
    assert settings.HEALTH_DATABASE_TIMEOUT_SECONDS == 5.0
    assert settings.HEALTH_FEED_TIMEOUT_SECONDS == 10.0
    assert settings.HEALTH_MAX_PIPELINE_AGE_SECONDS == 900
    assert settings.DATABASE_URL is None


def test_health_settings_are_exposed_in_display_dict() -> None:
    settings = Settings(_env_file=None)

    display = settings.display_dict()

    assert display["HEALTH_DATABASE_TIMEOUT_SECONDS"] == 5.0
    assert display["HEALTH_FEED_TIMEOUT_SECONDS"] == 10.0
    assert display["HEALTH_MAX_PIPELINE_AGE_SECONDS"] == 900


def test_retention_and_beta_settings_are_exposed_in_display_dict() -> None:
    settings = Settings(_env_file=None)

    display = settings.display_dict()

    assert display["STM_STATIC_GTFS_BETA_URL"] == (
        "https://www.stm.info/sites/default/files/gtfs/gtfs_stm_26m-beta.zip"
    )
    assert display["STATIC_DATASET_RETENTION_COUNT"] == 1
    assert display["SILVER_REALTIME_RETENTION_DAYS"] == 30
    assert display["GOLD_FACT_RETENTION_DAYS"] == 30
    assert display["BRONZE_REALTIME_RETENTION_DAYS"] == 90
    assert display["BRONZE_STATIC_RETENTION_DAYS"] == 30
    assert display["GOLD_WARM_ROLLUP_RETENTION_DAYS"] == 365


def test_sqlalchemy_database_url_conversion() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/dbname?sslmode=require",
    )

    assert settings.sqlalchemy_database_url == (
        "postgresql+psycopg://user:pass@example.com/dbname?sslmode=require"
    )


def test_redacted_database_url_hides_credentials() -> None:
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com:5432/dbname?sslmode=require",
    )

    assert settings.redacted_database_url == "postgresql://example.com:5432/dbname?sslmode=require"


def test_legacy_neon_database_url_constructor_input_fails_explicitly() -> None:
    with pytest.raises(ValueError, match=re.escape(LEGACY_DATABASE_URL_MESSAGE)):
        Settings(
            _env_file=None,
            **{
                LEGACY_DATABASE_URL_KEY: (
                    "postgresql://user:pass@example.com/dbname?sslmode=require"
                )
            },
        )


def test_legacy_neon_database_url_environment_input_fails_explicitly(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setenv(
        LEGACY_DATABASE_URL_KEY,
        "postgresql://user:pass@example.com/dbname?sslmode=require",
    )

    with pytest.raises(ValueError, match=re.escape(LEGACY_DATABASE_URL_MESSAGE)):
        Settings(_env_file=None)


def test_legacy_neon_database_url_dotenv_input_fails_explicitly(
    tmp_path: Path,
) -> None:
    env_file = tmp_path / ".env.legacy"
    env_file.write_text(
        f"{LEGACY_DATABASE_URL_KEY}=postgresql://user:pass@example.com/dbname"
        "?sslmode=require\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=re.escape(LEGACY_DATABASE_URL_MESSAGE)):
        Settings(_env_file=env_file)


def test_legacy_neon_database_url_file_secret_input_fails_explicitly(
    tmp_path: Path,
) -> None:
    secrets_dir = tmp_path / "secrets"
    secrets_dir.mkdir()
    (secrets_dir / LEGACY_DATABASE_URL_KEY).write_text(
        "postgresql://user:pass@example.com/dbname?sslmode=require\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match=re.escape(LEGACY_DATABASE_URL_MESSAGE)):
        Settings(_env_file=None, _secrets_dir=secrets_dir)
