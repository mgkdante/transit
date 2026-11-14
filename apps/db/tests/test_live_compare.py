import hashlib
import json
from datetime import UTC, date, datetime, timedelta, timezone
from decimal import Decimal

import pytest

from transit_ops.live.compare import (
    Difference,
    canonical_row,
    canonical_value,
    compare_publications,
    compare_rows,
    rows_digest,
)
from transit_ops.snapshots.contract import DataHealth, DataHealthFeed, LaneHealth, NetworkFile


def payload(value: object) -> bytes:
    return json.dumps(value, separators=(",", ":")).encode()


def test_identical_publications_have_no_difference():
    files = {"live/trips.json": b'{"trips":{}}'}
    assert compare_publications(files, files) == []


def test_missing_and_extra_files_are_reported():
    assert compare_publications({"missing": b"{}"}, {"extra": b"null"}) == [
        Difference("missing", "<bytes>", "{}", "<absent>"),
        Difference("extra", "<bytes>", "<absent>", "null"),
    ]


def test_a_changed_leaf_is_reported_at_its_path():
    before = {"trips": {"123": {"stops": [{}, {}, {"eta_utc": "old", "delay_min": 1}]}}}
    after = {"trips": {"123": {"stops": [{}, {}, {"eta_utc": "new", "delay_min": 2}]}}}
    assert compare_publications({"trips": payload(before)}, {"trips": payload(after)}) == [
        Difference("trips", "trips.123.stops[2].eta_utc", '"old"', '"new"'),
        Difference("trips", "trips.123.stops[2].delay_min", "1", "2"),
    ]


@pytest.mark.parametrize(
    "before,after",
    [(b'{"a":1.0}', b'{"a":1}'), (b'{"a":1,"b":2}', b'{"b":2,"a":1}'), (b'{"a":1}', b'{ "a":1}')],
)
def test_equal_json_with_different_bytes_is_a_difference(before, after):
    assert compare_publications({"file": before}, {"file": after}) == [
        Difference("file", "<bytes>", before.decode(), after.decode())
    ]


def test_clock_projection_is_off_by_default_and_limited_to_clock_paths():
    before = {"files": {"live": {"generated_utc": "old"}}, "dataset_version": "v1"}
    after = {"files": {"live": {"generated_utc": "new"}}, "dataset_version": "v1"}
    expected, actual = {"manifest.json": payload(before)}, {"manifest.json": payload(after)}
    assert compare_publications(expected, actual) == [
        Difference("manifest.json", "files.live.generated_utc", '"old"', '"new"')
    ]
    assert compare_publications(expected, actual, project_clock=True) == []
    after["dataset_version"] = "v2"
    assert compare_publications(
        expected, {"manifest.json": payload(after)}, project_clock=True
    ) == [Difference("manifest.json", "dataset_version", '"v1"', '"v2"')]


@pytest.mark.parametrize(
    "key,before,after",
    [
        (
            "live/trips.json",
            {"generated_utc": "a", "publish_generation_id": "a"},
            {"generated_utc": "b", "publish_generation_id": "b"},
        ),
        (
            "manifest.json",
            {"files": {"live": {"generations": {"a": "old"}}}},
            {"files": {"live": {"generations": {"a": "new"}}}},
        ),
        (
            "status/data_health.json",
            {"lanes": [{"age_s": 1}], "feeds": [{"age_s": 2}]},
            {"lanes": [{"age_s": 3}], "feeds": [{"age_s": 4}]},
        ),
        ("live/network.json", {"feed_freshness_s": 1}, {"feed_freshness_s": 2}),
    ],
)
def test_each_clock_path_is_projected(key, before, after):
    assert (
        compare_publications({key: payload(before)}, {key: payload(after)}, project_clock=True)
        == []
    )


def test_projection_keeps_missing_fields_and_nonclock_bytes_different():
    for before, after in [
        (b'{"generated_utc":"a","x":1.0}', b'{"generated_utc":"b","x":1}'),
        (b'{"generated_utc":"a"}', b"{}"),
        (b'{"nested":{"generated_utc":"a"}}', b'{"nested":{"generated_utc":"b"}}'),
    ]:
        assert compare_publications({"file": before}, {"file": after}, project_clock=True)


