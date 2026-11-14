import hashlib
from datetime import date

import duckdb
import pytest
from sqlalchemy import Date, create_engine, text
from sqlalchemy.exc import MultipleResultsFound, NoResultFound

from transit_ops.batch.clock_guard import ClockReadRefused
from transit_ops.batch.engine import BatchInput, open_batch_session
from transit_ops.sql_registry import named_query

CLOCK_READS = """now() today() current_date current_time current_timestamp
current_localtimestamp() localtime localtimestamp get_current_time()
get_current_timestamp() transaction_timestamp()""".split()


@pytest.mark.parametrize("expression", CLOCK_READS)
@pytest.mark.parametrize("uppercase", [False, True])
def test_clock_reads_are_refused(tmp_path, expression, uppercase):
    expression = expression.upper() if uppercase else expression
    with open_batch_session([], workdir=tmp_path) as session:
        with pytest.raises(ClockReadRefused):
            session.execute(
                named_query(
                    "guards.clock_" + expression.lower().strip("()") + str(uppercase).lower(),
                    "SELECT " + expression,
                )
            )


def test_clock_words_in_literals_comments_and_longer_names_pass(tmp_path):
    with open_batch_session([], workdir=tmp_path) as session:
        result = session.execute(named_query("guards.literal", "SELECT 'now()' AS s -- today"))
        assert result.fetchall()[0][0] == "now()"
        result = session.execute(named_query("guards.column", "SELECT 7 AS now_utc"))
        assert result.fetchall()[0].now_utc == 7


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT 'é', now()",
        "/* Montréal */ SELECT current_timestamp",
        "SELECT '🚎', get_current_time()",
        'SELECT "CURRENT_LOCALTIME"()',
        "SELECT age(TIMESTAMP '2026-01-01')",
        "SELECT ago(INTERVAL '1 hour')",
        "SELECT uuid_extract_timestamp(uuidv7())",
        "SELECT pg_conf_load_time()",
        "SELECT pg_postmaster_start_time()",
        "SELECT clock_timestamp()",
        "SELECT * FROM query('SELECT now()')",
        "SELECT * FROM query(:sql)",
        "SELECT * FROM query_table(:sql)",
        "SELECT * FROM json_execute_serialized_sql(:sql)",
        "SELECT * FROM histogram_values('unused', 'x')",
        "SELECT * FROM histogram('unused', 'x')",
    ],
)
def test_additional_clock_and_dynamic_sql_reads_are_refused(tmp_path, sql):
    with open_batch_session([], workdir=tmp_path) as s:
        with pytest.raises(ClockReadRefused):
            s.execute(text("-- q:guards.additional\n" + sql), {"sql": "SELECT now()"})


@pytest.mark.parametrize("count", [0, 1, 2])
@pytest.mark.parametrize(
    "kind,method",
    [
        (kind, method)
        for kind in ("mappings", "scalars")
        for method in ("iterate", "fetchone", "fetchall", "first", "all")
        if kind == "mappings" or method != "fetchone"
    ],
)
def test_filtered_results_match_sqlalchemy(tmp_path, count, kind, method):
    sql = "SELECT 1 AS value WHERE :n > 0 UNION ALL SELECT NULL WHERE :n > 1"

    def consume(result):
        values = getattr(result, kind)()
        if method == "iterate":
            return list(values), values.all()
        if method == "fetchone":
            return [values.fetchone() for _ in range(count + 2)]
        return getattr(values, method)()

    with create_engine("sqlite://").connect() as reference:
        expected = consume(reference.execute(text(sql), {"n": count}))
    with open_batch_session([], workdir=tmp_path) as s:
        assert consume(s.execute(text("-- q:guards.filtered\n" + sql), {"n": count})) == expected


def test_existing_historic_mapping_consumers(tmp_path):
    from transit_ops.snapshots.builders.historic import network_trend, small_surfaces

    empty = text("-- q:guards.empty\nSELECT 1 AS unused WHERE false")
    anchor = text(
        "-- q:guards.anchor\nSELECT DATE '2026-11-01' AS anchor WHERE :provider_id = 'test'"
    )
    with open_batch_session([], workdir=tmp_path) as s:
        assert (
            network_trend._trend_points(
                s, {}, otp_sql=empty, cancellation_sql=empty, occupancy_sql=empty
            )
            == []
        )
        assert small_surfaces._hotspots_anchor(s, anchor, "test") == date(2026, 11, 1)


