import os
import subprocess
from dataclasses import FrozenInstanceError, replace
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal
from importlib import import_module
from itertools import combinations
from types import SimpleNamespace

import duckdb
import pytest

from transit_ops.batch.build import BuildRequest, FamilyBuilder, FamilyOutput, InputNeed, TableRows
from transit_ops.batch.engine import BatchInput, InputRefused, open_batch_session
from transit_ops.batch.families.registry import FAMILIES, resolve_builder
from transit_ops.batch.inputs import resolve_inputs
from transit_ops.gold.rollups import PERCENTILE_LOOKBACK_DAYS, build_warm_rollups
from transit_ops.sql_registry import named_query


def request():
    return BuildRequest(
        "network",
        (date(2026, 11, 1),),
        datetime(2026, 11, 3, tzinfo=UTC),
        14,
        10,
        "America/Toronto",
    )


def test_build_request_refuses_what_the_postgres_build_refuses():
    good = request()
    for retention, window in [(PERCENTILE_LOOKBACK_DAYS, 10), (14, 0), (14, 14)]:
        settings = SimpleNamespace(
            GOLD_FACT_RETENTION_DAYS=retention, GOLD_REPORTING_OPEN_WINDOW_DAYS=window
        )
        with pytest.raises(ValueError) as pg_error:
            build_warm_rollups("network", settings=settings, engine=object())
        with pytest.raises(ValueError) as batch_error:
            replace(good, fact_retention_days=retention, open_window_days=window)
        assert str(batch_error.value) == str(pg_error.value)
    for days in [(), (date(2026, 11, 2), date(2026, 11, 1)), (date(2026, 11, 1),) * 2]:
        with pytest.raises(ValueError, match="local_dates"):
            replace(good, local_dates=days)
    for changes in [
        {"provider_id": ""},
        {"local_dates": []},
        {"local_dates": (datetime(2026, 11, 1),)},
        {"local_dates": ("2026-11-01",)},
        {"as_of_utc": datetime(2026, 11, 3)},
    ]:
        with pytest.raises(ValueError):
            replace(good, **changes)
    stamp = datetime(2026, 11, 3, 1, 0, 0, 123456, tzinfo=timezone(timedelta(hours=1)))
    normalized = replace(good, as_of_utc=stamp).as_of_utc
    assert normalized == datetime(2026, 11, 3, 0, 0, 0, 123456, tzinfo=UTC)
    assert normalized.tzinfo is UTC
    with pytest.raises(FrozenInstanceError):
        good.provider_id = "other"


def test_table_rows_must_be_sorted_and_keyed():
    values = (Decimal("1.20"), 1.5, 3, "label", True, date(2026, 11, 1))
    values += (request().as_of_utc, ["a", None], None)
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


@pytest.mark.parametrize(
    "key,rows",
    [
        ((), ((1, 2),)),
        (("a",), ((None, 1),)),
        (("a", "b"), ((1, None), (2, None))),
        (("a", "b"), ((None, 1), (None, 2))),
    ],
)
def test_null_and_empty_keys_are_refused(key, rows):
    with pytest.raises(ValueError, match="key"):
        TableRows("gold.toy", ("a", "b"), key, rows)


@pytest.mark.parametrize("bad_body", [False, True])
def test_output_refuses_wrong_relations_and_nonbytes(bad_body):
    table = TableRows("gold.toy", ("id",), ("id",), ((1,),))
    with pytest.raises(ValueError):
        FamilyOutput(
            {"gold.toy" if bad_body else "gold.other": table},
            {"toy.json": "null" if bad_body else b"null"},
        )


