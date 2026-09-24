from __future__ import annotations

import ast
import tomllib
from pathlib import Path

DB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = DB_ROOT.parents[1]
PUBLISH_PATH = DB_ROOT / "src/transit_ops/snapshots/publish.py"
PROTOCOLS_PATH = DB_ROOT / "src/transit_ops/snapshots/protocols.py"


def test_publish_module_has_no_type_suppressions() -> None:
    source = PUBLISH_PATH.read_text(encoding="utf-8")

    assert "# type: ignore" not in source


def test_snapshot_writer_protocols_do_not_depend_on_adapters_or_application_configuration() -> None:
    assert PROTOCOLS_PATH.is_file()
    source = PROTOCOLS_PATH.read_text(encoding="utf-8")
    assert "transit_ops.snapshots.publish" not in source
    assert "transit_ops.snapshots.storage" not in source
    assert "transit_ops.settings" not in source
    assert "sqlalchemy" not in source


def test_payload_sink_accepts_collection_without_historic_capabilities() -> None:
    from transit_ops.snapshots.protocols import HistoricWriter, PayloadSink
    from transit_ops.snapshots.publish import _CollectingStorage

    assert isinstance(_CollectingStorage(), PayloadSink)
    assert not isinstance(_CollectingStorage(), HistoricWriter)


def test_ci_and_docs_use_the_configured_typing_scope() -> None:
    project = tomllib.loads((DB_ROOT / "pyproject.toml").read_text(encoding="utf-8"))
    dev_dependencies = project["dependency-groups"]["dev"]
    mypy = project["tool"]["mypy"]
    workflow = (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")

    assert any(dependency.startswith("mypy>=") for dependency in dev_dependencies)
    required_options = {
        "python_version": "3.12",
        "follow_imports": "silent",
        "strict": True,
        "warn_unused_ignores": True,
        "disallow_any_generics": True,
        "check_untyped_defs": True,
        "show_error_codes": True,
    }
    assert all(mypy.get(option) == value for option, value in required_options.items())
    assert not mypy.get("ignore_errors")
    assert not mypy.get("disable_error_code")
    required_targets = {
        "src/transit_ops/s3.py",
        "src/transit_ops/snapshots/publish.py",
        "src/transit_ops/snapshots/publication_lane.py",
        "src/transit_ops/snapshots/historic_streams.py",
        "src/transit_ops/snapshots/historic_graph.py",
        "src/transit_ops/snapshots/historic_tier.py",
        "src/transit_ops/snapshots/historic_compatibility.py",
        "src/transit_ops/snapshots/envelope.py",
        "src/transit_ops/snapshots/uploads.py",
        "src/transit_ops/snapshots/protocols.py",
        "src/transit_ops/snapshots/storage.py",
        "src/transit_ops/gold/reader",
        "src/transit_ops/gold/delay_sums.py",
        "src/transit_ops/gold/delay_periods.py",
        "src/transit_ops/gold/delay_hours.py",
        "src/transit_ops/gold/delay_cohorts.py",
        "src/transit_ops/gold/delay_days.py",
        "src/transit_ops/gold/transactions.py",
        "src/transit_ops/gold/realtime.py",
        "src/transit_ops/maintenance/_helpers.py",
        "src/transit_ops/maintenance/silver.py",
        "src/transit_ops/maintenance/bronze.py",
        "src/transit_ops/maintenance/i3.py",
    }
    targets = mypy["files"]
    assert required_targets <= set(targets)
    assert len(targets) == len(set(targets))
    assert all((DB_ROOT / target).exists() for target in targets)
    assert "run: uv run mypy\n" in workflow
    for path in (REPO_ROOT / "CONTRIBUTING.md", DB_ROOT / "README.md"):
        commands = path.read_text(encoding="utf-8").splitlines()
        assert [line.strip() for line in commands if line.strip().startswith("uv run mypy")] == [
            "uv run mypy"
        ]


def test_gold_reader_and_recovery_have_no_type_suppressions_or_any_annotations() -> None:
    for path in (
        DB_ROOT / "src/transit_ops/s3.py",
        DB_ROOT / "src/transit_ops/snapshots/historic_streams.py",
        DB_ROOT / "src/transit_ops/snapshots/historic_graph.py",
        DB_ROOT / "src/transit_ops/snapshots/historic_tier.py",
        DB_ROOT / "src/transit_ops/snapshots/historic_compatibility.py",
        DB_ROOT / "src/transit_ops/snapshots/envelope.py",
        DB_ROOT / "src/transit_ops/snapshots/uploads.py",
        *(DB_ROOT / "src/transit_ops/gold/reader").glob("*.py"),
        DB_ROOT / "src/transit_ops/gold/delay_sums.py",
        DB_ROOT / "src/transit_ops/gold/delay_periods.py",
        DB_ROOT / "src/transit_ops/gold/delay_hours.py",
        DB_ROOT / "src/transit_ops/gold/delay_cohorts.py",
        DB_ROOT / "src/transit_ops/gold/delay_days.py",
        DB_ROOT / "src/transit_ops/gold/transactions.py",
        DB_ROOT / "src/transit_ops/gold/realtime.py",
        DB_ROOT / "src/transit_ops/maintenance/_helpers.py",
        DB_ROOT / "src/transit_ops/maintenance/silver.py",
        DB_ROOT / "src/transit_ops/maintenance/bronze.py",
        DB_ROOT / "src/transit_ops/maintenance/i3.py",
    ):
        source = path.read_text(encoding="utf-8")
        assert "# type: ignore" not in source, path
        tree = ast.parse(source)
        assert not any(
            isinstance(node, ast.Name) and node.id == "Any" for node in ast.walk(tree)
        ), path