def test_structure_changes_are_reported_in_document_order():
    before = payload({"z": None, "a": [1, 2], "gone": 4})
    after = payload({"z": False, "a": [3], "extra": 5})
    assert compare_publications({"file": before}, {"file": after}) == [
        Difference("file", "z", "null", "false"),
        Difference("file", "a[0]", "1", "3"),
        Difference("file", "a[1]", "2", "<absent>"),
        Difference("file", "a.length", "2", "1"),
        Difference("file", "gone", "4", "<absent>"),
        Difference("file", "extra", "<absent>", "5"),
    ]


def test_the_limit_caps_the_report():
    expected, actual = {"file": b'{"a":1,"b":2}'}, {"file": b'{"a":2,"b":3}'}
    assert compare_publications(expected, actual, limit=1) == [Difference("file", "a", "1", "2")]
    assert compare_publications(expected, actual, limit=0) == []


def test_byte_diagnostics_are_cut_to_200_characters():
    before, after = b'"' + b"a" * 250 + b'"', b' "' + b"a" * 250 + b'"'
    assert compare_publications({"file": before}, {"file": after}) == [
        Difference("file", "<bytes>", before.decode()[:200], after.decode()[:200])
    ]


@pytest.mark.parametrize("field", ["lane", "feed", "generation", "network"])
def test_projection_preserves_unknown_clock_values_in_public_models(field):
    health = DataHealth(
        generated_utc="stamp",
        lanes=[LaneHealth(lane="live")],
        feeds=[DataHealthFeed(feed="positions")],
    )
    before = health.model_dump(mode="json")
    after = health.model_dump(mode="json")
    key = "status/data_health.json"
    if field in ("lane", "feed"):
        after["lanes" if field == "lane" else "feeds"][0]["age_s"] = 0
    elif field == "generation":
        after["publish_generation_id"] = "generation"
    else:
        key = "live/network.json"
        network = NetworkFile(
            generated_utc="stamp",
            vehicles_in_service=0,
            on_time_pct=None,
            status_dist={},
            delay_p50_min=None,
            delay_p90_min=None,
            non_responding=0,
            feed_freshness_s=None,
            coverage_pct=None,
        )
        before = network.model_dump(mode="json")
        after = network.model_copy(update={"feed_freshness_s": 0}).model_dump(mode="json")
    assert compare_publications({key: payload(before)}, {key: payload(after)}, project_clock=True)
    assert compare_publications({key: payload(after)}, {key: payload(before)}, project_clock=True)


@pytest.mark.parametrize("invalid", [None, True, False, "0", "<clock>", {}, [], 0.0])
def test_projection_does_not_erase_invalid_age_types(invalid):
    assert compare_publications(
        {"live/network.json": payload({"feed_freshness_s": invalid})},
        {"live/network.json": b'{"feed_freshness_s":0}'},
        project_clock=True,
    )


@pytest.mark.parametrize("field", ["generated_utc", "publish_generation_id"])
@pytest.mark.parametrize("invalid", [None, 0, False, {}, []])
def test_projection_does_not_erase_invalid_stamp_types(field, invalid):
    assert compare_publications(
        {"file": payload({field: invalid})}, {"file": payload({field: "stamp"})}, project_clock=True
    )


@pytest.mark.parametrize("field", ["lanes", "feeds"])
def test_array_clock_wildcards_do_not_match_objects(field):
    assert compare_publications(
        {"status/data_health.json": payload({field: {"record": {"age_s": 1}}})},
        {"status/data_health.json": payload({field: {"record": {"age_s": 2}}})},
        project_clock=True,
    )


def test_generation_wildcard_requires_object_and_preserves_filename_keys():
    key = "manifest.json"
    for before, after, equal in [
        ({"live/trips.json": "old"}, {"live/trips.json": "new"}, True),
        (["old"], ["new"], False),
    ]:
        result = compare_publications(
            {key: payload({"files": {"live": {"generations": before}}})},
            {key: payload({"files": {"live": {"generations": after}}})},
            project_clock=True,
        )
        assert (result == []) is equal


def test_null_and_empty_string_differ():
    assert canonical_row([None, "", "null"]) == '[null,"","null"]'
    assert compare_rows("live", [0], [("a", None)], [("a", "")]) == [
        Difference("table:live", 'row ["a"]', '["a",null]', '["a",""]')
    ]


