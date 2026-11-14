"""PostgreSQL literals are the port contract; engine differences stay explicit.

Reference: https://www.postgresql.org/docs/16/functions-math.html,
functions-aggregate.html, functions-datetime.html, queries-order.html,
collation.html, functions-formatting.html, ddl-system-columns.html and
functions-srf.html under the same documentation root. PostgreSQL twins run
on the disposable Linux CI database, including platform-dependent float ties.
"""

import os
import subprocess
import sys
from datetime import UTC, datetime, timedelta
from decimal import Decimal
from hashlib import sha256
from pathlib import Path

import duckdb
import pytest

from transit_ops.batch.engine import open_batch_session
from transit_ops.sql_registry import named_query


def query(engine, request, workdir, sql, *, setup=()):
    statement = named(sql)
    if engine == "postgresql":
        with request.getfixturevalue("real_db_engine").connect() as connection:
            connection.exec_driver_sql("SET LOCAL TIME ZONE 'UTC'")
            for command in setup:
                connection.execute(named(command))
            return [tuple(row) for row in connection.execute(statement)]
    with open_batch_session([], workdir=workdir) as session:
        for command in setup:
            session.execute(named(command))
        return [tuple(row) for row in session.execute(statement)]


def named(sql):
    return named_query("compat." + sha256(sql.encode("utf-8")).hexdigest(), sql)


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_integer_division_truncates_toward_zero(engine, request, tmp_path):
    assert query(engine, request, tmp_path, "SELECT 7/2, -7/2, 7 % -2, -7 % 2") == [(3, -3, 1, -1)]


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
@pytest.mark.parametrize("order, expected", [("DESC", [None, 2, 1]), ("ASC", [1, 2, None])])
def test_descending_order_puts_nulls_first(engine, request, tmp_path, order, expected):
    rows = query(
        engine,
        request,
        tmp_path,
        f"SELECT x FROM (VALUES (1), (NULL), (2)) AS t(x) ORDER BY x {order}",
    )
    assert [row[0] for row in rows] == expected


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_text_order_is_binary_so_postgresql_ports_use_c_collation(engine, request, tmp_path):
    collation = ' COLLATE "C"' if engine == "postgresql" else ""
    rows = query(
        engine,
        request,
        tmp_path,
        "SELECT x FROM (VALUES ('é'), ('e'), ('b'), ('a'), ('_'), ('Z'), ('B'), ('9'), "
        f"('10')) AS t(x) ORDER BY x{collation}",
    )
    assert [row[0] for row in rows] == ["10", "9", "B", "Z", "_", "a", "b", "e", "é"]


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_decimal_rounding_is_half_away_from_zero(engine, request, tmp_path):
    rows = query(
        engine,
        request,
        tmp_path,
        "SELECT round(CAST(2.5 AS DECIMAL(6,3))), round(CAST(-2.5 AS DECIMAL(6,3))), "
        "round(CAST(0.125 AS DECIMAL(6,3)), 2)",
    )
    assert rows == [(Decimal("3"), Decimal("-3"), Decimal("0.13"))]
    assert all(isinstance(value, Decimal) for value in rows[0])
    assert tuple(str(value) for value in rows[0]) == ("3", "-3", "0.13")


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_double_rounding_differs_so_ports_round_decimals(engine, request, tmp_path):
    pg_expected = [(0.0, 2.0, 2.0, -2.0)]
    expected = [(1.0, 2.0, 3.0, -3.0)] if engine == "duckdb" else pg_expected
    assert (
        query(
            engine,
            request,
            tmp_path,
            "SELECT round(CAST(0.5 AS DOUBLE PRECISION)), round(CAST(1.5 AS DOUBLE PRECISION)), "
            "round(CAST(2.5 AS DOUBLE PRECISION)), round(CAST(-2.5 AS DOUBLE PRECISION))",
        )
        == expected
    )


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
@pytest.mark.parametrize(
    "expression, pg_value, duck_value, duck_type",
    [
        ("avg(x)", Decimal("1.5000000000000000"), 1.5, float),
        ("avg(CAST(x AS DECIMAL(18,3)))", Decimal("1.5000000000000000"), 1.5, float),
        ("sum(CAST(x AS BIGINT))", Decimal("3"), 3, int),
        (
            "CAST(10 AS DECIMAL(18,3))/CAST(4 AS DECIMAL(18,3))",
            Decimal("2.5000000000000000"),
            2.5,
            float,
        ),
    ],
)
def test_aggregate_types_differ_so_ports_cast_explicitly(
    engine,
    request,
    tmp_path,
    expression,
    pg_value,
    duck_value,
    duck_type,
):
    source = " FROM (VALUES (1), (2)) t(x)" if expression.startswith(("avg(", "sum(")) else ""
    rows = query(engine, request, tmp_path, f"SELECT {expression}{source}")
    assert rows == [(duck_value if engine == "duckdb" else pg_value,)]
    assert type(rows[0][0]) is (duck_type if engine == "duckdb" else Decimal)
    assert str(rows[0][0]) == str(duck_value if engine == "duckdb" else pg_value)
    type_function = "typeof" if engine == "duckdb" else "pg_typeof"
    expected_type = (
        ("HUGEINT" if duck_type is int else "DOUBLE") if engine == "duckdb" else "numeric"
    )
    assert query(
        engine,
        request,
        tmp_path,
        f"SELECT CAST({type_function}({expression}) AS TEXT){source}",
    ) == [(expected_type,)]


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_local_time_and_dst_agree_in_utc_despite_host_zone(engine, request, tmp_path, monkeypatch):
    if engine == "postgresql":
        assert_local_time_and_dst(engine, request, tmp_path)
        return
    monkeypatch.setenv("TZ", "UTC")
    code = """
import runpy
import sys
from pathlib import Path
import duckdb
with duckdb.connect() as connection:
    zone = connection.execute("SELECT current_setting('TimeZone')").fetchone()[0]
    assert zone != 'UTC', zone
module = runpy.run_path(sys.argv[1])
module['assert_local_time_and_dst']('duckdb', None, Path(sys.argv[2]))
"""
    result = subprocess.run(
        [sys.executable, "-I", "-c", code, str(Path(__file__).resolve()), str(tmp_path)],
        env=dict(os.environ, TZ="America/Toronto"),
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout + result.stderr


def assert_local_time_and_dst(engine, request, tmp_path):
    hour = 1 if engine == "duckdb" else Decimal("1")
    kind = "typeof" if engine == "duckdb" else "pg_typeof"
    hour_type = "BIGINT" if engine == "duckdb" else "numeric"
    rows = query(
        engine,
        request,
        tmp_path,
        "SELECT current_setting('TimeZone'), timezone('America/Toronto', t), "
        "EXTRACT(HOUR FROM timezone('America/Toronto', t)), t, "
        f"CAST({kind}(EXTRACT(HOUR FROM timezone('America/Toronto', t))) AS TEXT) AS hour_type "
        "FROM (VALUES (TIMESTAMPTZ '2026-11-01 05:30:00.123456+00'), "
        "(TIMESTAMPTZ '2026-11-01 06:30:00.123456+00')) v(t) ORDER BY t",
    )
    assert rows == [
        (
            "UTC",
            datetime(2026, 11, 1, 1, 30, 0, 123456),
            hour,
            datetime(2026, 11, 1, 5, 30, 0, 123456, tzinfo=UTC),
            hour_type,
        ),
        (
            "UTC",
            datetime(2026, 11, 1, 1, 30, 0, 123456),
            hour,
            datetime(2026, 11, 1, 6, 30, 0, 123456, tzinfo=UTC),
            hour_type,
        ),
    ]
    assert all(type(row[2]) is (int if engine == "duckdb" else Decimal) for row in rows)
    assert [str(row[2]) for row in rows] == ["1", "1"]


# Keep the PostgreSQL call and its explicit port beside the same expected literal.
@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
@pytest.mark.parametrize(
    "pg_sql, duck_sql, expected",
    [
        ("make_interval(days => 14)", "to_days(14)", timedelta(days=14)),
        (
            "date_bin(INTERVAL '5 minutes', TIMESTAMPTZ '2026-11-01 05:32:17+00', "
            "TIMESTAMPTZ '2000-01-01 00:00:00+00')",
            "time_bucket(INTERVAL '5 minutes', TIMESTAMPTZ '2026-11-01 05:32:17+00', "
            "TIMESTAMPTZ '2000-01-01 00:00:00+00')",
            datetime(2026, 11, 1, 5, 30, tzinfo=UTC),
        ),
        (
            "to_char(TIMESTAMP '2026-11-01 05:32:17', 'YYYY-MM-DD HH24:MI:SS')",
            "strftime(TIMESTAMP '2026-11-01 05:32:17', '%Y-%m-%d %H:%M:%S')",
            "2026-11-01 05:32:17",
        ),
    ],
)
def test_missing_functions_need_rewrites(engine, request, tmp_path, pg_sql, duck_sql, expected):
    if engine == "duckdb":
        with pytest.raises(duckdb.CatalogException, match=pg_sql.split("(", 1)[0]):
            query(engine, request, tmp_path, f"SELECT {pg_sql}")
    sql = duck_sql if engine == "duckdb" else pg_sql
    assert query(engine, request, tmp_path, f"SELECT {sql}") == [(expected,)]


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
@pytest.mark.parametrize("column", ["ctid", "xmin"])
def test_system_columns_are_absent_so_ports_need_declared_keys(engine, request, tmp_path, column):
    setup = ["CREATE TEMP TABLE trap_rows (x INTEGER)", "INSERT INTO trap_rows VALUES (7)"]
    sql = f"SELECT {column} IS NOT NULL FROM trap_rows"
    if engine == "duckdb":
        with pytest.raises(duckdb.BinderException, match=column):
            query(engine, request, tmp_path, sql, setup=setup)
    else:
        assert query(engine, request, tmp_path, sql, setup=setup) == [(True,)]


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_double_text_differs_so_ports_serialize_in_python(engine, request, tmp_path):
    pg_expected = [("100", "0.30000000000000004")]
    expected = [("100.0", "0.30000000000000004")] if engine == "duckdb" else pg_expected
    assert (
        query(
            engine,
            request,
            tmp_path,
            "SELECT CAST(CAST(100 AS DOUBLE PRECISION) AS TEXT), "
            "CAST(CAST(0.1 AS DOUBLE PRECISION)*3 AS TEXT)",
        )
        == expected
    )


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_scalar_generate_series_is_a_list_so_ports_use_from(engine, request, tmp_path):
    pg_expected = [(1,), (2,), (3,)]
    assert query(engine, request, tmp_path, "SELECT generate_series(1, 3)") == (
        [([1, 2, 3],)] if engine == "duckdb" else pg_expected
    )
    assert query(engine, request, tmp_path, "SELECT * FROM generate_series(1, 3)") == pg_expected


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_float_sums_depend_on_order_so_ports_keep_one_thread_and_use_exact_decimals(
    engine,
    request,
    tmp_path,
):
    rows = query(
        engine,
        request,
        tmp_path,
        "SELECT sum(CAST(x AS DOUBLE PRECISION) ORDER BY n) AS float_input_order, "
        "sum(CAST(x AS DOUBLE PRECISION) ORDER BY abs(x) DESC, n) AS float_large_first, "
        "sum(CAST(x AS DECIMAL(20,0)) ORDER BY n) AS exact_input_order, "
        "sum(CAST(x AS DECIMAL(20,0)) ORDER BY abs(x) DESC, n) AS exact_large_first "
        "FROM (VALUES (1, 10000000000000000), (2, 1), (3, -10000000000000000)) t(n, x)",
    )
    assert rows == [(0.0, 1.0, Decimal("1"), Decimal("1"))]
    assert tuple(type(value) for value in rows[0]) == (float, float, Decimal, Decimal)
    assert tuple(str(value) for value in rows[0]) == ("0.0", "1.0", "1", "1")


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_array_width_bucket_needs_a_null_guarded_list_rewrite(engine, request, tmp_path):
    edges = (
        "ARRAY[-3600,-300,-180,-120,-90,-60,-30,0,30,60,90,120,150,180,"
        "240,300,420,600,900,1800,3600]"
    )
    source = " FROM (VALUES (1,-4000), (2,-3600), (3,0), (4,5000), (5,NULL)) t(n,x) ORDER BY n"
    pg_sql = f"SELECT width_bucket(x, {edges}){source}"
    if engine == "duckdb":
        with pytest.raises(duckdb.CatalogException, match="width_bucket"):
            query(engine, request, tmp_path, pg_sql)
        sql = (
            f"SELECT CASE WHEN x IS NULL THEN NULL ELSE "
            f"len(list_filter({edges}, lambda v: v <= x)) END{source}"
        )
    else:
        sql = pg_sql
    assert query(engine, request, tmp_path, sql) == [(0,), (1,), (8,), (21,), (None,)]


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
@pytest.mark.parametrize(
    "division, pg_text, duck_value",
    [
        ("", "450.000000", 450.0),
        (" / 60.0", "7.5000000000000000", 7.5),
    ],
)
def test_extract_epoch_and_minutes_need_explicit_numeric_casts(
    engine,
    request,
    tmp_path,
    division,
    pg_text,
    duck_value,
):
    expression = f"EXTRACT(EPOCH FROM INTERVAL '7 minutes 30 seconds'){division}"
    kind = "typeof" if engine == "duckdb" else "pg_typeof"
    rows = query(
        engine,
        request,
        tmp_path,
        f"SELECT {expression} AS value, CAST({kind}({expression}) AS TEXT) AS kind",
    )
    expected = duck_value if engine == "duckdb" else Decimal(pg_text)
    assert rows == [(expected, "DOUBLE" if engine == "duckdb" else "numeric")]
    assert type(rows[0][0]) is (float if engine == "duckdb" else Decimal)
    assert str(rows[0][0]) == (str(duck_value) if engine == "duckdb" else pg_text)


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_percentile_cont_returns_double_so_ports_cast_explicitly(engine, request, tmp_path):
    expression = "percentile_cont(0.5) WITHIN GROUP (ORDER BY x)"
    kind = "typeof" if engine == "duckdb" else "pg_typeof"
    rows = query(
        engine,
        request,
        tmp_path,
        f"SELECT {expression} AS value, CAST({kind}({expression}) AS TEXT) AS kind "
        "FROM (VALUES (1), (2)) t(x)",
    )
    assert rows == [(1.5, "DOUBLE" if engine == "duckdb" else "double precision")]
    assert type(rows[0][0]) is float


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_numeric_histogram_lists_promote_scale_so_ports_cast_elements(engine, request, tmp_path):
    kind = "typeof" if engine == "duckdb" else "pg_typeof"
    rows = query(
        engine,
        request,
        tmp_path,
        f"SELECT ARRAY[0.0,0.5,1] AS edges, CAST({kind}(ARRAY[0.0,0.5,1]) AS TEXT) AS kind",
    )
    assert rows[0][0] == [Decimal("0.0"), Decimal("0.5"), Decimal("1")]
    assert all(type(value) is Decimal for value in rows[0][0])
    assert [str(value) for value in rows[0][0]] == (
        ["0.0", "0.5", "1.0"] if engine == "duckdb" else ["0.0", "0.5", "1"]
    )
    assert rows[0][1] == ("DECIMAL(11,1)[]" if engine == "duckdb" else "numeric[]")


@pytest.mark.parametrize("engine", ["duckdb", "postgresql"])
def test_list_filter_needs_lambda_keyword_instead_of_arrow(engine, request, tmp_path):
    if engine == "duckdb":
        with pytest.raises(duckdb.BinderException, match="lambda"):
            query(engine, request, tmp_path, "SELECT list_filter([0,1,2], v -> v <= 1)")
        sql = "SELECT list_filter([0,1,2], lambda v: v <= 1)"
    else:
        sql = "SELECT ARRAY(SELECT v FROM unnest(ARRAY[0,1,2]) t(v) WHERE v <= 1 ORDER BY v)"
    assert query(engine, request, tmp_path, sql) == [([0, 1],)]
