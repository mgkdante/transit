import hashlib

import pytest

from transit_ops.lake.table_schema import (
    Column,
    InvalidSchema,
    TableSchema,
    UnsupportedColumnType,
)


def test_columns_digest_equals_rescue_receipt_encoding():
    schema = TableSchema.from_columns(
        [["provider_id", "text", True], ["sequence", "bigint", True], ["été", "text", False]],
        ["provider_id", "sequence"],
    )
    receipt = (
        '[["provider_id","text",true],["sequence","bigint",true],["été","text",false]]'
    ).encode()
    assert schema.columns_sha256() == hashlib.sha256(receipt).hexdigest()
    other_key = TableSchema(schema.columns, ("sequence",))
    assert other_key.columns_sha256() == schema.columns_sha256()
    assert other_key.to_json() != schema.to_json()


@pytest.mark.parametrize(
    ("pg_type", "expected"),
    [
        ("text", "VARCHAR"),
        ("character varying", "VARCHAR"),
        ("character varying(40)", "VARCHAR"),
        ("character(1)", "VARCHAR"),
        ("boolean", "BOOLEAN"),
        ("smallint", "SMALLINT"),
        ("integer", "INTEGER"),
        ("bigint", "BIGINT"),
        ("real", "FLOAT"),
        ("double precision", "DOUBLE"),
        ("numeric(12,2)", "DECIMAL(12,2)"),
        ("numeric(38,18)", "DECIMAL(38,18)"),
        ("numeric(38,38)", "DECIMAL(38,38)"),
        ("numeric(1,0)", "DECIMAL(1,0)"),
        ("numeric", "VARCHAR"),
        ("smallint[]", "VARCHAR"),
        ("text[]", "VARCHAR"),
        ("integer[][]", "VARCHAR"),
        ("json", "VARCHAR"),
        ("jsonb", "VARCHAR"),
        ("date", "DATE"),
        ("timestamp with time zone", "TIMESTAMPTZ"),
        ("timestamp without time zone", "TIMESTAMP"),
        ("uuid", "UUID"),
    ],
)
def test_type_map_is_exact_for_every_supported_type(pg_type, expected):
    schema = TableSchema.from_columns([["z", pg_type, False], ["a", "integer", True]], ["a"])
    assert schema.duckdb_types() == {"z": expected, "a": "INTEGER"}
    assert list(schema.duckdb_types()) == ["z", "a"]


@pytest.mark.parametrize(
    "pg_type",
    [
        "bytea",
        "interval",
        "geometry",
        "money",
        "int",
        "TEXT",
        "numeric(12)",
        "numeric(3,5)",
        "numeric(1,39)",
        "numeric(39,2)",
        "numeric(40,39)",
    ],
)
def test_unsupported_type_is_refused_by_column_name(pg_type):
    schema = TableSchema.from_columns([["payload", pg_type, True]], ["payload"])
    with pytest.raises(UnsupportedColumnType) as error:
        schema.duckdb_types()
    assert "payload" in str(error.value)
    assert pg_type in str(error.value)


@pytest.mark.parametrize(
    ("columns", "key"),
    [
        ([], ["id"]),
        ([["id", "text", True], ["id", "integer", False]], ["id"]),
        ([["id", "text", True]], []),
        ([["id", "text", True]], ["missing"]),
        ([["id", "text"]], ["id"]),
        ([["id", "text", "false"]], ["id"]),
        ([[1, "text", True]], ["id"]),
        ([["id", None, True]], ["id"]),
    ],
)
def test_schema_refuses_duplicate_columns_and_unknown_key_columns(columns, key):
    with pytest.raises(InvalidSchema):
        TableSchema.from_columns(columns, key)


