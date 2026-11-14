import hashlib
import json
import struct
from decimal import Decimal

import duckdb
import pytest

from transit_ops.lake.csv_validation import InvalidCsvValue
from transit_ops.lake.parquet_codec import (
    CsvHeaderMismatch,
    RequiredValueMissing,
    connect,
    read_canonical_csv,
    write_window,
)
from transit_ops.lake.table_schema import TableSchema


def write(tmp_path, data=b'id,value\n1,\n2,""\n', types=("integer", "text"), **kwargs):
    source = tmp_path / "input.csv"
    source.write_bytes(data)
    schema = TableSchema.from_columns([("id", types[0], True), ("value", types[1], False)], ["id"])
    return write_window(source, schema, tmp_path / "out.parquet", temp_dir=tmp_path, **kwargs)


def rows(window):
    with duckdb.connect() as connection:
        return connection.read_parquet(str(window.path), hive_partitioning=False).fetchall()


def test_written_file_has_the_schema_names_and_types(tmp_path):
    window = write(tmp_path, metadata={})
    with duckdb.connect() as connection:
        description = connection.execute(
            "DESCRIBE SELECT * FROM read_parquet(?)", [str(window.path)]
        ).fetchall()
    assert [row[:2] for row in description] == [("id", "INTEGER"), ("value", "VARCHAR")]


def test_null_and_empty_string_stay_distinct(tmp_path):
    assert rows(write(tmp_path, metadata={})) == [(1, None), (2, "")]


def test_rows_keep_the_csv_order(tmp_path):
    window = write(tmp_path, b"id,value\nb,x\na,y\nB,z\n", ("text", "text"), metadata={})
    assert rows(window) == [("b", "x"), ("a", "y"), ("B", "z")]


def test_timestamptz_keeps_microseconds_and_offset(tmp_path):
    window = write(
        tmp_path,
        b"id,value\n1,2026-11-01 04:32:15.118375+00\n2,2026-11-01 00:02:15.000001-04\n",
        ("integer", "timestamp with time zone"),
        metadata={},
    )
    with duckdb.connect() as connection:
        actual = connection.execute(
            "SELECT epoch_us(value) FROM read_parquet(?)", [str(window.path)]
        ).fetchall()
    assert actual == [(1793507535118375,), (1793505735000001,)]


@pytest.mark.parametrize(
    "literal,expected",
    [("0.1", 0.1), ("-0", -0.0), ("1.7976931348623157e+308", 1.7976931348623157e308)],
)
def test_doubles_keep_their_bits(tmp_path, literal, expected):
    window = write(
        tmp_path, f"id,value\n1,{literal}\n".encode(), ("integer", "double precision"), metadata={}
    )
    assert struct.pack(">d", rows(window)[0][1]) == struct.pack(">d", expected)


@pytest.mark.parametrize(
    "pg_type,literal,expected",
    [
        ("numeric(12,2)", "1.50", Decimal("1.50")),
        ("numeric", "1.50", "1.50"),
        ("smallint[]", '"{1,NULL,3}"', "{1,NULL,3}"),
        ("jsonb", '"{""a"": 1}"', '{"a": 1}'),
    ],
)
def test_decimals_and_postgres_text_are_exact(tmp_path, pg_type, literal, expected):
    window = write(tmp_path, f"id,value\n1,{literal}\n".encode(), ("integer", pg_type), metadata={})
    assert rows(window) == [(1, expected)]


@pytest.mark.parametrize("data", [b"value,id\nx,1\n", b"id\n1\n", b"id,value\r\n1,x\r\n"])
def test_header_mismatch_is_refused(tmp_path, data):
    with pytest.raises(CsvHeaderMismatch):
        write(tmp_path, data, metadata={})
    assert not (tmp_path / "out.parquet").exists()


def test_null_in_required_column_is_refused_and_no_file_is_left(tmp_path):
    with pytest.raises(RequiredValueMissing, match="id"):
        write(tmp_path, b"id,value\n,x\n", metadata={})
    assert not (tmp_path / "out.parquet").exists()


def test_content_digest_is_the_sha256_of_the_csv_bytes(tmp_path):
    data = b"id,value\n1,hello\n"
    window = write(tmp_path, data, metadata={})
    assert (window.content_sha256, window.content_bytes) == (
        hashlib.sha256(data).hexdigest(),
        len(data),
    )
    assert (window.sha256, window.byte_size, window.rows) == (
        hashlib.sha256(window.path.read_bytes()).hexdigest(),
        window.path.stat().st_size,
        1,
    )


