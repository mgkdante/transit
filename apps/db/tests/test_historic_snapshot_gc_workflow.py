from __future__ import annotations

from pathlib import Path

import yaml

WORKFLOW = Path(__file__).parents[3] / ".github/workflows/historic-snapshot-gc.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def test_historic_gc_workflow_is_weekly_and_mark_only_by_default() -> None:
    workflow = _workflow()
    triggers = workflow[True]

    assert triggers["schedule"]
    mode = triggers["workflow_dispatch"]["inputs"]["mode"]
    assert mode["default"] == "mark"
    assert mode["options"] == ["dry-run", "mark"]
    assert "apply" not in WORKFLOW.read_text(encoding="utf-8")


def test_historic_gc_workflow_serializes_with_publication_and_keeps_provider_receipts() -> None:
    workflow = _workflow()
    assert workflow["concurrency"] == {
        "group": "daily-warm-rollups",
        "cancel-in-progress": False,
    }
    job = workflow["jobs"]["mark"]
    assert job["timeout-minutes"] == 100
    assert job["strategy"]["max-parallel"] == 1
    assert "provider" in job["strategy"]["matrix"]
    assert job["env"]["BRONZE_S3_BUCKET"] == "transit-raw"
    assert job["env"]["BRONZE_S3_REGION"] == "auto"
    rendered = WORKFLOW.read_text(encoding="utf-8")
    assert rendered.index("Initialize provider receipt") < rendered.index(
        "Apply database migrations"
    )
    assert '"phase":"preflight"' in rendered
    assert 'timeout_limit="90m"' in rendered
    assert 'timeout --signal=TERM "$timeout_limit"' in rendered
    assert "gc-historic-snapshots" in rendered
    assert "--report-path" in rendered
    assert "actions/upload-artifact" in rendered
    assert "if: always()" in rendered


def test_historic_gc_workflow_rewrites_only_scan_timeout_receipts() -> None:
    workflow = _workflow()
    scan_step = next(
        step
        for step in workflow["jobs"]["mark"]["steps"]
        if step.get("name") == "Scan and mark unreachable generations"
    )
    script = scan_step["run"]

    assert "set +e" in script
    assert 'scan_status="$?"' in script
    assert "set -e" in script
    assert '[[ "$scan_status" -eq 124 || "$scan_status" -eq 143 ]]' in script
    assert '"status":"fail"' in script
    assert '"phase":"scan"' in script
    assert '"failure_type":"timeout"' in script
    assert '"timeout_limit":"%s"' in script
    assert 'exit "$scan_status"' in script
    timeout_guard = 'if [[ "$scan_status" -eq 124 || "$scan_status" -eq 143 ]]; then'
    assert script.index(timeout_guard) < script.index("printf '") < script.index("\nfi\n")
    assert script.count('> "$report_path"') == 1
