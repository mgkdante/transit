import hashlib
import io
from contextlib import contextmanager
from dataclasses import replace

import duckdb
import pytest

from transit_ops.ingestion.storage import BronzeStorage
from transit_ops.lake.parquet_codec import write_window
from transit_ops.lake.parquet_verify import CopyDiffers, Expected, check_window_files, read_back
from transit_ops.lake.table_schema import TableSchema


def window(tmp_path, data=b'id,value\n1,\n2,""\n', pg_type="text"):
    csv = tmp_path / "input.csv"
    csv.write_bytes(data)
    schema = TableSchema.from_columns([("id", "integer", True), ("value", pg_type, False)], ["id"])
    written = write_window(csv, schema, tmp_path / "out.parquet", metadata={}, temp_dir=tmp_path)
    return csv, written, Expected(hashlib.sha256(data).hexdigest(), written.rows, None)


def test_checks_an_equal_window(tmp_path):
    csv, written, expected = window(tmp_path)
    checks = check_window_files(
        csv, written.path, written.schema, expect=expected, temp_dir=tmp_path
    )
    assert checks.rows == 2
    assert checks.content_sha256 == hashlib.sha256(csv.read_bytes()).hexdigest()
    assert checks.object_sha256 == hashlib.sha256(written.path.read_bytes()).hexdigest()
    assert checks.object_bytes == written.path.stat().st_size
    assert checks.schema_sha256 == written.schema.columns_sha256()
    assert checks.checked_with == duckdb.__version__


def changed_file(tmp_path, written, query="SELECT * FROM original", changes=None):
    target = tmp_path / "changed.parquet"
    with duckdb.connect() as connection:
        metadata = {
            key.decode(): value.decode()
            for key, value in connection.execute(
                "SELECT key, value FROM parquet_kv_metadata(?)", [str(written.path)]
            ).fetchall()
        }
        for key, value in (changes or {}).items():
            if value is None:
                metadata.pop(key)
            else:
                metadata[key] = value
        connection.read_parquet(str(written.path), hive_partitioning=False).create_view("original")
        connection.execute(
            f"COPY ({query}) TO ? (FORMAT parquet, KV_METADATA ?)", [str(target), metadata]
        )
    return target


@pytest.mark.parametrize("side", ["content", "object"])
def test_refuses_incorrect_digests_in_order(tmp_path, side):
    csv, written, expected = window(tmp_path)
    expected = replace(expected, object_sha256="0" * 64)
    if side == "content":
        csv.write_bytes(b"different")
    with pytest.raises(CopyDiffers) as error:
        check_window_files(csv, written.path, written.schema, expect=expected, temp_dir=tmp_path)
    assert error.value.reason == f"{side}_digest"


@pytest.mark.parametrize("key", ["transit.schema", "transit.content_sha256", "transit.rows"])
@pytest.mark.parametrize("value", [None, "wrong"])
def test_refuses_missing_or_changed_metadata(tmp_path, key, value):
    csv, written, expected = window(tmp_path)
    target = changed_file(tmp_path, written, changes={key: value})
    with pytest.raises(CopyDiffers) as error:
        check_window_files(csv, target, written.schema, expect=expected, temp_dir=tmp_path)
    assert error.value.reason == "metadata"
    assert key in error.value.detail


@pytest.mark.parametrize(
    "query",
    [
        "SELECT id::BIGINT AS id, value FROM original",
        "SELECT value, id FROM original",
        "SELECT id AS other, value FROM original",
        "SELECT id FROM original",
        "SELECT *, 1 AS extra FROM original",
    ],
)
def test_refuses_changed_types_names_and_order(tmp_path, query):
    csv, written, expected = window(tmp_path)
    target = changed_file(tmp_path, written, query)
    with pytest.raises(CopyDiffers) as error:
        check_window_files(csv, target, written.schema, expect=expected, temp_dir=tmp_path)
    assert error.value.reason == "types"