def test_same_input_gives_the_same_parquet_bytes(tmp_path):
    first = write(tmp_path, metadata={"z": "last", "a": "first"})
    second = write_window(
        tmp_path / "input.csv",
        first.schema,
        tmp_path / "other.parquet",
        temp_dir=tmp_path,
        metadata={"a": "first", "z": "last"},
    )
    assert first.path.read_bytes() == second.path.read_bytes()


def test_key_value_metadata_records_schema_digest_and_codec(tmp_path):
    window = write(tmp_path, metadata={"owner": "a'b"})
    with duckdb.connect() as connection:
        metadata = dict(
            connection.execute(
                "SELECT key, value FROM parquet_kv_metadata(?)", [str(window.path)]
            ).fetchall()
        )
    assert metadata[b"owner"] == b"a'b"
    assert metadata[b"transit.schema"] == window.schema.to_json()
    assert metadata[b"transit.content_sha256"].decode() == window.content_sha256
    assert metadata[b"transit.rows"] == b"2"
    codec = {"compression": "zstd", "level": 9, "row_group_rows": 122880}
    assert json.loads(metadata[b"transit.codec"]) == codec
    assert window.details() == {
        "codec": "parquet",
        "codec_params": codec,
        "writer": "duckdb",
        "writer_version": duckdb.__version__,
        "schema_sha256": window.schema.columns_sha256(),
        "content_digest": "canonical_csv_sha256",
    }


def test_caller_metadata_cannot_use_the_transit_prefix(tmp_path):
    with pytest.raises(ValueError, match="transit"):
        write(tmp_path, metadata={"transit.rows": "99"})
    assert not (tmp_path / "out.parquet").exists()


def test_existing_output_path_is_refused(tmp_path):
    target = tmp_path / "out.parquet"
    target.write_bytes(b"keep")
    with pytest.raises(FileExistsError):
        write(tmp_path, metadata={})
    assert target.read_bytes() == b"keep"


def test_public_csv_reader_preserves_absence(tmp_path):
    window = write(tmp_path, metadata={})
    with connect(tmp_path) as connection:
        assert read_canonical_csv(connection, tmp_path / "input.csv", window.schema).fetchall() == [
            (1, None),
            (2, ""),
        ]


def test_header_only_window_retains_schema_and_zero_rows(tmp_path):
    window = write(tmp_path, b"id,value\n", metadata={})
    assert window.rows == 0
    assert rows(window) == []


@pytest.mark.parametrize("data", [b"id,value\nwrong,x\n", b"id,value\n1,x,extra\n"])
def test_invalid_csv_is_refused_without_leaving_output(tmp_path, data):
    with pytest.raises(InvalidCsvValue):
        write(tmp_path, data, metadata={})
    assert not (tmp_path / "out.parquet").exists()


def test_connection_pins_utc_and_disables_extension_loading(tmp_path):
    with connect(tmp_path) as connection:
        actual = connection.execute(
            "SELECT current_setting('TimeZone'), current_setting('threads'), "
            "current_setting('preserve_insertion_order'), "
            "current_setting('autoinstall_known_extensions'), "
            "current_setting('autoload_known_extensions')"
        ).fetchone()
    assert actual == ("UTC", 1, True, False, False)


@pytest.mark.parametrize("side", ["input", "output"])
@pytest.mark.parametrize("character", list("*?[]{}"))
def test_review_glob_paths_are_refused_by_name(tmp_path, side, character):
    window = write(tmp_path, metadata={})
    source = tmp_path / (f"input{character}1.csv" if side == "input" else "input.csv")
    target = tmp_path / ("other.parquet" if side == "input" else f"out{character}1.parquet")
    with pytest.raises(ValueError) as error:
        write_window(source, window.schema, target, metadata={}, temp_dir=tmp_path)
    assert str(source if side == "input" else target) in str(error.value)


@pytest.mark.parametrize("directory", ["value=wrong", "id=999", "batch=2026", "plain"])
def test_review_hive_and_unrelated_sibling_are_preserved(tmp_path, directory):
    folder = tmp_path / directory
    folder.mkdir()
    sibling = folder / "tmp_out.parquet"
    sibling.write_bytes(b"keep")
    assert rows(write(folder, metadata={})) == [(1, None), (2, "")]
    assert sibling.read_bytes() == b"keep"
