import boto3
import pytest

from transit_ops.settings import Settings
from transit_ops.snapshots.storage import build_snapshot_storage


@pytest.mark.parametrize("bronze_bucket", [None, "unused/bronze/path"])
def test_snapshot_client_requires_its_own_bucket_only(monkeypatch, bronze_bucket):
    constructed = []
    client = object()

    def create_client(*args, **kwargs):
        constructed.append((args, kwargs))
        return client

    monkeypatch.setattr(boto3, "client", create_client)
    settings = Settings(
        _env_file=None,
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="snapshots",
        SNAPSHOT_PUBLISH_CONCURRENCY=23,
        BRONZE_S3_BUCKET=bronze_bucket,
        BRONZE_S3_ENDPOINT="https://account.example.invalid/",
        BRONZE_S3_ACCESS_KEY="test-access",
        BRONZE_S3_SECRET_KEY="test-secret",
    )
    storage = build_snapshot_storage(settings, provider_id="stm")
    assert storage.full_key("manifest.json") == "v1/stm/manifest.json"
    assert len(constructed) == 1
    args, options = constructed[0]
    assert args == ("s3",)
    assert options["endpoint_url"] == "https://account.example.invalid"
    config = options["config"]
    assert config.max_pool_connections == 23
    assert (config.connect_timeout, config.read_timeout) == (10, 60)
    assert config.retries == {"max_attempts": 3, "mode": "standard"}


@pytest.mark.parametrize("bucket", [" ", "snapshots/path"])
def test_injected_snapshot_client_still_validates_destination_bucket(bucket):
    settings = Settings(_env_file=None, SNAPSHOT_STORAGE_BACKEND="s3", SNAPSHOT_R2_BUCKET=bucket)
    with pytest.raises(ValueError, match="SNAPSHOT_R2_BUCKET"):
        build_snapshot_storage(settings, provider_id="stm", client=object())


def test_snapshot_client_error_identifies_snapshot_target(monkeypatch):
    def unavailable(*args, **kwargs):
        raise ValueError("client unavailable")

    monkeypatch.setattr(boto3, "client", unavailable)
    settings = Settings(
        _env_file=None,
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="snapshots",
        BRONZE_S3_BUCKET="bronze",
        BRONZE_S3_ENDPOINT="https://account.example.invalid",
        BRONZE_S3_ACCESS_KEY="test-access",
        BRONZE_S3_SECRET_KEY="test-secret",
    )
    with pytest.raises(ValueError, match="bucket snapshots") as failure:
        build_snapshot_storage(settings, provider_id="stm")
    assert isinstance(failure.value.__cause__, ValueError)
