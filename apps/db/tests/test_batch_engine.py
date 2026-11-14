from datetime import UTC, datetime

import duckdb
import pytest
from sqlalchemy import bindparam, text

from transit_ops.batch.engine import (
    BatchInput,
    InputRefused,
    UnnamedQueryRefused,
    open_batch_session,
)
from transit_ops.sql_registry import named_query


def test_session_runs_in_utc_whatever_the_host_zone(tmp_path, monkeypatch):
    monkeypatch.setenv("TZ", "America/Toronto")
    with open_batch_session([], workdir=tmp_path) as session:
        row = session.execute(
            named_query(
                "batch_test.zone",
                """
            SELECT current_setting('TimeZone') AS zone,
                   current_setting('threads') AS threads,
                   timezone('America/Toronto', CAST(:t AS TIMESTAMPTZ)) AS local,
                   EXTRACT(HOUR FROM timezone('America/Toronto', CAST(:t AS TIMESTAMPTZ)))
        """,
            ),
            {"t": datetime(2026, 11, 1, 5, 30, tzinfo=UTC)},
        ).fetchall()[0]
        assert tuple(row) == ("UTC", 1, datetime(2026, 11, 1, 1, 30), 1)
        row = session.execute(
            named_query(
                "batch_test.zone",
                """
            SELECT current_setting('TimeZone') AS zone,
                   current_setting('threads') AS threads,
                   timezone('America/Toronto', CAST(:t AS TIMESTAMPTZ)) AS local,
                   EXTRACT(HOUR FROM timezone('America/Toronto', CAST(:t AS TIMESTAMPTZ)))
        """,
            ),
            {"t": datetime(2026, 11, 1, 6, 30, tzinfo=UTC)},
        ).fetchall()[0]
        assert tuple(row) == ("UTC", 1, datetime(2026, 11, 1, 1, 30), 1)


def parquet(path):
    path.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect() as conn:
        conn.execute("COPY (SELECT 7 AS id) TO ? (FORMAT PARQUET)", [str(path)])
    return path


def test_inputs_are_views_over_parquet_and_other_files_are_refused(tmp_path):
    declared = parquet(tmp_path / "input" / "one.parquet")
    other = parquet(tmp_path / "other" / "two.parquet")
    with open_batch_session([BatchInput("gold.t", (declared,))], workdir=tmp_path / "work") as s:
        result = s.execute(named_query("batch_test.input", "SELECT id FROM gold.t"))
        assert result.columns == ("id",)
        row = result.fetchall()[0]
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


@pytest.mark.parametrize("case", ["relative", "missing", "bare", "invalid", "duplicate", "empty"])
def test_bad_inputs_are_refused(tmp_path, case):
    path = parquet(tmp_path / "input.parquet")
    inputs = {
        "relative": [BatchInput("gold.t", (path.relative_to(tmp_path),))],
        "missing": [BatchInput("gold.t", (tmp_path / "missing",))],
        "bare": [BatchInput("t", (path,))],
        "invalid": [BatchInput("gold.T;drop", (path,))],
        "duplicate": [BatchInput("gold.t", (path,))] * 2,
        "empty": [BatchInput("gold.t", ())],
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
        from datetime import date

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
            SELECT TIMESTAMPTZ '2026-11-01 05:30:00.123456+00' AS stamp,
                   NULL::TIMESTAMPTZ AS missing
        """,
            )
        ).fetchall()[0]
        assert row.stamp == datetime(2026, 11, 1, 5, 30, 0, 123456, tzinfo=UTC)
        assert row.missing is None
