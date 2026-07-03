"""Migration-source assertions for 0078_publish_state_gate_telemetry (S11).

Clones test_migration_0077. Asserts the additive nullable gate-telemetry columns
on core.snapshot_publish_state + a clean chain + a symmetric downgrade.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path


def _migration_path() -> Path:
    return (
        Path(__file__).resolve().parents[1]
        / "src/transit_ops/db/migrations/versions/0078_publish_state_gate_telemetry.py"
    )


def _source() -> str:
    path = _migration_path()
    assert path.exists(), "expected migration 0078_publish_state_gate_telemetry.py"
    return path.read_text(encoding="utf-8")


def _load():
    path = _migration_path()
    spec = importlib.util.spec_from_file_location("m0078", path)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


def test_0078_chain() -> None:
    m = _load()
    assert m.revision == "0078_publish_state_gate_telemetry"
    assert m.down_revision == "0077_alert_active_periods_and_url"
    assert m.branch_labels is None
    assert callable(m.upgrade)
    assert callable(m.downgrade)


def test_0078_adds_five_additive_nullable_gate_columns() -> None:
    src = _source()
    # int counts.
    for col in ("gate_checks_run", "gate_errors", "gate_warnings"):
        assert f'sa.Column("{col}", sa.Integer(), nullable=True)' in src, f"{col} missing"
    # text verdict.
    assert 'sa.Column("gate_verdict", sa.Text(), nullable=True)' in src
    # timestamptz gate stamp.
    assert (
        'sa.Column("gate_generated_utc", sa.DateTime(timezone=True), nullable=True)' in src
    )
    # additive columns on the EXISTING table, in the core schema.
    assert 'op.add_column(\n        "snapshot_publish_state"' in src
    assert 'schema="core"' in src
    # honest-NULL: NO server_default kwarg on any gate column (absence must be honest,
    # never a fabricated 0/pass default).
    assert "server_default=" not in src


def test_0078_downgrade_drops_all_five_columns() -> None:
    src = _source()
    for col in (
        "gate_checks_run",
        "gate_errors",
        "gate_warnings",
        "gate_verdict",
        "gate_generated_utc",
    ):
        assert f'op.drop_column("snapshot_publish_state", "{col}"' in src, f"{col} not dropped"
