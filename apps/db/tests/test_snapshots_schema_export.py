import json
import pathlib

from transit_ops.snapshots.contract import export_schemas


def test_committed_schemas_match_models():
    base = pathlib.Path(__file__).resolve().parents[1] / "src/transit_ops/snapshots/schemas"
    for name, schema in export_schemas().items():
        committed = json.loads((base / f"{name}.schema.json").read_text())
        assert committed == schema, f"{name}: re-run scripts/export_snapshot_schemas.py"


def test_shared_history_schema_families_are_exported():
    exported = export_schemas()
    assert "historic_collection_index" in exported
    assert "historic_availability_index" in exported
    assert "historic_entity_directory_index" in exported
    assert "historic_network_history_partition" in exported
    assert "historic_line_history_partition" in exported
    assert "historic_stop_history_partition" in exported
    assert "historic_hotspots_day" in exported
    assert "historic_repeat_offenders_day" in exported


def test_revision_2_schemas_differ_only_by_the_allowlist():
    from revision_2_allowlist import compare_schemas_with_baseline

    base = pathlib.Path(__file__).parent / "fixtures/revision_2_baseline/schemas"
    baseline = {
        p.name.removesuffix(".schema.json"): json.loads(p.read_text())
        for p in base.glob("*.schema.json")
    }
    assert baseline
    assert compare_schemas_with_baseline(baseline, export_schemas()) == []


def test_schema_guard_refuses_an_unlisted_property():
    from copy import deepcopy

    from revision_2_allowlist import compare_schemas_with_baseline

    baseline = export_schemas()
    changed = deepcopy(baseline)
    changed["live_trips"]["$defs"]["Trip"]["properties"]["foo"] = {"type": "string"}
    changed["static_routes_index"]["$defs"]["RouteIndexEntry"]["properties"]["live_data"] = {
        "type": "boolean"
    }
    changed["static_routes_index"]["$defs"]["RouteIndexEntry"]["required"].append("live_data")
    problems = compare_schemas_with_baseline(baseline, changed)
    assert any("live_trips" in p and "foo" in p for p in problems)
    assert any("static_routes_index" in p and "live_data" in p for p in problems)


def test_schema_guard_accepts_only_optional_additions_and_their_definitions():
    from copy import deepcopy

    from revision_2_allowlist import compare_schemas_with_baseline

    baseline = export_schemas()
    changed = deepcopy(baseline)
    trip = changed["live_trips"]["$defs"]["Trip"]["properties"]
    trip["headsign"] = {"type": "string"}
    trip["r3"] = {"anyOf": [{"$ref": "#/$defs/NewTrip"}, {"type": "null"}]}
    changed["live_trips"]["$defs"]["NewTrip"] = {"$ref": "#/$defs/NewNested"}
    changed["live_trips"]["$defs"]["NewNested"] = {"type": "object"}
    for name, model, fields in (
        ("static_routes_index", "RouteIndexEntry", ("live_data", "r3")),
        ("static_stops_index", "StopIndexEntry", ("r3",)),
        ("static_stop", None, ("wheelchair_boarding",)),
        ("static_route", None, ("r3",)),
        ("live_trips", "Trip", ("direction_id", "first_departure", "first_departure_seconds")),
        ("live_vehicles", "Vehicle", ("r3",)),
        ("live_network", None, ("r3",)),
        ("live_alerts", "Alert", ("r3",)),
        (
            "manifest",
            "ManifestHistoricFiles",
            ("data_through", "published_utc", "next_publish_utc"),
        ),
    ):
        node = changed[name]["$defs"][model] if model else changed[name]
        node["properties"].update({field: {"type": "string"} for field in fields})
    changed["capabilities"] = {"type": "object"}
    assert compare_schemas_with_baseline(baseline, changed) == []
    assert "r3" in trip  # The comparison must not mutate its inputs.
    changed["live_trips"]["$defs"]["Unused"] = {"type": "object"}
    assert any("Unused" in p for p in compare_schemas_with_baseline(baseline, changed))
    del changed["live_trips"]["$defs"]["Unused"]
    changed["live_trips"]["properties"]["r3"] = {"$ref": "#/$defs/NewTrip"}
    assert any("properties.r3" in p for p in compare_schemas_with_baseline(baseline, changed))


def test_schema_guard_preserves_existing_constraints_and_schema_membership():
    from copy import deepcopy

    from revision_2_allowlist import compare_schemas_with_baseline

    baseline = export_schemas()
    changed = deepcopy(baseline)
    changed["live_trips"]["$defs"]["Trip"]["properties"]["route"]["type"] = "integer"
    del changed["provenance"]
    changed["surprise"] = {"type": "object"}
    problems = compare_schemas_with_baseline(baseline, changed)
    assert any("Trip.properties.route.type" in p for p in problems)
    assert any("provenance" in p and "missing" in p for p in problems)
    assert any("surprise" in p and "unlisted" in p for p in problems)
