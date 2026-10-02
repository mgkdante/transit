from __future__ import annotations

from datetime import datetime
from pathlib import Path

from transit_ops.ingestion.common import DownloadedArtifact, compute_sha256_hex
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings


class FakeResult:
    def __init__(
        self,
        scalar_value: int | None = None,
        mapping_value: dict[str, object] | None = None,
    ) -> None:
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value

    def scalar_one(self) -> int:
        if self.scalar_value is None:
            raise AssertionError("Expected a scalar value.")
        return self.scalar_value

    def scalar_one_or_none(self) -> int | None:
        return self.scalar_value

    def mappings(self) -> FakeResult:
        return self

    def one_or_none(self) -> dict[str, object] | None:
        return self.mapping_value


class RecordingConnection:
    def __init__(
        self,
        *,
        feed_endpoint_id: int = 11,
        current_dataset_checksum: str | None = None,
        current_dataset_version_id: int | None = None,
        inserted_dataset_version_id: int = 303,
        dataset_window: dict[str, datetime] | None = None,
    ) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.feed_endpoint_id = feed_endpoint_id
        self.current_dataset_checksum = current_dataset_checksum
        self.current_dataset_version_id = current_dataset_version_id
        self.inserted_dataset_version_id = inserted_dataset_version_id
        self.dataset_window = dataset_window

    def execute(self, statement, params: dict[str, object]) -> FakeResult:  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT feed_endpoint_id" in sql_text:
            return FakeResult(self.feed_endpoint_id)
        if "SELECT" in sql_text and "first_seen_at_utc" in sql_text:
            return FakeResult(mapping_value=self.dataset_window)
        if "SELECT" in sql_text and "core.dataset_versions" in sql_text:
            if self.current_dataset_checksum is None or self.current_dataset_version_id is None:
                return FakeResult(mapping_value=None)
            return FakeResult(
                mapping_value={
                    "dataset_version_id": self.current_dataset_version_id,
                    "checksum_sha256": self.current_dataset_checksum,
                }
            )
        if "RETURNING ingestion_run_id" in sql_text:
            return FakeResult(101)
        if "RETURNING dataset_version_id" in sql_text:
            return FakeResult(self.inserted_dataset_version_id)
        if "RETURNING ingestion_object_id" in sql_text:
            return FakeResult(202)
        return FakeResult(None)


class _ContextManager:
    def __init__(self, connection: RecordingConnection) -> None:
        self.connection = connection

    def __enter__(self) -> RecordingConnection:
        return self.connection

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False


class FakeEngine:
    def __init__(self, connection: RecordingConnection) -> None:
        self.connection = connection

    def begin(self) -> _ContextManager:
        return _ContextManager(self.connection)


class FakeBronzeStorage:
    def __init__(self, prefix: str) -> None:
        self.prefix = prefix.rstrip("/")
        self.persisted: list[tuple[Path, str]] = []
        self.deleted: list[str] = []
        self.delete_should_raise = False

    def persist_temp_file(self, temp_path: Path, storage_path: str) -> str:
        self.persisted.append((temp_path, storage_path))
        temp_path.unlink(missing_ok=True)
        return f"{self.prefix}/{storage_path}"

    def delete_object(self, storage_path: str) -> None:
        self.deleted.append(storage_path)
        if self.delete_should_raise:
            raise RuntimeError("simulated R2 delete failure")


def prepare_capture(
    tmp_path,
    monkeypatch,
    feed_module,
    *,
    filename,
    payload,
    source_url,
    url_setting,
):
    temp_path = tmp_path / filename
    temp_path.write_bytes(payload)
    artifact = DownloadedArtifact(
        temp_path=temp_path,
        byte_size=len(payload),
        checksum_sha256=compute_sha256_hex(temp_path),
        http_status_code=200,
        source_url=source_url,
    )
    storage = FakeBronzeStorage("s3://bronze-bucket")
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
        **{url_setting: source_url},
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )
    monkeypatch.setattr(feed_module, "_download_to_tempfile", lambda source_url, temp_dir: artifact)
    monkeypatch.setattr(
        feed_module,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: storage,
    )
    return artifact, storage, settings, registry
