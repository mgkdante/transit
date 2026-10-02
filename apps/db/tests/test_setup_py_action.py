from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
ACTION = REPO_ROOT / ".github/actions/setup-py/action.yml"
WORKFLOWS = REPO_ROOT / ".github/workflows"
SETUP_ACTION = "./.github/actions/setup-py"
EXPECTED_CALLERS = {
    ("ci.yml", "offline-tests-work"),
    ("ci.yml", "alembic-single-head-work"),
    ("ci.yml", "real-db-tests-work"),
    ("daily-static-pipeline.yml", "run-static-pipeline"),
    ("daily-warm-rollups.yml", "prepare"),
    ("daily-warm-rollups.yml", "rollups"),
    ("daily-warm-rollups.yml", "publish"),
    ("daily-warm-rollups.yml", "retention"),
    ("freshness-probe.yml", "backup-freshness"),
    ("historic-publish-recovery.yml", "publish-historic-recovery"),
    ("historic-snapshot-gc.yml", "mark"),
}


def test_setup_py_composite_pins_the_folded_setup_contract() -> None:
    doc = yaml.safe_load(ACTION.read_text(encoding="utf-8"))
    assert doc["runs"]["using"] == "composite"
    assert doc["inputs"]["working-directory"]["default"] == "apps/db"
    assert doc["inputs"]["working-directory"]["required"] is False
    assert set(doc["inputs"]) == {"working-directory"}
    steps = doc["runs"]["steps"]
    assert len(steps) == 4
    assert (
        steps[0]["uses"]
        == "actions/setup-python@5fda3b95a4ea91299a34e894583c3862153e4b97"
    )
    assert steps[0]["with"] == {"python-version-file": ".python-version"}
    assert (
        steps[1]["uses"]
        == "astral-sh/setup-uv@c771a70e6277c0a99b617c7a806ffedaca235ff9"
    )
    assert steps[1]["with"] == {"version": "0.11.15"}
    assert steps[2] == {
        "name": "Install project dependencies",
        "shell": "bash",
        "working-directory": "${{ inputs.working-directory }}",
        "run": "uv sync --locked",
    }
    assert steps[3] == {
        "name": "Verify Python toolchain",
        "shell": "bash",
        "working-directory": "${{ inputs.working-directory }}",
        "run": (
            "set -euo pipefail\n"
            "uv run python --version\n"
            "uv run python -c 'import sys; raise SystemExit(sys.version_info[:2] != (3, 12))'\n"
            'test "$(uv --version | cut -d\' \' -f1,2)" = "uv 0.11.15"\n'
        ),
    }


def test_python_minor_line_is_selected_and_proved_by_ci() -> None:
    assert (REPO_ROOT / ".python-version").read_text(encoding="utf-8") == "3.12\n"

    workflow = yaml.safe_load((WORKFLOWS / "ci.yml").read_text(encoding="utf-8"))
    on = workflow.get("on", workflow.get(True, {}))
    assert ".python-version" in on["push"]["paths"]

    classifier = next(
        step for step in workflow["jobs"]["classify"]["steps"] if step.get("id") == "classify"
    )
    assert '".python-version"' in classifier["with"]["rules-json"]


def test_setup_py_composite_has_the_exact_workflow_job_map() -> None:
    calls: list[tuple[tuple[str, str], list[dict], int]] = []
    for workflow in WORKFLOWS.glob("*.yml"):
        document = yaml.safe_load(workflow.read_text(encoding="utf-8"))
        for job_name, job in document["jobs"].items():
            steps = job.get("steps", [])
            calls.extend(
                ((workflow.name, job_name), steps, index)
                for index, step in enumerate(steps)
                if step.get("uses") == SETUP_ACTION
            )

    assert {caller for caller, _, _ in calls} == EXPECTED_CALLERS
    assert len(calls) == len(EXPECTED_CALLERS)
    for caller, steps, setup_index in calls:
        setup = steps[setup_index]
        assert "with" not in setup
        if caller == ("historic-snapshot-gc.yml", "mark"):
            assert str(steps[setup_index - 2].get("uses", "")).startswith(
                "actions/checkout@"
            )
            assert steps[setup_index - 1].get("name") == "Initialize provider receipts"
        else:
            assert str(steps[setup_index - 1].get("uses", "")).startswith(
                "actions/checkout@"
            )

    rendered = "\n".join(
        path.read_text(encoding="utf-8")
        for path in WORKFLOWS.rglob("*")
        if path.is_file()
    )
    assert "actions/setup-python@" not in rendered
    assert "astral-sh/setup-uv@" not in rendered
    assert "uv sync --locked" not in rendered