def test_schema_json_round_trips():
    rows = [["z", "text", True], ["a", "bigint", True]]
    key = ["a", "z"]
    schema = TableSchema.from_columns(rows, key)
    canonical = (
        b'{"columns":[["z","text",true],["a","bigint",true]],"format":1,"primary_key":["a","z"]}'
    )
    assert schema.to_json() == canonical
    assert TableSchema.from_json(canonical) == schema
    assert schema.columns == (Column("z", "text", True), Column("a", "bigint", True))
    rows[0][0] = "changed"
    key.clear()
    assert schema.to_json() == canonical
    with pytest.raises(AttributeError):
        schema.primary_key = ("z",)
    with pytest.raises(AttributeError):
        schema.columns[0].name = "changed"


@pytest.mark.parametrize(
    "data",
    [
        b"not json",
        b"[]",
        b"{}",
        b'{"columns":[["id","text",true]],"format":2,"primary_key":["id"]}',
        b'{"columns":[["id","text",true]],"format":true,"primary_key":["id"]}',
        b'{"columns":[["id","text",true]],"format":1,"primary_key":"id"}',
        b'{"columns":[["id","text",true]],"format":1,"primary_key":["missing"]}',
    ],
)
def test_schema_json_refuses_invalid_documents(data):
    with pytest.raises(InvalidSchema):
        TableSchema.from_json(data)


@pytest.mark.parametrize(
    "columns",
    [
        [["other", "text", False], ["a", "integer", True]],
        [["z", "jsonb", False], ["a", "integer", True]],
        [["z", "text", True], ["a", "integer", True]],
        [["a", "integer", True], ["z", "text", False]],
    ],
)
def test_columns_digest_changes_with_name_type_nullability_and_order(columns):
    original = TableSchema.from_columns([["z", "text", False], ["a", "integer", True]], ["a"])
    changed = TableSchema.from_columns(columns, ["a"])
    assert changed.columns_sha256() != original.columns_sha256()


def test_schema_json_normalizes_whitespace_and_object_key_order():
    schema = TableSchema.from_json(
        b'{ "primary_key": ["id"], "format": 1, "columns": [["id", "uuid", true]] }'
    )
    assert schema.to_json() == (b'{"columns":[["id","uuid",true]],"format":1,"primary_key":["id"]}')


@pytest.mark.parametrize(
    ("columns", "key", "name"),
    [
        ([["id", "text", True], ["id", "text", True]], ["id"], "'id'"),
        ([["", "text", True]], [""], "''"),
        ([[17, "text", True]], ["id"], "17"),
        ([["id", "text", True]], ["missing"], "'missing'"),
        ([["id", "text", False]], ["id"], "'id'"),
        ([["bad\ud800", "text", True]], ["bad\ud800"], "'bad\\ud800'"),
        ([["id", "bad\udfff", True]], ["id"], "'id'"),
        ([["id", "text", True]], ["bad\ud800"], "'bad\\ud800'"),
        ([["id", "text", True]], ["id", "id"], "'id'"),
        ([["a", "text", True], ["b", "text", True]], "ab", "'ab'"),
    ],
)
def test_schema_refusals_name_the_invalid_column(columns, key, name):
    with pytest.raises(InvalidSchema) as error:
        TableSchema.from_columns(columns, key)
    assert name in str(error.value)


def test_schema_json_refuses_lone_surrogates_by_column_name():
    with pytest.raises(InvalidSchema) as error:
        TableSchema.from_json(
            b'{"columns":[["bad\\ud800","text",true]],"format":1,"primary_key":["bad\\ud800"]}'
        )
    assert "'bad\\ud800'" in str(error.value)


def test_schema_exposes_postgres_text_columns_in_column_order():
    schema = TableSchema.from_columns(
        [
            ["id", "integer", True],
            ["label", "text", False],
            ["amount", "numeric", False],
            ["array", "smallint[]", False],
            ["document", "json", False],
            ["binary_json", "jsonb", False],
            ["fixed", "numeric(12,2)", False],
            ["bounded", "character varying(40)", False],
            ["character", "character(1)", False],
            ["nested", "text[][]", False],
        ],
        ["id"],
    )
    assert schema.postgres_text_columns == ("amount", "array", "document", "binary_json", "nested")
