from dataclasses import FrozenInstanceError, replace
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from importlib import import_module

import duckdb
import pytest

from transit_ops.batch.build import BuildRequest, FamilyBuilder, FamilyOutput, InputNeed, TableRows
from transit_ops.batch.engine import BatchInput, InputRefused, open_batch_session
from transit_ops.batch.families.registry import FAMILIES, resolve_builder
from transit_ops.batch.inputs import resolve_inputs
from transit_ops.sql_registry import named_query


def request():
    return BuildRequest("network", (date(2026, 11, 1),), datetime(2026, 11, 3, tzinfo=UTC), 14, 10)


def test_build_request_refuses_what_the_postgres_build_refuses():
    good = request()
    for changes, message in [
        (
            {"fact_retention_days": 13},
            "GOLD_FACT_RETENTION_DAYS must be at least 14 to cover the percentile lookback",
        ),
        (
            {"open_window_days": 0},
            "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
            "GOLD_FACT_RETENTION_DAYS",
        ),
        (
            {"open_window_days": 14},
            "GOLD_REPORTING_OPEN_WINDOW_DAYS must be greater than 0 and less than "
            "GOLD_FACT_RETENTION_DAYS",
        ),
        ({"as_of_utc": datetime(2026, 11, 3)}, "as_of_utc must be timezone-aware"),
    ]:
        with pytest.raises(ValueError) as error:
            replace(good, **changes)
        assert str(error.value) == message
    for days in [(), (date(2026, 11, 2), date(2026, 11, 1)), (date(2026, 11, 1),) * 2]:
        with pytest.raises(ValueError, match="local_dates"):
            replace(good, local_dates=days)
    with pytest.raises(ValueError, match="UTC"):
        replace(good, as_of_utc=datetime(2026, 11, 3, tzinfo=timezone(timedelta(hours=1))))
    with pytest.raises(FrozenInstanceError):
        good.provider_id = "other"


def test_table_rows_must_be_sorted_and_keyed():
    values = (
        Decimal("1.20"),
        1.5,
        3,
        "label",
        True,
        date(2026, 11, 1),
        request().as_of_utc,
        ["a", None],
        None,
    )
    table = TableRows("gold.toy", ("id", "values"), ("id",), ((1, values), (2, None)))
    assert table.rows == ((1, values), (2, None))
    assert replace(table, rows=()).rows == ()
    for rows in [((2, None), (1, None)), ((1, None), (1, "duplicate"))]:
        with pytest.raises(ValueError, match="key"):
            replace(table, rows=rows)
    with pytest.raises(ValueError, match="columns"):
        replace(table, key=("missing",))
    with pytest.raises(ValueError, match="columns"):
        replace(table, rows=((1,),))
    composite = TableRows("gold.toy", ("a", "b"), ("b", "a"), ((2, "a"), (1, "b")))
    assert composite.key == ("b", "a")
    output = FamilyOutput({"gold.toy": table}, {"historic/toy.json": b'{"value":null}'})
    assert output.tables["gold.toy"] is table
    assert output.bodies["historic/toy.json"] == b'{"value":null}'


def parquet(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect() as conn:
        conn.execute("COPY (SELECT ?::INTEGER AS id) TO ? (FORMAT PARQUET)", [value, str(path)])
    return path


def test_inputs_resolve_to_the_local_layout_and_missing_files_are_refused(tmp_path):
    first = parquet(tmp_path / "gold.toy" / "2026-11-01.parquet", 1)
    second = parquet(tmp_path / "gold.toy" / "local=2026-11-02.parquet", 2)
    edition = parquet(tmp_path / "silver.toy" / "edition=dataset-7.parquet", 3)
    needs = (
        InputNeed("silver.toy", "edition:dataset-7"),
        InputNeed("gold.toy", "local:2026-11-02"),
        InputNeed("gold.toy", "2026-11-01"),
    )
    resolved = resolve_inputs(needs, tmp_path)
    assert resolved == (
        BatchInput("gold.toy", (first, second)),
        BatchInput("silver.toy", (edition,)),
    )
    with open_batch_session(resolved, workdir=tmp_path / "work") as session:
        rows = session.execute(named_query("test.layout", "SELECT id FROM gold.toy ORDER BY id"))
        assert [tuple(row) for row in rows] == [(1,), (2,)]
    assert resolve_inputs((), tmp_path) == ()
    # all is a single declared file, never a directory scan.
    whole = parquet(tmp_path / "gold.toy" / "all.parquet", 4)
    assert resolve_inputs((InputNeed("gold.toy", "all"),), tmp_path) == (
        BatchInput("gold.toy", (whole,)),
    )
    edition.unlink()
    with pytest.raises(InputRefused) as error:
        resolve_inputs(needs, tmp_path)
    assert "silver.toy" in str(error.value) and "edition:dataset-7" in str(error.value)


@pytest.mark.parametrize(
    "window",
    [
        "2026-02-30",
        "20261101",
        "local:2026-1-01",
        "edition:",
        "edition:../escape",
        "../all",
        "all/child",
    ],
)
def test_input_need_refuses_invalid_windows(window):
    with pytest.raises(ValueError, match="window"):
        InputNeed("gold.toy", window)


@pytest.mark.parametrize("char", list("*?[]{}"))
def test_glob_input_names_are_refused(tmp_path, char):
    with pytest.raises(ValueError, match="window"):
        InputNeed("gold.toy", "edition:part" + char)
    with pytest.raises(InputRefused, match="glob"):
        resolve_inputs((InputNeed("gold.toy", "all"),), tmp_path / ("root" + char))


@pytest.mark.parametrize("relation", ["toy", "../gold.toy", "gold.toy/child", "gold.toy*"])
def test_input_need_refuses_unsafe_relations(relation):
    with pytest.raises(ValueError, match="relation"):
        InputNeed(relation, "all")


def test_duplicate_needs_are_refused(tmp_path):
    parquet(tmp_path / "gold.toy" / "all.parquet", 1)
    with pytest.raises(InputRefused, match="duplicate"):
        resolve_inputs((InputNeed("gold.toy", "all"),) * 2, tmp_path)


def test_a_filled_registry_slot_satisfies_the_protocol(monkeypatch, tmp_path):
    class ToyBuilder:
        family_id = "route_spine_hours"
        tables = ("gold.toy",)
        published_keys = ("historic/toy/*.json",)
        variants = {}

        def inputs(self, request):
            return (InputNeed("gold.toy", "all"),)

        def build(self, session, request):
            return FamilyOutput({"gold.toy": TableRows("gold.toy", ("id",), ("id",), ((7,),))}, {})

    builder = ToyBuilder()
    module = import_module(FAMILIES[builder.family_id].module_path)
    monkeypatch.setattr(module, "builder", builder)
    resolved = resolve_builder(builder.family_id)
    assert resolved is builder and isinstance(resolved, FamilyBuilder)
    assert resolved.inputs(request()) == (InputNeed("gold.toy", "all"),)
    with open_batch_session((), workdir=tmp_path) as session:
        assert resolved.build(session, request()).tables["gold.toy"].rows == ((7,),)
    assert all(resolve_builder(name) is None for name in FAMILIES if name != builder.family_id)
