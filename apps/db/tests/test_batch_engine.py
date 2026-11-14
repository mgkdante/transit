from datetime import UTC, date, datetime

import duckdb
import pytest
from sqlalchemy import TIMESTAMP, Date, Integer, bindparam, text

from transit_ops.batch.engine import (
    BatchEngineError,
    BatchInput,
    InputRefused,
    UnnamedQueryRefused,
    open_batch_session,
)
from transit_ops.sql_registry import named_query


@pytest.mark.parametrize("hour", [5, 6])
def test_session_runs_in_utc_whatever_the_host_zone(tmp_path, hour):
    with open_batch_session([], workdir=tmp_path) as session:
        row = session.execute(
            named_query(
                "batch_test.zone",
                """
            SELECT current_setting('TimeZone'), current_setting('threads'),
                timezone('America/Toronto', CAST(:t AS TIMESTAMPTZ)),
                EXTRACT(HOUR FROM timezone('America/Toronto', CAST(:t AS TIMESTAMPTZ)))
        """,
            ),
            {"t": datetime(2026, 11, 1, hour, 30, tzinfo=UTC)},
        ).fetchall()[0]
        assert tuple(row) == ("UTC", 1, datetime(2026, 11, 1, 1, 30), 1)


def parquet(path, sql="SELECT 7 AS id"):
    path.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect() as conn:
        conn.execute(f"COPY ({sql}) TO ? (FORMAT PARQUET)", [str(path)])
    return path


def test_inputs_are_views_over_parquet_and_other_files_are_refused(tmp_path):
    declared = parquet(tmp_path / "input" / "one.parquet")
    second = parquet(tmp_path / "input" / "second.parquet")
    other = parquet(tmp_path / "other" / "two.parquet")
    with open_batch_session(
        [BatchInput("gold.t", (declared, second))], workdir=tmp_path / "work"
    ) as s:
        result = s.execute(named_query("batch_test.input", "SELECT id FROM gold.t"))
        assert result.columns == ("id",)
        rows = result.fetchall()
        assert [tuple(row) for row in rows] == [(7,), (7,)]
        row = rows[0]
        assert row.id == row[0] == row._mapping["id"] == 7
        with pytest.raises(TypeError):
            row._mapping["id"] = 8
        with pytest.raises(AttributeError):
            row.id = 8
        with pytest.raises(duckdb.PermissionException):
            s.execute(
                named_query("batch_test.other", "SELECT * FROM read_parquet(:p)"), {"p": str(other)}
            )
        with pytest.raises(duckdb.InvalidInputException):
            s.execute(named_query("batch_test.set", "SET threads=2"))


@pytest.mark.parametrize(
    "case",
    ["relative", "missing", "bare", "invalid", "duplicate", "empty", "same_file", "reserved"],
)
def test_bad_inputs_are_refused(tmp_path, case):
    path = parquet(tmp_path / "input.parquet")
    inputs = {
        "relative": [BatchInput("gold.t", (path.relative_to(tmp_path),))],
        "missing": [BatchInput("gold.t", (tmp_path / "missing",))],
        "bare": [BatchInput("t", (path,))],
        "invalid": [BatchInput("gold.T;drop", (path,))],
        "duplicate": [BatchInput("gold.t", (path,))] * 2,
        "empty": [BatchInput("gold.t", ())],
        "same_file": [BatchInput("gold.t", (path, path))],
        "reserved": [BatchInput("pg_catalog.t", (path,))],
    }[case]
    with pytest.raises(InputRefused), open_batch_session(inputs, workdir=tmp_path):
        pytest.fail("invalid input accepted")
    with open_batch_session([], workdir=tmp_path) as s:
        assert s.execute(named_query("batch_test.reopen", "SELECT 1")).fetchall()[0][0] == 1


def test_unnamed_sql_is_refused(tmp_path):
    with open_batch_session([], workdir=tmp_path) as s:
        with pytest.raises(UnnamedQueryRefused):
            s.execute(text("SELECT 1"))


def test_named_binds_lists_and_defaults_reach_duckdb(tmp_path):
    statement = named_query(
        "batch_test.binds",
        """
        SELECT CAST(:d AS DATE) AS day, 7 = ANY(:ids) AS matches, :since AS since
    """,
    ).bindparams(bindparam("since", value=None))
    with open_batch_session([], workdir=tmp_path) as s:
        result = s.execute(statement, {"d": "2026-11-01", "ids": [2, 7]})
        assert [tuple(row) for row in result] == [(date(2026, 11, 1), True, None)]
        assert result.fetchall() == []
        assert (
            s.execute(named_query("batch_test.ddl", "CREATE TABLE empty (id INT)")).fetchall() == []
        )
        assert s.execute(named_query("batch_test.empty", "SELECT * FROM empty")).fetchall() == []


