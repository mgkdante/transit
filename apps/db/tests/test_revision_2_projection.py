from copy import deepcopy

import pytest
from revision_2_allowlist import FILE_RULES, compare_with_baseline, revision_2_projection


def test_a_listed_new_file_family_is_accepted_and_an_unlisted_one_fails():
    baseline = {"live/trips.json": b'{"trips":{}}'}
    allowed = {"status/capabilities.json": b'{"methodology_version":"capabilities-1"}'}
    assert compare_with_baseline(baseline, baseline | allowed) == []
    for extra in (
        {"status/capabilities.json": b'{"methodology_version":"wrong"}'},
        {"status/capabilities.json": b"{}"},
        {"status/other.json": b"{}"},
    ):
        assert len(compare_with_baseline(baseline, baseline | extra)) == 1
    assert compare_with_baseline(baseline, {}) == ["live/trips.json: missing baseline file"]
    assert compare_with_baseline(baseline, {"live/trips.json": b"{}"})


@pytest.mark.parametrize(
    "key,base,added",
    [
        (
            "static/routes_index.json",
            {"routes": [{"id": "x"}]},
            {"routes": [{"id": "x", "live_data": None, "r3": {"count": 4}}]},
        ),
        ("static/stops_index.json", {"stops": [{"id": "x"}]}, {"stops": [{"id": "x", "r3": {}}]}),
        ("static/stops/x.json", {"id": "x"}, {"id": "x", "wheelchair_boarding": None}),
        ("static/routes/x.json", {"id": "x"}, {"id": "x", "r3": {}}),
        (
            "live/trips.json",
            {"trips": {"x": {"stops": []}}},
            {
                "trips": {
                    "x": {
                        "stops": [],
                        "r3": {},
                        "headsign": None,
                        "direction_id": 0,
                        "first_departure": "25:00:00",
                        "first_departure_seconds": 90000,
                    }
                }
            },
        ),
        ("live/vehicles.json", {"vehicles": [{"id": "x"}]}, {"vehicles": [{"id": "x", "r3": {}}]}),
        ("live/network.json", {"value": None}, {"value": None, "r3": {}}),
        ("live/alerts.json", {"alerts": [{"id": "x"}]}, {"alerts": [{"id": "x", "r3": {}}]}),
        (
            "manifest.json",
            {"files": {"historic": {"ttl_s": 10}}},
            {
                "files": {
                    "historic": {
                        "ttl_s": 10,
                        "data_through": None,
                        "published_utc": "now",
                        "next_publish_utc": "later",
                    }
                }
            },
        ),
        ("historic/receipts/day.json", {"value": [2, 1]}, {"value": [2, 1]}),
        ("provenance.json", {"value": None}, {"value": None}),
        ("providers.json", {"providers": []}, {"providers": []}),
    ],
)
def test_projection_removes_exactly_the_allowlisted_additions(key, base, added):
    original = deepcopy(added)
    projected = revision_2_projection(key, added)
    assert projected == base
    assert added == original
    assert projected is not added


def test_projection_keeps_an_unlisted_flat_field():
    payload = {"headsign": "root", "trips": {"x": {"foo": 7, "headsign": "entry"}}}
    assert revision_2_projection("live/trips.json", payload) == {
        "headsign": "root",
        "trips": {"x": {"foo": 7}},
    }


@pytest.mark.parametrize(
    "key",
    [
        "historic/day.json",
        "providers.json",
        "unknown.json",
        "static/stops/x.json",
        "live/trips.json",
    ],
)
def test_projection_refuses_r3_where_the_table_does_not_allow_it(key):
    with pytest.raises(AssertionError, match=rf"{key}.*nested.r3"):
        revision_2_projection(key, {"nested": {"r3": {}}})


def test_every_file_rule_names_a_published_family():
    # Manifest paths and publish.py's static entity paths, plus the catalog writer.
    from transit_ops.snapshots.contract import ManifestHistoricFiles, ManifestStaticFiles

    known = {
        "manifest.json",
        "providers.json",
        "live/trips.json",
        "live/vehicles.json",
        "live/network.json",
        "live/alerts.json",
        "static/routes/{id}.json",
        "static/stops/{id}.json",
        "historic/**",
    }
    for model in (ManifestHistoricFiles, ManifestStaticFiles):
        known.update(
            field.default
            for field in model.model_fields.values()
            if isinstance(field.default, str) and field.default.endswith(".json")
        )
    assert all(rule.pattern in known for rule in FILE_RULES)
