from __future__ import annotations

from io import BytesIO
from pathlib import Path

import pytest
from botocore.exceptions import ClientError

from transit_ops.ingestion.storage import (
    BronzeStorageError,
    LocalBronzeStorage,
    S3BronzeStorage,
    build_s3_client,
    get_bronze_storage,
)
from transit_ops.settings import Settings


class FakeS3Client:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.upload_calls: list[tuple[str, str]] = []

    def upload_fileobj(self, fileobj, bucket: str, key: str) -> None:  # noqa: ANN001
        self.upload_calls.append((bucket, key))
        self.objects[(bucket, key)] = fileobj.read()

    def head_object(self, Bucket: str, Key: str) -> None:  # noqa: N803
        if (Bucket, Key) not in self.objects:
            raise ClientError(
                {"Error": {"Code": "404", "Message": "Not Found"}},
                "HeadObject",
            )

    def get_object(self, Bucket: str, Key: str) -> dict[str, BytesIO]:  # noqa: N803
        return {"Body": BytesIO(self.objects[(Bucket, Key)])}


def test_get_bronze_storage_selects_local_backend(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT="./bronze",
    )

    storage = get_bronze_storage(settings, project_root=tmp_path)

    assert isinstance(storage, LocalBronzeStorage)
    assert storage.root == tmp_path / "bronze"


def test_get_bronze_storage_selects_s3_backend(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )
    fake_client = FakeS3Client()

    storage = get_bronze_storage(
        settings,
        project_root=tmp_path,
        s3_client=fake_client,
    )

    assert isinstance(storage, S3BronzeStorage)
    assert storage.bucket == "bronze-bucket"
    assert storage.endpoint_url == "https://example.r2.cloudflarestorage.com"
    assert storage.describe_location("stm/trip_updates/sample.pb") == (
        "s3://bronze-bucket/stm/trip_updates/sample.pb"
    )


def test_local_bronze_storage_persists_and_reads_bytes(tmp_path: Path) -> None:
    storage = LocalBronzeStorage(storage_backend="local", root=tmp_path / "bronze")
    temp_path = tmp_path / "download.pb"
    temp_path.write_bytes(b"snapshot-bytes")
    storage_path = "stm/trip_updates/captured_at_utc=2026-03-25/sample.pb"

    archive_reference = storage.persist_temp_file(temp_path, storage_path)

    assert temp_path.exists() is False
    assert archive_reference == str(tmp_path / "bronze" / Path(storage_path))
    assert storage.exists(storage_path) is True
    assert storage.read_bytes(storage_path) == b"snapshot-bytes"


def test_s3_bronze_storage_persists_and_reads_bytes(tmp_path: Path) -> None:
    fake_client = FakeS3Client()
    storage = S3BronzeStorage(
        storage_backend="s3",
        bucket="bronze-bucket",
        endpoint_url="https://example.r2.cloudflarestorage.com",
        client=fake_client,
    )
    temp_path = tmp_path / "download.zip"
    temp_path.write_bytes(b"static-zip-bytes")
    storage_path = "stm/static_schedule/ingested_at_utc=2026-03-25/sample.zip"

    archive_reference = storage.persist_temp_file(temp_path, storage_path)

    assert temp_path.exists() is False
    assert archive_reference == "s3://bronze-bucket/stm/static_schedule/ingested_at_utc=2026-03-25/sample.zip"
    assert fake_client.upload_calls == [("bronze-bucket", storage_path)]
    assert storage.exists(storage_path) is True
    assert storage.read_bytes(storage_path) == b"static-zip-bytes"


def test_get_bronze_storage_requires_s3_configuration(tmp_path: Path) -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_BUCKET="bronze-bucket",
    )

    with pytest.raises(BronzeStorageError, match="S3-compatible Bronze storage requires"):
        get_bronze_storage(settings, project_root=tmp_path)


def test_build_s3_client_rejects_bucket_in_endpoint_path() -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com/transit-raw",
        BRONZE_S3_BUCKET="transit-raw",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )

    with pytest.raises(BronzeStorageError, match="account-level endpoint only"):
        build_s3_client(settings)


def test_build_s3_client_rejects_bucket_with_path_segments() -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="transit-raw/extra",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )

    with pytest.raises(BronzeStorageError, match="must be only the bucket name"):
        get_bronze_storage(settings, project_root=Path.cwd(), s3_client=FakeS3Client())


def test_build_s3_client_uses_r2_friendly_config() -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com/",
        BRONZE_S3_BUCKET="transit-raw",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )

    client = build_s3_client(settings)

    assert client.meta.endpoint_url == "https://example.r2.cloudflarestorage.com"
    assert client.meta.region_name == "auto"
    assert client.meta.config.signature_version == "s3v4"
    assert client.meta.config.s3 == {"addressing_style": "path"}