def test_timestamptz_comes_back_aware_utc_with_microseconds(tmp_path):
    with open_batch_session([], workdir=tmp_path) as s:
        row = s.execute(
            named_query(
                "batch_test.timestamp",
                """
            SELECT TIMESTAMPTZ '2026-11-01 05:30:00.123456+00' + i * INTERVAL '1 second' AS stamp,
                   NULL::TIMESTAMPTZ AS missing
            FROM range(:n) t(i) ORDER BY i DESC LIMIT 1
        """,
            ),
            {"n": 2},
        ).fetchall()[0]
        assert row.stamp == datetime(2026, 11, 1, 5, 30, 1, 123456, tzinfo=UTC)
        assert row.missing is None


@pytest.mark.parametrize(
    "sql",
    [
        "1.75::DOUBLE AS id, 2::INTEGER AS n",
        "2::INTEGER AS n, 1::BIGINT AS id",
        "1::BIGINT AS other, 2::INTEGER AS n",
    ],
)
def test_mixed_parquet_schemas_are_refused(tmp_path, sql):
    first = parquet(tmp_path / "first.parquet", "SELECT 1::BIGINT AS id, 2::INTEGER AS n")
    second = parquet(tmp_path / "second.parquet", "SELECT " + sql)
    with (
        pytest.raises(InputRefused, match=r"second.parquet.*schema"),
        open_batch_session([BatchInput("gold.t", (first, second))], workdir=tmp_path),
    ):
        pytest.fail("mixed schema accepted")


def test_hive_directories_do_not_replace_or_inject_values(tmp_path):
    path = parquet(
        tmp_path / "code=001" / "day=2026-11-01" / "a.parquet", "SELECT 'stored' AS code, 7 AS id"
    )
    with open_batch_session([BatchInput("gold.t", (path,))], workdir=tmp_path) as s:
        result = s.execute(text("-- q:test.hive\nSELECT * FROM gold.t"))
        assert result.columns == ("code", "id")
        assert [tuple(row) for row in result] == [("stored", 7)]


@pytest.mark.parametrize("char", list("*?[]{}"))
def test_glob_paths_are_refused_by_name(tmp_path, char):
    path = tmp_path / ("day" + char + "1.parquet")
    if char in "[]{}":
        parquet(path)
        parquet(tmp_path / "day1.parquet", "SELECT 222 AS id")
    with (
        pytest.raises(InputRefused, match="glob"),
        open_batch_session([BatchInput("gold.t", (path,))], workdir=tmp_path),
    ):
        pytest.fail("glob accepted")


@pytest.mark.parametrize(
    "expression",
    [
        "NULL::TIMESTAMPTZ AS stamp, CAST('2026-11-01' AS TIMESTAMPTZ) AS stamp",
        "[CAST('2026-11-01' AS TIMESTAMPTZ)] AS nested",
        "{'a': CAST('2026-11-01' AS TIMESTAMPTZ)} AS nested",
        "map(['a'], [CAST('2026-11-01' AS TIMESTAMPTZ)]) AS nested",
    ],
)
def test_ambiguous_or_nested_timestamps_are_refused_by_name(tmp_path, expression):
    with open_batch_session([], workdir=tmp_path) as s:
        with pytest.raises(BatchEngineError, match="stamp|nested"):
            s.execute(text("-- q:test.refused\nSELECT " + expression))


@pytest.mark.parametrize("ids, expected", [([2, 7], True), ([], False)])
def test_typed_and_expanding_binds_preserve_values(tmp_path, ids, expected):
    query = text(
        "-- q:test.typed\nSELECT :d AS d, :i AS i, :t AS t, 7 IN :ids AS found, :i AS repeated"
    ).bindparams(
        bindparam("d", type_=Date),
        bindparam("i", type_=Integer),
        bindparam("t", type_=TIMESTAMP),
        bindparam("ids", expanding=True),
    )
    with open_batch_session([], workdir=tmp_path) as s:
        rows = s.execute(
            query, {"d": "2026-11-01", "i": "7", "t": "2026-11-01 05:30:00.123456", "ids": ids}
        ).fetchall()
        assert tuple(rows[0]) == (
            date(2026, 11, 1),
            7,
            datetime(2026, 11, 1, 5, 30, 0, 123456),
            expected,
            7,
        )