def test_doubles_compare_exactly():
    assert canonical_value(123.4000015258789) == "123.4000015258789"
    assert canonical_value(0.1 + 0.2) == "0.30000000000000004"
    assert compare_rows("live", [0], [(1, 0.1 + 0.2)], [(1, 0.3)]) == [
        Difference("table:live", "row [1]", "[1,0.30000000000000004]", "[1,0.3]")
    ]


@pytest.mark.parametrize("value", [float("nan"), float("inf"), float("-inf")])
def test_nonfinite_doubles_are_refused(value):
    with pytest.raises(ValueError):
        canonical_value(value)


def test_timestamps_compare_as_instants_with_microseconds():
    utc = datetime(2026, 1, 2, 12, 0, 0, 123456, UTC)
    offset = utc.astimezone(timezone(timedelta(hours=-5)))
    assert canonical_value(offset) == "2026-01-02T12:00:00.123456Z"
    assert canonical_value(date(2026, 1, 2)) == "2026-01-02"
    assert compare_rows("live", [0], [(1, utc)], [(1, offset)]) == []
    assert compare_rows("live", [0], [(1, utc)], [(1, utc + timedelta(microseconds=1))]) == [
        Difference(
            "table:live",
            "row [1]",
            "[1,2026-01-02T12:00:00.123456Z]",
            "[1,2026-01-02T12:00:00.123457Z]",
        )
    ]
    with pytest.raises(ValueError):
        canonical_value(datetime(2026, 1, 2))
    with pytest.raises(TypeError):
        canonical_value({1})


def test_decimal_keeps_scale():
    assert canonical_value(Decimal("120.00")) == "120.00"
    assert compare_rows("live", [0], [(1, Decimal("120.00"))], [(1, Decimal("120.0"))]) == [
        Difference("table:live", "row [1]", "[1,120.00]", "[1,120.0]")
    ]


def test_bool_is_not_int():
    assert canonical_value(False) == "false"
    assert compare_rows("live", [0], [(1, True)], [(1, 1)]) == [
        Difference("table:live", "row [1]", "[1,true]", "[1,1]")
    ]


def test_duplicate_rows_are_counted():
    assert compare_rows("live", [0], [(1, "a"), (1, "b")], [(1, "b"), (1, "a")]) == []
    assert compare_rows("live", [0], [(1, "a"), (1, "a")], [(1, "a")]) == [
        Difference("table:live", "row [1]", '[1,"a"]\n[1,"a"]', '[1,"a"]')
    ]
    assert compare_rows("live", [0], [(1, "a"), (1, "b")], [(1, "a"), (1, "c")]) == [
        Difference("table:live", "row [1]", '[1,"a"]\n[1,"b"]', '[1,"a"]\n[1,"c"]')
    ]


def test_missing_row_keys_and_composite_keys():
    assert compare_rows("live", [0, 1], [(1, "a", 2)], [(1, "b", 2)]) == [
        Difference("table:live", 'row [1,"a"]', '[1,"a",2]', "<absent>"),
        Difference("table:live", 'row [1,"b"]', "<absent>", '[1,"b",2]'),
    ]


def test_unicode_keys_sort_by_code_point():
    assert compare_rows("live", [0], [("é",), ("É",), ("Z",)], []) == [
        Difference("table:live", 'row ["Z"]', '["Z"]', "<absent>"),
        Difference("table:live", 'row ["É"]', '["É"]', "<absent>"),
        Difference("table:live", 'row ["é"]', '["é"]', "<absent>"),
    ]
    assert canonical_row(["é", "e\u0301", '"\n']) == '["é","é","\\"\\n"]'


def test_row_limit_caps_the_report():
    assert compare_rows("live", [0], [(2,), (1,)], [], limit=1) == [
        Difference("table:live", "row [1]", "[1]", "<absent>")
    ]
    assert compare_rows("live", [0], [(1,)], [], limit=0) == []


def test_digest_ignores_order_but_not_values():
    expected = hashlib.sha256(b'[1,"a"]\n[2,"b"]').hexdigest()
    assert rows_digest(iter([(2, "b"), (1, "a")])) == expected
    assert rows_digest([(1, "a"), (2, "b")]) == expected
    assert rows_digest([(1, "a"), (2, "c")]) != expected
    assert rows_digest([(1, "a"), (1, "a")]) != rows_digest([(1, "a")])
    assert rows_digest([]) == hashlib.sha256(b"").hexdigest()
