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
