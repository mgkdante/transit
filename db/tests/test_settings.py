import re
from pathlib import Path

import pytest

from transit_ops.settings import (
    LEGACY_DATABASE_URL_KEY,
    LEGACY_DATABASE_URL_MESSAGE,
    Settings,
)

EXPECTED_RETENTION_CONTRACT = {
    "STATIC_DATASET_RETENTION_COUNT": 1,
    "SILVER_REALTIME_RETENTION_DAYS": 14,
    "GOLD_FACT_RETENTION_DAYS": 14,
    "GOLD_REPORTING_OPEN_WINDOW_DAYS": 10,
    "BRONZE_REALTIME_RETENTION_DAYS": 30,
    "BRONZE_STATIC_RETENTION_DAYS": 365,
    "GOLD_WARM_ROLLUP_RETENTION_DAYS": 365,
}
SETTINGS_DEFAULT_ENV_KEYS = (
    *EXPECTED_RETENTION_CONTRACT,
    "DATABASE_URL",
    "BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH",
    "BRONZE_PRUNE_MAX_BATCHES",
    "BRONZE_I3_RETENTION_DAYS",
    "SILVER_I3_CLOSED_RETENTION_DAYS",
)


@pytest.fixture
def clean_default_settings_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in SETTINGS_DEFAULT_ENV_KEYS:
        monkeypatch.delenv(key, raising=False)


def retention_contract_from_settings(settings: Settings) -> dict[str, int]:
    return {key: getattr(settings, key) for key in EXPECTED_RETENTION_CONTRACT}


def retention_contract_from_display(display: dict[str, object]) -> dict[str, object]:
    return {key: display[key] for key in EXPECTED_RETENTION_CONTRACT}


def test_settings_defaults(clean_default_settings_env: None) -> None:
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
    assert settings.STM_GIS_URL is None
    assert retention_contract_from_settings(settings) == EXPECTED_RETENTION_CONTRACT
    assert settings.HEALTH_DATABASE_TIMEOUT_SECONDS == 5.0
    assert settings.HEALTH_FEED_TIMEOUT_SECONDS == 10.0
    assert settings.HEALTH_MAX_PIPELINE_AGE_SECONDS == 900
    assert settings.DATABASE_URL is None


def test_retention_defaults_lock_clean_reporting_contract(
    clean_default_settings_env: None,
) -> None:
    settings = Settings(_env_file=None)

    assert retention_contract_from_settings(settings) == EXPECTED_RETENTION_CONTRACT


def test_reporting_open_window_default_inside_fact_retention(
    clean_default_settings_env: None,
) -> None:
    settings = Settings(_env_file=None)

    assert settings.GOLD_REPORTING_OPEN_WINDOW_DAYS == 10
    assert 0 < settings.GOLD_REPORTING_OPEN_WINDOW_DAYS < settings.GOLD_FACT_RETENTION_DAYS


def test_bronze_prune_batch_knobs_default_and_display(
    clean_default_settings_env: None,
) -> None:
    settings = Settings(_env_file=None)

    assert settings.BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH == 5000
    assert settings.BRONZE_PRUNE_MAX_BATCHES == 1

    display = settings.display_dict()

    assert display["BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH"] == 5000
    assert display["BRONZE_PRUNE_MAX_BATCHES"] == 1


def test_i3_retention_defaults(clean_default_settings_env: None) -> None:
    settings = Settings(_env_file=None)

    assert settings.BRONZE_I3_RETENTION_DAYS == 30
    assert settings.SILVER_I3_CLOSED_RETENTION_DAYS == 90


def test_display_dict_includes_i3_retention_keys(
    clean_default_settings_env: None,
) -> None:
    display = Settings(_env_file=None).display_dict()

    assert display["BRONZE_I3_RETENTION_DAYS"] == 30
    assert display["SILVER_I3_CLOSED_RETENTION_DAYS"] == 90


def test_health_settings_are_exposed_in_display_dict() -> None:
    settings = Settings(_env_file=None)

    display = settings.display_dict()

    assert display["HEALTH_DATABASE_TIMEOUT_SECONDS"] == 5.0
    assert display["HEALTH_FEED_TIMEOUT_SECONDS"] == 10.0
    assert display["HEALTH_MAX_PIPELINE_AGE_SECONDS"] == 900


def test_retention_static_gis_settings_are_exposed_in_display_dict(
    clean_default_settings_env: None,
) -> None:
    settings = Settings(
        _env_file=None,
        STM_GIS_URL="https://example.com/stm_sig.zip",
    )

    display = settings.display_dict()

    assert display["STM_GIS_URL"] == "https://example.com/stm_sig.zip"
    assert "STM_STATIC_GTFS_CURRENT_FALLBACK_URL" not in display
    assert retention_contract_from_display(display) == EXPECTED_RETENTION_CONTRACT


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


EXPECTED_BACKUP_DEFAULTS = {
    "BACKUP_S3_PREFIX": "backups/postgres",
    "BACKUP_RETENTION_COUNT": 14,
    "BACKUP_EXCLUDE_TABLE_DATA": "silver.rt_trip_update_stop_times",
    "BACKUP_COMPRESSION": "zstd:3",
}


@pytest.fixture
def clean_backup_settings_env(monkeypatch: pytest.MonkeyPatch) -> None:
    for key in EXPECTED_BACKUP_DEFAULTS:
        monkeypatch.delenv(key, raising=False)


def test_settings_backup_defaults(clean_backup_settings_env: None) -> None:
    settings = Settings(_env_file=None)

    assert settings.BACKUP_S3_PREFIX == "backups/postgres"
    assert settings.BACKUP_RETENTION_COUNT == 14
    assert settings.BACKUP_EXCLUDE_TABLE_DATA == "silver.rt_trip_update_stop_times"
    assert settings.BACKUP_COMPRESSION == "zstd:3"

    display = settings.display_dict()
    for key, expected in EXPECTED_BACKUP_DEFAULTS.items():
        assert display[key] == expected


def test_backup_exclude_tables_filters_blanks() -> None:
    empty = Settings(_env_file=None, BACKUP_EXCLUDE_TABLE_DATA="")
    assert empty.backup_exclude_tables == []

    messy = Settings(_env_file=None, BACKUP_EXCLUDE_TABLE_DATA=" a.b , ,c.d ")
    assert messy.backup_exclude_tables == ["a.b", "c.d"]