@pytest.mark.parametrize("side", ["CSV", "Parquet"])
def test_checks_both_row_counts(tmp_path, side):
    csv, written, expected = window(tmp_path)
    if side == "CSV":
        csv.write_bytes(b"id,value\n1,x\n")
        expected = replace(expected, content_sha256=hashlib.sha256(csv.read_bytes()).hexdigest())
        target = changed_file(
            tmp_path,
            written,
            changes={
                "transit.content_sha256": expected.content_sha256,
            },
        )
    else:
        target = changed_file(tmp_path, written, "SELECT * FROM original WHERE id=1")
    with pytest.raises(CopyDiffers) as error:
        check_window_files(csv, target, written.schema, expect=expected, temp_dir=tmp_path)
    assert error.value.reason == "rows"
    assert error.value.detail == f"{side} has 1 rows; expected 2"


@pytest.mark.parametrize(
    "pg_type,value",
    [
        ("timestamp with time zone", "2026-11-01 00:00:00+00"),
        ("numeric(12,2)", "1.50"),
        ("numeric", "1.50"),
        ("uuid", "00000000-0000-0000-0000-000000000001"),
    ],
)
def test_accepts_the_declared_types_including_aliases(tmp_path, pg_type, value):
    csv, written, expected = window(tmp_path, f"id,value\n1,{value}\n".encode(), pg_type)
    expected = replace(expected, object_sha256=written.sha256)
    assert (
        check_window_files(
            csv, written.path, written.schema, expect=expected, temp_dir=tmp_path
        ).rows
        == 1
    )


def test_accepts_an_empty_window_in_a_hive_named_directory(tmp_path):
    folder = tmp_path / "id=999"
    folder.mkdir()
    csv, written, expected = window(folder, b"id,value\n")
    assert (
        check_window_files(csv, written.path, written.schema, expect=expected, temp_dir=folder).rows
        == 0
    )


@pytest.mark.parametrize("side", ["csv", "parquet", "temp"])
@pytest.mark.parametrize("character", list("*?[]{}"))
def test_refuses_globs_by_name(tmp_path, side, character):
    csv, written, expected = window(tmp_path)
    paths = {"csv": csv, "parquet": written.path, "temp": tmp_path}
    paths[side] = tmp_path / f"bad{character}path"
    with pytest.raises(ValueError, match="Glob") as error:
        check_window_files(
            paths["csv"], paths["parquet"], written.schema, expect=expected, temp_dir=paths["temp"]
        )
    assert str(paths[side]) in str(error.value)


class StreamingStorage(BronzeStorage):
    @contextmanager
    def open_stream(self, key, **kwargs):
        assert key == "object"

        class Stream(io.BytesIO):
            def read(self, size=-1):
                assert 0 < size <= 64 * 1024
                assert not destination.exists()
                chunk = super().read(size)
                if failure and self.tell() > 64 * 1024:
                    raise OSError("interrupted")
                return chunk

        destination, failure = self.destination, self.failure
        with Stream(b"abc" * 50_000) as stream:
            yield stream


@pytest.mark.parametrize("failure", [False, True])
def test_read_back_streams_and_leaves_no_partial_final_file(tmp_path, failure):
    destination = tmp_path / "download.parquet"
    storage = StreamingStorage("test")
    object.__setattr__(storage, "destination", destination)
    object.__setattr__(storage, "failure", failure)
    if failure:
        with pytest.raises(OSError, match="interrupted"):
            read_back(storage, "object", destination)
        assert not destination.exists()
    else:
        assert read_back(storage, "object", destination) == (
            hashlib.sha256(b"abc" * 50_000).hexdigest(),
            150_000,
        )
        assert destination.read_bytes() == b"abc" * 50_000
        with pytest.raises(FileExistsError):
            read_back(storage, "object", destination)
        assert destination.read_bytes() == b"abc" * 50_000
    assert set(tmp_path.iterdir()) == ({destination} if not failure else set())
