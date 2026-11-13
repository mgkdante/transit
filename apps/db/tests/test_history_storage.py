from contextlib import closing
from pathlib import Path
from unittest.mock import Mock

import pytest

import transit_ops
from transit_ops.history.storage import history_storage
from transit_ops.ingestion.storage import LocalBronzeStorage, S3BronzeStorage
from transit_ops.settings import Settings


@pytest.fixture
def s3_builder(monkeypatch):
    client = Mock()
    builder = Mock(return_value=client)
    monkeypatch.setattr("transit_ops.ingestion.storage.build_s3_client", builder)
    return builder


def test_one_scope_resolves_both_backends(tmp_path: Path, s3_builder) -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="s3",
        BRONZE_LOCAL_ROOT=str(tmp_path / "bronze"),
        BRONZE_S3_ENDPOINT="https://example.invalid",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
    )
    with closing(history_storage(settings)) as scope:
        assert s3_builder.call_count == 0
        local = scope.resolve("local")
        assert isinstance(local, LocalBronzeStorage)
        assert local.root == tmp_path / "bronze"
        assert s3_builder.call_count == 0
        remote = scope.resolve("s3")
        assert isinstance(remote, S3BronzeStorage)
        assert remote.bucket == "bronze-bucket"
        assert remote.client is s3_builder.return_value
        assert scope.resolve("local") is local
        assert scope.resolve("s3") is remote
        assert s3_builder.call_count == 1
    assert s3_builder.return_value.close.call_count == 1
    with pytest.raises(RuntimeError, match="closed"):
        scope.resolve("local")


def test_relative_local_root_is_under_the_project_root(s3_builder) -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT="data/bronze",
    )
    with closing(history_storage(settings)) as scope:
        local = scope.resolve("local")
        assert isinstance(local, LocalBronzeStorage)
        assert local.root == Path(transit_ops.__file__).resolve().parents[2] / "data" / "bronze"
    assert s3_builder.call_count == 0


def test_settings_default_to_the_process_settings(tmp_path: Path, monkeypatch, s3_builder) -> None:
    settings = Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT=str(tmp_path / "bronze"),
    )
    monkeypatch.setattr("transit_ops.history.storage.get_settings", lambda: settings)
    with closing(history_storage()) as scope:
        local = scope.resolve("local")
        assert isinstance(local, LocalBronzeStorage)
        assert local.root == tmp_path / "bronze"
    assert s3_builder.call_count == 0
