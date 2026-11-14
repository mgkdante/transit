import hashlib
from datetime import date

import duckdb
import pytest
from sqlalchemy import text
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
    [
        "fetchone",
        "first",
        "one",
        "one_or_none",
        "scalar_one",
        "scalar_one_or_none",
        "fetchall",
        "scalars",
        "mappings",
    ],
)
def test_result_methods_match_sqlalchemy_semantics(tmp_path, count, method):
    with open_batch_session([], workdir=tmp_path) as s:
        result = s.execute(
            named_query(
                "guards.rows",
                """
            SELECT DATE '2026-11-01' + CAST(i AS INTEGER) AS local_date
            FROM range(:n) t(i) ORDER BY i
        """,
            ),
            {"n": count},
        )
        error = (
            NoResultFound
            if count == 0 and method in ("one", "scalar_one")
            else MultipleResultsFound
            if count == 2 and method in ("one", "one_or_none", "scalar_one", "scalar_one_or_none")
            else None
        )
        if error:
            with pytest.raises(error):
                getattr(result, method)()
            return
        value = getattr(result, method)()
        dates = [date(2026, 11, 1), date(2026, 11, 2)][:count]
        if method == "scalars":
            assert value.all() == dates
        elif method == "mappings":
            mappings = value.all()
            assert mappings == [{"local_date": day} for day in dates]
            if mappings:
                with pytest.raises(TypeError):
                    mappings[0]["local_date"] = None
        elif method == "fetchall":
            assert [row[0] for row in value] == dates
        elif method.startswith("scalar"):
            assert value == (dates[0] if dates else None)
        elif dates:
            assert value.local_date == value[0] == value._mapping["local_date"] == dates[0]
        else:
            assert value is None
        if method == "fetchone":
            remaining = result.fetchone()
            assert (remaining[0] if remaining else None) == (dates[1] if count == 2 else None)


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
