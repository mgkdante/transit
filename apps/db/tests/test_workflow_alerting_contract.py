"""Contract tests for the alerting workflows (slice-9.1.1o).

The probe workflow (.github/workflows/freshness-probe.yml) and the three cron
workflows must wire the alert plane correctly: issues:write permission, the
15-min schedule, both secrets, no uv setup on the probe, and failure/recovery
steps on the crons. These parse the YAML and assert the contract — they are
the only offline gate on the workflow wiring (CI has no way to run a scheduled
workflow against itself).
"""

from __future__ import annotations

from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = REPO_ROOT / ".github" / "workflows"

PROBE = WORKFLOWS / "freshness-probe.yml"
CRON_WORKFLOWS = {
    "daily-static-pipeline.yml": "daily-static-pipeline",
    "daily-warm-rollups.yml": "daily-warm-rollups",
    "weekly-pg-repack.yml": "weekly-pg-repack",
}


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _raw(path: Path) -> str:
    return path.read_text(encoding="utf-8")


def _on_block(doc: dict) -> dict:
    # PyYAML parses the bare key `on:` as the boolean True.
    return doc.get("on", doc.get(True, {}))


def _steps(doc: dict) -> list[dict]:
    jobs = doc["jobs"]
    job = next(iter(jobs.values()))
    return job["steps"]


# --- freshness-probe.yml -----------------------------------------------------


def test_freshness_probe_workflow_schedule_permissions_and_secrets() -> None:
    doc = _load(PROBE)

    on = _on_block(doc)
    crons = [entry["cron"] for entry in on["schedule"]]
    assert "*/15 * * * *" in crons
    assert "workflow_dispatch" in on

    assert doc["permissions"]["contents"] == "read"
    assert doc["permissions"]["issues"] == "write"

    raw = _raw(PROBE)
    # The bare-bash `probe` job stays dependency-light (curl/jq/psql, no python).
    # Scope the no-uv assertion to that job's step block, NOT the whole file: the
    # sibling `backup-freshness` job legitimately needs the python CLI to read R2
    # (the pg_dump runs as a VM cron, so its artifact has no other GHA watcher).
    probe_steps = yaml.safe_dump(doc["jobs"]["probe"]["steps"])
    assert "uv sync" not in probe_steps
    assert "astral-sh/setup-uv" not in probe_steps
    assert "setup-python" not in probe_steps

    # Both secrets wired + the script invoked.
    assert "secrets.DATABASE_URL" in raw
    assert "secrets.SNAPSHOT_PUBLIC_BASE_URL" in raw
    assert ".github/scripts/freshness-probe.sh" in raw
    # github.token + repository passed for the gh CLI inside the script.
    assert "github.token" in raw
    assert "github.repository" in raw

    # The backup-freshness job fires/resolves the 'backup' alert and runs the CLI.
    # Concatenate the parsed `run` blocks (not a YAML re-dump, which re-wraps long
    # shell lines and would split substrings like "fire backup").
    backup_runs = "\n".join(
        str(step.get("run", "")) for step in doc["jobs"]["backup-freshness"]["steps"]
    )
    assert "verify-backup-freshness" in backup_runs
    assert "fire backup" in backup_runs
    assert "resolve backup" in backup_runs


# --- cron workflows ----------------------------------------------------------


def test_cron_workflows_carry_issues_write_permission() -> None:
    for filename in CRON_WORKFLOWS:
        doc = _load(WORKFLOWS / filename)
        perms = doc["permissions"]
        assert perms["contents"] == "read", filename
        assert perms["issues"] == "write", filename


def test_cron_workflows_carry_failure_and_recovery_alert_steps() -> None:
    for filename, slug in CRON_WORKFLOWS.items():
        path = WORKFLOWS / filename
        doc = _load(path)
        if filename == "daily-warm-rollups.yml":
            notify = doc["jobs"]["notify"]
            assert set(notify["needs"]) == {"prepare", "rollups", "publish", "retention"}
            assert notify["if"] == "always()"
            notify_steps = notify["steps"]
            alert_steps = [
                step for step in notify_steps if "alert-issue.sh" in str(step.get("run", ""))
            ]
            assert len(alert_steps) == 1
            alert_step = alert_steps[0]
            assert f"fire {slug}" in alert_step["run"]
            assert f"resolve {slug}" in alert_step["run"]
            assert "PREPARE_RESULT" in alert_step["env"]
            assert "ROLLUPS_RESULT" in alert_step["env"]
            assert "PUBLISH_RESULT" in alert_step["env"]
            assert "RETENTION_RESULT" in alert_step["env"]
            assert "GH_TOKEN" in alert_step["env"]
            assert "GH_REPO" in alert_step["env"]
            continue
        steps = _steps(doc)

        failure_steps = [
            s
            for s in steps
            if isinstance(s.get("if"), str)
            and "failure()" in s["if"]
            and "alert-issue.sh" in (s.get("run", ""))
        ]
        success_steps = [
            s
            for s in steps
            if isinstance(s.get("if"), str)
            and "success()" in s["if"]
            and "alert-issue.sh" in (s.get("run", ""))
        ]
        assert len(failure_steps) == 1, f"{filename}: expected one failure() alert step"
        assert len(success_steps) == 1, f"{filename}: expected one success() alert step"

        # The failure step fires this workflow's slug; the success step resolves it.
        assert f"fire {slug}" in failure_steps[0]["run"], filename
        assert f"resolve {slug}" in success_steps[0]["run"], filename

        raw_step = failure_steps[0]["run"] + success_steps[0]["run"]
        # Path is relative to working-directory: db -> ../.github/scripts on the
        # first two; pg-repack also uses working-directory: db.
        assert "alert-issue.sh" in raw_step

        # Both alert steps must carry GH_TOKEN + GH_REPO env.
        for step in (failure_steps[0], success_steps[0]):
            env = step.get("env", {})
            assert "GH_TOKEN" in env, f"{filename}: alert step missing GH_TOKEN"
            assert "GH_REPO" in env, f"{filename}: alert step missing GH_REPO"
