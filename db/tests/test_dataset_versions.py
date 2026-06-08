from __future__ import annotations

from datetime import UTC, datetime

import pytest

from transit_ops.ingestion.dataset_versions import register_or_touch_dataset_version


class FakeResult:
    def __init__(
        self,
        *,
        scalar_value: int | None = None,
        mapping_value: dict[str, object] | None = None,
    ) -> None:
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value

    def scalar_one(self) -> int:
        if self.scalar_value is None:
            raise AssertionError("Expected a scalar value.")
        return self.scalar_value

    def mappings(self) -> FakeResult:
        return self

    def one_or_none(self) -> dict[str, object] | None:
        return self.mapping_value


class DatasetVersionConnection:
    def __init__(
        self,
        *,
        current_checksum: str | None = None,
        current_id: int | None = None,
        inserted_id: int = 101,
    ) -> None:
        self.calls: list[tuple[str, dict[str, object]]] = []
        self.current_checksum = current_checksum
        self.current_id = current_id
        self.inserted_id = inserted_id

    def execute(self, statement, params: dict[str, object]) -> FakeResult:  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "SELECT" in sql_text and "dataset_version_id" in sql_text:
            if self.current_checksum is None or self.current_id is None:
                return FakeResult(mapping_value=None)
            return FakeResult(
                mapping_value={
                    "dataset_version_id": self.current_id,
                    "checksum_sha256": self.current_checksum,
                }
            )
        if "RETURNING dataset_version_id" in sql_text:
            return FakeResult(scalar_value=self.inserted_id)
        return FakeResult()


def test_registers_new_current_dataset_version_when_none_exists() -> None:
    connection = DatasetVersionConnection(inserted_id=42)
    observed_at_utc = datetime(2026, 5, 25, tzinfo=UTC)

    result = register_or_touch_dataset_version(
        connection,
        provider_id="stm",
        feed_endpoint_id=2,
        dataset_kind="gis_static",
        checksum_sha256="abc",
        source_url="https://example.test/gis.zip",
        storage_backend="s3",
        storage_path="stm/gis_static/current.zip",
        byte_size=3,
        observed_at_utc=observed_at_utc,
        parser_version="slice-8.4",
        source_ingestion_run_id=101,
    )

    assert result.status == "changed"
    assert result.content_changed is True
    assert result.dataset_version_id == 42
    assert not any("is_current = false" in sql for sql, _ in connection.calls)
    insert_params = next(
        params for sql, params in connection.calls
        if "INSERT INTO core.dataset_versions" in sql
    )
    assert insert_params["dataset_kind"] == "gis_static"
    assert insert_params["checksum_sha256"] == "abc"
    assert insert_params["content_hash"] == "abc"
    assert insert_params["first_seen_at_utc"] == observed_at_utc
    assert insert_params["last_seen_at_utc"] == observed_at_utc
    assert insert_params["observed_from_utc"] == observed_at_utc
    assert insert_params["observed_until_utc"] == observed_at_utc
    assert insert_params["source_ingestion_run_id"] == 101


def test_mark_seen_skips_unchanged_dataset_version() -> None:
    connection = DatasetVersionConnection(current_checksum="abc", current_id=7)
    observed_at_utc = datetime(2026, 5, 25, tzinfo=UTC)

    result = register_or_touch_dataset_version(
        connection,
        provider_id="stm",
        feed_endpoint_id=1,
        dataset_kind="static_schedule",
        checksum_sha256="abc",
        source_url="https://example.test/a.zip",
        storage_backend="s3",
        storage_path="stm/static_schedule/current.zip",
        byte_size=3,
        observed_at_utc=observed_at_utc,
        parser_version="slice-8.4",
        source_ingestion_run_id=101,
    )

    assert result.status == "skipped_unchanged"
    assert result.content_changed is False
    assert result.dataset_version_id == 7
    assert any("last_seen_at_utc" in sql for sql, _ in connection.calls)
    assert any("observed_until_utc" in sql for sql, _ in connection.calls)
    assert not any("INSERT INTO core.dataset_versions" in sql for sql, _ in connection.calls)


def test_new_checksum_closes_previous_version_and_inserts_new_current() -> None:
    connection = DatasetVersionConnection(
        current_checksum="old",
        current_id=7,
        inserted_id=8,
    )
    observed_at_utc = datetime(2026, 5, 25, tzinfo=UTC)

    result = register_or_touch_dataset_version(
        connection,
        provider_id="stm",
        feed_endpoint_id=1,
        dataset_kind="static_schedule",
        checksum_sha256="new",
        source_url="https://example.test/b.zip",
        storage_backend="s3",
        storage_path="stm/static_schedule/new.zip",
        byte_size=3,
        observed_at_utc=observed_at_utc,
        parser_version="slice-8.4",
        source_ingestion_run_id=101,
    )

    assert result.status == "changed"
    assert result.content_changed is True
    assert result.dataset_version_id == 8
    update_params = next(
        params for sql, params in connection.calls
        if "UPDATE core.dataset_versions" in sql and "is_current = false" in sql
    )
    assert update_params["provider_id"] == "stm"
    assert update_params["feed_endpoint_id"] == 1
    assert update_params["dataset_kind"] == "static_schedule"
    assert update_params["observed_until_utc"] == observed_at_utc
    insert_params = next(
        params for sql, params in connection.calls
        if "INSERT INTO core.dataset_versions" in sql
    )
    assert insert_params["checksum_sha256"] == "new"
    assert insert_params["content_hash"] == "new"
    assert insert_params["dataset_kind"] == "static_schedule"


def test_insert_requires_source_ingestion_run_id_before_sql() -> None:
    connection = DatasetVersionConnection()
    observed_at_utc = datetime(2026, 5, 25, tzinfo=UTC)

    with pytest.raises(ValueError, match="source_ingestion_run_id is required"):
        register_or_touch_dataset_version(
            connection,
            provider_id="stm",
            feed_endpoint_id=1,
            dataset_kind="static_schedule",
            checksum_sha256="abc",
            source_url="https://example.test/a.zip",
            storage_backend="s3",
            storage_path="stm/static_schedule/current.zip",
            byte_size=3,
            observed_at_utc=observed_at_utc,
            parser_version="slice-8.4",
        )

    assert connection.calls == []


def test_new_checksum_closes_all_current_versions_for_provider_feed_and_kind() -> None:
    connection = DatasetVersionConnection(
        current_checksum="old",
        current_id=7,
        inserted_id=8,
    )
    observed_at_utc = datetime(2026, 5, 25, tzinfo=UTC)

    register_or_touch_dataset_version(
        connection,
        provider_id="stm",
        feed_endpoint_id=1,
        dataset_kind="static_schedule",
        checksum_sha256="new",
        source_url="https://example.test/b.zip",
        storage_backend="s3",
        storage_path="stm/static_schedule/new.zip",
        byte_size=3,
        observed_at_utc=observed_at_utc,
        parser_version="slice-8.4",
        source_ingestion_run_id=101,
    )

    close_sql, close_params = next(
        (sql, params) for sql, params in connection.calls
        if "UPDATE core.dataset_versions" in sql and "is_current = false" in sql
    )
    assert "dataset_version_id = :dataset_version_id" not in close_sql
    assert "provider_id = :provider_id" in close_sql
    assert "feed_endpoint_id = :feed_endpoint_id" in close_sql
    assert "dataset_kind = :dataset_kind" in close_sql
    assert close_params["provider_id"] == "stm"
    assert close_params["feed_endpoint_id"] == 1
    assert close_params["dataset_kind"] == "static_schedule"
