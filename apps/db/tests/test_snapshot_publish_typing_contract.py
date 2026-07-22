from __future__ import annotations

import ast
import tomllib
from pathlib import Path

DB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = DB_ROOT.parents[1]
PUBLISH_PATH = DB_ROOT / "src/transit_ops/snapshots/publish.py"
PROTOCOLS_PATH = DB_ROOT / "src/transit_ops/snapshots/protocols.py"


def test_publish_module_has_no_type_suppressions_or_loc_growth() -> None:
    source = PUBLISH_PATH.read_text(encoding="utf-8")

    assert "# type: ignore" not in source
    assert len(source.splitlines()) <= 2_670


def test_snapshot_writer_protocols_have_neutral_bounded_ownership() -> None:
    assert PROTOCOLS_PATH.is_file()
    source = PROTOCOLS_PATH.read_text(encoding="utf-8")
    tree = ast.parse(source)
    classes = {node.name for node in tree.body if isinstance(node, ast.ClassDef)}

    assert classes == {"SnapshotOutcomeWriter", "SnapshotWriter"}
    assert len(source.splitlines()) <= 30
    assert "transit_ops.snapshots.publish" not in source
    assert "transit_ops.snapshots.storage" not in source
    assert "transit_ops.settings" not in source
    assert "sqlalchemy" not in source


def test_snapshot_writer_runtime_protocol_accepts_the_publish_collector() -> None:
    from transit_ops.snapshots.protocols import SnapshotWriter
    from transit_ops.snapshots.publish import _CollectingStorage

    assert isinstance(_CollectingStorage(), SnapshotWriter)


def test_ci_runs_the_scoped_mypy_publish_contract() -> None:
    project = tomllib.loads((DB_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    dev_dependencies = project["dependency-groups"]["dev"]
    mypy = project["tool"]["mypy"]
    workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert any(dependency.startswith("mypy>=") for dependency in dev_dependencies)
    assert mypy == {
        "python_version": "3.12",
        "files": ["src/transit_ops/snapshots/publish.py"],
        "follow_imports": "silent",
        "strict": True,
        "warn_unused_ignores": True,
        "disallow_any_generics": True,
        "check_untyped_defs": True,
        "show_error_codes": True,
    }
    assert "uv run mypy src/transit_ops/snapshots/publish.py" in workflow
