from transit_ops.settings import Settings


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
    assert settings.REALTIME_POLL_SECONDS == 300
    assert settings.REALTIME_STARTUP_DELAY_SECONDS == 0
    assert settings.STATIC_DATASET_RETENTION_COUNT == 1
    assert settings.SILVER_REALTIME_RETENTION_DAYS == 2
    assert settings.NEON_DATABASE_URL is None


def test_sqlalchemy_database_url_conversion() -> None:
    settings = Settings(
        _env_file=None,
        NEON_DATABASE_URL="postgresql://user:pass@example.com/dbname?sslmode=require",
    )

    assert settings.sqlalchemy_database_url == (
        "postgresql+psycopg://user:pass@example.com/dbname?sslmode=require"
    )


def test_redacted_database_url_hides_credentials() -> None:
    settings = Settings(
        _env_file=None,
        NEON_DATABASE_URL="postgresql://user:pass@example.com:5432/dbname?sslmode=require",
    )

    assert settings.redacted_database_url == "postgresql://example.com:5432/dbname?sslmode=require"
