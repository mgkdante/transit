import json

import pytest

from transit_ops.live.compare import Difference, compare_publications


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
