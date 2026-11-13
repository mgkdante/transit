from dataclasses import FrozenInstanceError, replace
from datetime import date

import pytest

from transit_ops.history import datasets as d


def table(dataset_id="table", **changes):
    entry = d.HistoryDataset(
        dataset_id,
        d.TableSource("gold.example", "day", ("id",), None, 0),
        "month",
        None,
        (),
        1,
    )
    return replace(entry, **changes)


def working(dataset_id="working", tables=("silver.example",)):
    return d.WorkingOnly(dataset_id, tables, "Decoded working rows", ("table",))


def test_a_table_is_declared_at_most_once():
    first = table()
    for datasets, working_only in [
        ({"table": first, "other": table("other")}, {}),
        ({"table": first}, {"working": working(tables=("gold.example",))}),
        ({}, {"working": working(tables=("gold.example", "gold.example"))}),
        ({}, {"one": working("one", ("gold.example",)), "two": working("two", ("gold.example",))}),
    ]:
        with pytest.raises(d.InvalidDeclaration, match="gold.example"):
            d.validate_declarations(datasets, working_only)
    d.validate_declarations(d.HISTORY_DATASETS, d.WORKING_ONLY)


@pytest.mark.parametrize(
    "key,family,fact",
    [
        ("trip_updates", "realtime_snapshot", "gold.fact_trip_delay_snapshot"),
        ("vehicle_positions", "realtime_snapshot", "gold.fact_vehicle_snapshot"),
        ("i3_alerts", "alert_snapshot", None),
        ("service_alerts", "alert_snapshot", None),
    ],
)
def test_capture_datasets_declare_their_index_family(key, family, fact):
    dataset = d.get_dataset("capture." + key)
    assert dataset == d.HistoryDataset(
        "capture." + key, d.CaptureSource(key, family, fact), "utc_day", 16, (), 1, ()
    )
    assert dataset.source.index_family == family


def test_declaration_rules_accept_valid_entries():
    base = table()
    capture = d.HistoryDataset(
        "capture.feed",
        d.CaptureSource("feed", "alert_snapshot", None),
        "utc_day",
        1,
        (),
        1,
    )
    object_entry = table(source=d.ObjectSource("static_schedule"), archive_grain="edition")
    accepted = [
        base,
        capture,
        object_entry,
        table(source=replace(base.source, window_column=None)),
        table(
            archive_grain="service_day",
            hot_days=2,
            schema_version=2,
            folds=(d.Fold("month_file", "month"), d.Fold("year_file", "year")),
        ),
        table(rebuild_needs=("working",)),
    ]
    for entry in accepted:
        d.validate_declarations({entry.dataset_id: entry}, {"working": working()})


def test_every_declaration_rule_is_checked():
    base = table()
    capture = d.HistoryDataset(
        "capture.feed", d.CaptureSource("feed", "alert_snapshot", None), "utc_day", 1, (), 1
    )
    object_entry = table(source=d.ObjectSource("static_schedule"), archive_grain="edition")
    cases = [
        ({"wrong": base}, {}, "wrong"),
        ({}, {"wrong": working()}, "wrong"),
        ({"table": base}, {"table": working("table")}, "table"),
        ({"table": table(source=capture.source)}, {}, "table"),
        ({capture.dataset_id: replace(capture, archive_grain="month")}, {}, "capture.feed"),
        ({"table": replace(object_entry, archive_grain="month")}, {}, "table"),
    ]
    invalid = [
        table(source=replace(base.source, key_columns=())),
        table(source=replace(base.source, fixed_revision=-1)),
        table(source=replace(base.source, window_column=None), archive_grain="utc_day"),
        *(table(hot_days=value) for value in (0, -1, 1.5, True)),
        table(schema_version=0),
        table(folds=(d.Fold("same", "month"), d.Fold("same", "year"))),
        table(rebuild_needs=("missing",)),
        table(rebuild_needs=("table",)),
    ]
    cases.extend(({"table": entry}, {}, "table") for entry in invalid)
    for datasets, working_only, name in cases:
        with pytest.raises(d.InvalidDeclaration, match=name):
            d.validate_declarations(datasets, working_only)
    d.validate_declarations(
        {"table": table(rebuild_needs=("capture.feed",)), "capture.feed": capture}, {}
    )


@pytest.mark.parametrize(
    "grain,key,expected",
    [
        ("utc_day", "2026-11-01", date(2026, 11, 1)),
        ("service_day", "2024-02-29", date(2024, 2, 29)),
        ("month", "2026-11", date(2026, 11, 1)),
        ("edition", "abcdef0123456789" * 4, None),
    ],
)
def test_window_key_must_fit_the_archive_grain(grain, key, expected):
    dataset = table(archive_grain=grain)
    assert d.window_start(dataset, key) == expected
    bad = {
        "utc_day": ["2026-02-30", "2026-11-1", "20261101", "0000-01-01"],
        "service_day": ["2026-02-30", "2026-11-1", "2026-11-01\n"],
        "month": ["2026-13", "2026-00", "2026-1", "2026-11-01", "0000-01"],
        "edition": ["A" * 64, "a" * 63, "g" * 64, "a" * 65],
    }
    for invalid in bad[grain]:
        with pytest.raises(ValueError) as error:
            d.window_start(dataset, invalid)
        assert invalid in str(error.value)
        assert grain in str(error.value)


def test_undeclared_dataset_is_refused_by_name(monkeypatch):
    monkeypatch.setattr(d, "WORKING_ONLY", {"working": working()})
    for key in ("capture.unknown", "working"):
        with pytest.raises(d.UndeclaredDataset, match=key):
            d.get_dataset(key)
    monkeypatch.setattr(d, "HISTORY_DATASETS", {"table": table()})
    assert d.get_dataset("table") == table()


def test_registries_are_read_only():
    with pytest.raises(TypeError):
        d.HISTORY_DATASETS["table"] = table()
    with pytest.raises(TypeError):
        d.WORKING_ONLY["working"] = working()
    for entry in (
        table(),
        working(),
        d.CaptureSource("feed", "alert_snapshot", None),
        table().source,
        d.ObjectSource("static_schedule"),
        d.Fold("file", "month"),
    ):
        with pytest.raises(FrozenInstanceError):
            entry.new_field = "changed"