def parquet(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with duckdb.connect() as conn:
        conn.execute("COPY (SELECT ?::INTEGER AS id) TO ? (FORMAT PARQUET)", [value, str(path)])
    return path


def test_inputs_resolve_to_the_local_layout_and_missing_files_are_refused(tmp_path):
    first = parquet(tmp_path / "gold.toy" / "2026-11-01.parquet", 1)
    second = parquet(tmp_path / "gold.toy" / "2026-11-02.parquet", 2)
    edition = parquet(tmp_path / "silver.toy" / "edition=7.parquet", 3)
    needs = (
        InputNeed("silver.toy", "edition:7"),
        InputNeed("gold.toy", "2026-11-02"),
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
    assert "silver.toy" in str(error.value) and "edition:7" in str(error.value)


@pytest.mark.parametrize(
    "window",
    (
        "2026-02-30|20261101|local:2026-1-01|edition:|edition:../escape|../all|"
        "all/child|edition:B|edition:1\n|edition: 1"
    ).split("|"),
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


@pytest.mark.parametrize(
    "windows",
    tuple(combinations("all 2026-11-01 local:2026-11-01 edition:1".split(), 2)),
)
def test_mixed_windows_are_refused(tmp_path, windows):
    for window in windows:
        parquet(tmp_path / "gold.toy" / (window.replace(":", "=") + ".parquet"), 1)
    with pytest.raises(InputRefused, match="gold.toy"):
        resolve_inputs(tuple(InputNeed("gold.toy", w) for w in windows), tmp_path)


@pytest.mark.parametrize(
    "windows", [("edition:2", "edition:10"), ("local:2026-11-02", "local:2026-11-01")]
)
def test_files_follow_window_string_order(tmp_path, windows):
    paths = [
        parquet(tmp_path / "gold.toy" / (w.replace(":", "=") + ".parquet"), 1) for w in windows
    ]
    assert resolve_inputs(tuple(InputNeed("gold.toy", w) for w in windows), tmp_path) == (
        BatchInput("gold.toy", tuple(reversed(paths))),
    )


@pytest.mark.parametrize("outside", [False, True])
@pytest.mark.parametrize("kind", ["file", "directory", "junction"])
def test_redirected_inputs_are_refused(tmp_path, outside, kind):
    if kind == "junction" and os.name != "nt":
        pytest.skip("junctions are Windows-specific; directory symlinks tested separately")
    root = tmp_path / "inputs"
    target_root = tmp_path / "outside" if outside else root / "other-edition"
    target = parquet(target_root / "edition=2.parquet", 999)
    declared = root / "gold.toy" / "edition=1.parquet"
    declared.parent.mkdir(parents=True)
    link = declared if kind == "file" else declared.parent
    if kind != "file":
        declared.parent.rmdir()
        target.rename(target_root / "edition=1.parquet")
    try:
        if kind == "junction":
            command = ["cmd", "/c", "mklink", "/J", str(link), str(target_root)]
            subprocess.run(command, check=True, capture_output=True)
        else:
            link.symlink_to(
                target if kind == "file" else target_root, target_is_directory=kind != "file"
            )
    except (OSError, subprocess.CalledProcessError) as error:
        pytest.skip(f"host cannot create {kind}: {error}")
    with pytest.raises(InputRefused, match="gold.toy.*edition:1"):
        resolve_inputs((InputNeed("gold.toy", "edition:1"),), root)


def test_a_filled_registry_slot_satisfies_the_protocol(monkeypatch):
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
    monkeypatch.setattr(import_module(FAMILIES[builder.family_id].module_path), "builder", builder)
    resolved = resolve_builder(builder.family_id)
    assert resolved is builder and isinstance(resolved, FamilyBuilder)
    assert resolved.inputs(request()) == (InputNeed("gold.toy", "all"),)
    assert all(resolve_builder(name) is None for name in FAMILIES if name != builder.family_id)


@pytest.mark.parametrize("zone", ["Unknown/Nowhere", "", None])
def test_request_requires_an_iana_timezone(zone):
    with pytest.raises(ValueError, match="timezone"):
        replace(request(), timezone=zone)


@pytest.mark.parametrize(
    "day,closing_stamp",
    [
        (date(2026, 11, 1), datetime(2026, 11, 2, 5, tzinfo=UTC)),
        (date(2026, 3, 8), datetime(2026, 3, 9, 4, tzinfo=UTC)),
    ],
)
def test_requested_local_days_must_be_closed(day, closing_stamp):
    changes = {"local_dates": (day,), "timezone": "America/Toronto"}
    closed = replace(request(), as_of_utc=closing_stamp, **changes)
    assert closed.local_dates == (day,)
    with pytest.raises(ValueError, match="closed"):
        replace(closed, as_of_utc=closing_stamp - timedelta(microseconds=1))
    with pytest.raises(ValueError, match="closed"):
        replace(closed, local_dates=(day + timedelta(days=1),))


@pytest.mark.parametrize(
    "day,expected,expanded",
    [
        (
            date(2026, 11, 1),
            ("2026-11-01", "2026-11-02"),
            ("2026-10-31", "2026-11-01", "2026-11-02", "2026-11-03"),
        ),
        (
            date(2026, 3, 8),
            ("2026-03-08", "2026-03-09"),
            ("2026-03-07", "2026-03-08", "2026-03-09", "2026-03-10"),
        ),
    ],
)
def test_utc_days_cover_dst_days_and_declared_offsets(day, expected, expanded):
    from transit_ops.batch.build import utc_days

    local = replace(request(), local_dates=(day,), timezone="America/Toronto")
    assert utc_days(local) == expected
    assert utc_days(local, lookback_days=1, after_days=1) == expanded
    utc = replace(local, timezone="UTC")
    assert utc_days(utc) == (day.isoformat(),)
    for offsets in [{"lookback_days": -1}, {"after_days": -1}, {"after_days": 1.5}]:
        with pytest.raises(ValueError, match="offset"):
            utc_days(local, **offsets)


@pytest.mark.parametrize("outside", [False, True])
def test_hardlinked_other_window_is_refused(tmp_path, outside):
    root = tmp_path / "inputs"
    target_root = tmp_path / "outside" if outside else root / "gold.toy"
    target = parquet(target_root / "2026-11-02.parquet", 999)
    declared = root / "gold.toy" / "2026-11-01.parquet"
    declared.parent.mkdir(parents=True, exist_ok=True)
    os.link(target, declared)
    assert declared.samefile(target) and declared.stat().st_nlink > 1
    with pytest.raises(InputRefused, match="gold.toy.*2026-11-01"):
        resolve_inputs((InputNeed("gold.toy", "2026-11-01"),), root)


@pytest.mark.parametrize(
    "zone,day,expanded",
    [
        ("Pacific/Apia", "2011-12-30", ("2011-12-29", "2011-12-30", "2011-12-31")),
        ("Pacific/Kwajalein", "1993-08-21", ("1993-08-20", "1993-08-21", "1993-08-22")),
        ("Pacific/Kiritimati", "1994-12-31", ("1994-12-30", "1994-12-31", "1995-01-01")),
    ],
)
def test_skipped_local_date_contributes_only_expanded_intervals(zone, day, expanded):
    from transit_ops.batch.build import utc_days

    local = replace(request(), timezone=zone, local_dates=(date.fromisoformat(day),))
    assert utc_days(local) == ()
    assert utc_days(local, lookback_days=1) == expanded[:2]
    assert utc_days(local, after_days=1) == expanded[1:]
    assert utc_days(local, lookback_days=1, after_days=1) == expanded
