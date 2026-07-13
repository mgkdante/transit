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
