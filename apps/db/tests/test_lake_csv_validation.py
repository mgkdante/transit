from decimal import Decimal

import duckdb
import pytest

from transit_ops.lake.csv_validation import InvalidCsvValue
from transit_ops.lake.parquet_codec import connect, read_canonical_csv, write_window
from transit_ops.lake.table_schema import TableSchema


def schema(pg_type="text"):
    return TableSchema.from_columns([("id", "integer", True), ("value", pg_type, False)], ["id"])


def write(tmp_path, body, pg_type="text"):
    source = tmp_path / "input.csv"
    source.write_bytes(b"id,value\n" + body)
    return write_window(
        source, schema(pg_type), tmp_path / "out.parquet", metadata={}, temp_dir=tmp_path
    )


@pytest.mark.parametrize(
    "pg_type,token",
    [
        *(
            (kind, value)
            for kind in ("smallint", "integer", "bigint")
            for value in ("1.5", "1e3", "1_000", " 5", "+5", "bad")
        ),
        ("date", "0001-01-01 BC"),
        ("timestamp without time zone", "0001-01-01 00:00:00 BC"),
        ("timestamp with time zone", "0001-01-01 00:00:00+00 BC"),
        ("timestamp without time zone", "294276-12-31 23:59:59.999999"),
        ("timestamp with time zone", "294276-12-31 23:59:59.999999+00"),
        *(("numeric(12,2)", value) for value in ("NaN", "Infinity", "-Infinity")),
        ("integer", "2147483648"),
        ("boolean", "nonsense"),
        ("date", "2026-02-30"),
    ],
)
def test_changed_or_unrepresentable_value_is_named(tmp_path, pg_type, token):
    with pytest.raises(InvalidCsvValue) as caught:
        write(tmp_path, f"1,{token}\n".encode(), pg_type)
    error = caught.value
    assert (error.column, error.row, error.value) == ("value", 2, token)
    assert "value" in str(error) and "2" in str(error) and repr(token) in str(error)
    assert not (tmp_path / "out.parquet").exists()


@pytest.mark.parametrize("body,value", [(b"1,x,\n", ("1", "x", "")), (b"1\n", ("1",)), (b"\n", ())])
def test_malformed_record_is_named(tmp_path, body, value):
    with pytest.raises(InvalidCsvValue) as caught:
        write(tmp_path, body)
    assert (caught.value.column, caught.value.row, caught.value.value) == ("<record>", 2, value)
    assert not (tmp_path / "out.parquet").exists()


def test_later_blank_record_is_not_dropped(tmp_path):
    with pytest.raises(InvalidCsvValue) as caught:
        write(tmp_path, b"1,x\n\n2,y\n")
    assert caught.value.row == 3


def test_shared_reader_validates_before_returning(tmp_path):
    source = tmp_path / "input.csv"
    source.write_bytes(b"id,value\n1,1.5\n")
    with connect(tmp_path) as connection, pytest.raises(InvalidCsvValue) as caught:
        read_canonical_csv(connection, source, schema("integer"))
    assert (caught.value.column, caught.value.row, caught.value.value) == ("value", 2, "1.5")


@pytest.mark.parametrize(
    "body,pg_type,expected",
    [
        (b'1,\n2,""\n3,"a\n\nb"\n', "text", [(1, None), (2, ""), (3, "a\n\nb")]),
        (b"1,-32768\n2,32767\n", "smallint", [(1, -32768), (2, 32767)]),
        (b"1,1.50\n", "numeric(12,2)", [(1, Decimal("1.50"))]),
        (b"1,NaN\n2,Infinity\n", "numeric", [(1, "NaN"), (2, "Infinity")]),
    ],
)
def test_valid_values_and_quoted_newlines_survive(tmp_path, body, pg_type, expected):
    window = write(tmp_path, body, pg_type)
    with connect(tmp_path) as connection:
        assert (
            connection.read_parquet(str(window.path), hive_partitioning=False).fetchall()
            == expected
        )


def test_quoted_empty_integer_is_not_null(tmp_path):
    with pytest.raises(InvalidCsvValue) as caught:
        write(tmp_path, b'1,""\n', "integer")
    assert (caught.value.column, caught.value.row, caught.value.value) == ("value", 2, "")


def test_conversion_error_after_batch_boundary_is_named(tmp_path):
    body = b"1,2\n" * 4096 + b"2,bad\n"
    with pytest.raises(InvalidCsvValue) as caught:
        write(tmp_path, body, "integer")
    assert (caught.value.column, caught.value.row, caught.value.value) == ("value", 4098, "bad")


def test_bad_quote_has_one_public_error_type(tmp_path):
    with pytest.raises(InvalidCsvValue) as caught:
        write(tmp_path, b'1,"unfinished\n')
    assert caught.value.column == "<record>" and caught.value.row == 2


def test_duckdb_error_is_wrapped(tmp_path):
    source = tmp_path / "input.csv"
    source.write_bytes(b"id,value\n1,x\n")
    connection = connect(tmp_path)
    connection.close()
    with pytest.raises(InvalidCsvValue) as caught:
        read_canonical_csv(connection, source, schema())
    assert isinstance(caught.value.__cause__, duckdb.Error)
    assert caught.value.row == 2 and "closed" in str(caught.value.value)


def test_long_postgres_text_is_not_rejected_by_parser_default(tmp_path):
    text = "x" * 200000
    window = write(tmp_path, f"1,{text}\n".encode())
    with connect(tmp_path) as connection:
        assert connection.read_parquet(str(window.path), hive_partitioning=False).fetchall() == [
            (1, text)
        ]


@pytest.mark.parametrize("entry", ["reader", "writer"])
@pytest.mark.parametrize("quoted", [False, True])
def test_leading_bom_in_first_data_field_is_refused_by_name(tmp_path, entry, quoted):
    table = TableSchema.from_columns([("id", "text", True), ("value", "text", False)], ["id"])
    token = "\ufeffkey"
    field = f'"{token}"' if quoted else token
    source, target = tmp_path / "input.csv", tmp_path / "out.parquet"
    source.write_bytes(f"id,value\n{field},x\n".encode())
    with pytest.raises(InvalidCsvValue) as caught:
        if entry == "writer":
            write_window(source, table, target, metadata={}, temp_dir=tmp_path)
        else:
            with connect(tmp_path) as connection:
                read_canonical_csv(connection, source, table)
    assert (caught.value.column, caught.value.row, caught.value.value) == ("id", 2, token)
    assert not target.exists()


def test_bom_in_later_field_or_record_is_preserved(tmp_path):
    source = tmp_path / "input.csv"
    source.write_bytes("id,value\nkey,\ufefftext\n\ufefflater,within\ufefftext\n".encode())
    table = TableSchema.from_columns([("id", "text", True), ("value", "text", False)], ["id"])
    window = write_window(source, table, tmp_path / "out.parquet", metadata={}, temp_dir=tmp_path)
    with connect(tmp_path) as connection:
        assert connection.read_parquet(str(window.path), hive_partitioning=False).fetchall() == [
            ("key", "\ufefftext"),
            ("\ufefflater", "within\ufefftext"),
        ]