def test_catalog_unstable_functions_are_refused(tmp_path):
    with duckdb.connect() as conn:
        names = conn.execute("""SELECT DISTINCT function_name FROM duckdb_functions()
            WHERE stability <> 'CONSISTENT' AND function_name NOT IN ('current_setting', 'error')
        """).fetchall()
    with open_batch_session([], workdir=tmp_path) as s:
        for (name,) in names:
            with pytest.raises(ClockReadRefused):
                s.execute(text(f'-- q:guards.catalog\nSELECT "{name}"()'))


def test_a_variant_replaces_its_named_query(tmp_path):
    from transit_ops.batch.engine import VariantRefused

    original = text("-- q:guards.variant\nSELECT :x AS n")
    variant = text("-- q:guards.variant\nSELECT :x + 1 AS n")
    with open_batch_session([], workdir=tmp_path, variants={"guards.variant": variant}) as s:
        assert s.execute(original, {"x": 1}).scalar_one() == 2
    for invalid in (text("SELECT 2"), text("-- q:guards.other\nSELECT 2")):
        with (
            pytest.raises(VariantRefused),
            open_batch_session([], workdir=tmp_path, variants={"guards.variant": invalid}),
        ):
            pytest.fail("invalid variant accepted")
    different = text("-- q:guards.variant\nSELECT :other")
    with open_batch_session([], workdir=tmp_path, variants={"guards.variant": different}) as s:
        with pytest.raises(VariantRefused):
            s.execute(original, {"x": 1})
    clock = text("-- q:guards.variant\nSELECT now() WHERE :x = 1")
    with open_batch_session([], workdir=tmp_path, variants={"guards.variant": clock}) as s:
        with pytest.raises(ClockReadRefused):
            s.execute(original, {"x": 1})


@pytest.mark.parametrize("count", [0, 1, 2])
@pytest.mark.parametrize(
    "method",
    """fetchone first one one_or_none scalar_one
scalar_one_or_none fetchall scalars mappings""".split(),
)
def test_result_methods_match_sqlalchemy_semantics(tmp_path, count, method):
    sql = """SELECT date('2026-11-01') AS local_date WHERE :n > 0
        UNION ALL SELECT date('2026-11-02') WHERE :n > 1"""

    def consume(result):
        try:
            value = getattr(result, method)()
        except (NoResultFound, MultipleResultsFound) as error:
            return type(error)
        if method in ("mappings", "scalars"):
            rows = value.all()
            if method == "mappings" and rows:
                with pytest.raises(TypeError):
                    rows[0]["local_date"] = None
            return rows
        if method == "fetchall":
            return [tuple(row) for row in value]
        if value is None or method.startswith("scalar"):
            return value
        assert value.local_date == value[0] == value._mapping["local_date"]
        remaining = result.fetchall() if method == "fetchone" else []
        return tuple(value), [tuple(row) for row in remaining]

    with create_engine("sqlite://").connect() as reference:
        expected = consume(reference.execute(text(sql).columns(local_date=Date), {"n": count}))
    with open_batch_session([], workdir=tmp_path) as session:
        assert consume(session.execute(named_query("guards.rows", sql), {"n": count})) == expected


def test_repeat_runs_give_identical_bytes(tmp_path):
    path = tmp_path / "mixed.parquet"
    with duckdb.connect(config={"threads": "1"}) as conn:
        conn.execute("SELECT setseed(0.5)")
        conn.execute(
            """
            COPY (SELECT i % 7 AS g,
                (random()*2-1) * pow(10, floor(random()*17)-8) AS x
                FROM range(4000000) t(i)) TO ? (FORMAT PARQUET, ROW_GROUP_SIZE 100000)
        """,
            [str(path)],
        )
    digests = []
    for _ in range(5):
        with open_batch_session([BatchInput("gold.mixed", (path,))], workdir=tmp_path) as s:
            totals = s.execute(
                named_query("guards.totals", "SELECT sum(x), avg(x) FROM gold.mixed")
            )
            grouped = s.execute(
                named_query(
                    "guards.groups", "SELECT g, sum(x) FROM gold.mixed GROUP BY g ORDER BY g"
                )
            )
            rows = ([tuple(r) for r in totals], [tuple(r) for r in grouped])
            digests.append(hashlib.sha256(repr(rows).encode()).hexdigest())
    assert digests == [digests[0]] * 5
