import json, pathlib
from transit_ops.snapshots.contract import export_schemas

OUT = pathlib.Path(__file__).resolve().parents[1] / "src/transit_ops/snapshots/schemas"
OUT.mkdir(parents=True, exist_ok=True)
for name, schema in export_schemas().items():
    (OUT / f"{name}.schema.json").write_text(json.dumps(schema, indent=2, sort_keys=True) + "\n")
print(f"wrote schemas to {OUT}")
