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
PROBE_SCRIPT = REPO_ROOT / ".github" / "scripts" / "freshness-probe.sh"
CRON_WORKFLOWS = {
    "daily-static-pipeline.yml": "daily-static-pipeline",
    "daily-warm-rollups.yml": "daily-warm-rollups",
    "weekly-pg-repack.yml": "weekly-pg-repack",
}
DAILY_NOTIFY_JOBS = {
    "daily-static-pipeline.yml": {"run-static-pipeline"},
    "daily-warm-rollups.yml": {"prepare", "rollups", "publish", "retention"},
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
    # Hourly lane for backup-freshness (the pg_dump artifact changes nightly;
    # 96x/day paid a python-toolchain setup per run for no signal).
    assert "7 * * * *" in crons
    assert "workflow_dispatch" in on

    # Cadence split: probe skips the hourly cron; backup-freshness runs ONLY on
    # the hourly cron (or manual dispatch). Without these gates both jobs run on
    # every tick and the recadence silently regresses.
    assert doc["jobs"]["probe"]["if"] == "github.event.schedule != '7 * * * *'"
    assert (
        doc["jobs"]["backup-freshness"]["if"]
        == "github.event_name == 'workflow_dispatch' || github.event.schedule == '7 * * * *'"
    )

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


def test_freshness_probe_pins_daily_heartbeat_age_contract() -> None:
    script = _raw(PROBE_SCRIPT)
    flat_script = " ".join(script.split())

    assert "DAILY_TIER_MAX_AGE_SECONDS=129600" in script
    assert "max(last_seen_at_utc)" in script
    assert (
        "FROM core.dataset_versions "
        "WHERE provider_id = '${PROVIDER_ID}' "
        "AND dataset_kind = 'static_schedule' "
        "AND is_current = true"
    ) in flat_script
    assert "max(updated_at_utc)" in script
    assert (
        "FROM core.snapshot_publish_state "
        "WHERE provider_id = '${PROVIDER_ID}' "
        "AND tier = 'historic'"
    ) in flat_script
    assert "static_heartbeat_age > DAILY_TIER_MAX_AGE_SECONDS" in script
    assert "historic_heartbeat_age > DAILY_TIER_MAX_AGE_SECONDS" in script
    assert 'check_manifest_age static "$DAILY_TIER_MAX_AGE_SECONDS"' not in script
    assert 'check_manifest_age historic "$DAILY_TIER_MAX_AGE_SECONDS"' not in script
    assert ".files.static.generated_utc" not in script
    assert ".files.historic.generated_utc" not in script


# --- cron workflows ----------------------------------------------------------


def test_cron_workflows_carry_issues_write_permission() -> None:
    for filename in CRON_WORKFLOWS:
        doc = _load(WORKFLOWS / filename)
        perms = doc["permissions"]
        assert perms["contents"] == "read", filename
        assert perms["issues"] == "write", filename


def test_daily_workflows_use_cancellation_safe_notify_jobs() -> None:
    for filename, expected_needs in DAILY_NOTIFY_JOBS.items():
        path = WORKFLOWS / filename
        doc = _load(path)
        slug = CRON_WORKFLOWS[filename]
        notify = doc["jobs"]["notify"]

        needs = notify["needs"]
        assert ({needs} if isinstance(needs, str) else set(needs)) == expected_needs
        assert notify["if"] == "always()"
        alert_steps = [
            step
            for step in notify["steps"]
            if "alert-issue.sh" in str(step.get("run", ""))
        ]
        assert len(alert_steps) == 1
        alert_step = alert_steps[0]
        assert f"fire {slug}" in alert_step["run"]
        assert f"resolve {slug}" in alert_step["run"]
        assert '== "success"' in alert_step["run"]
        assert "else" in alert_step["run"]
        assert "GH_TOKEN" in alert_step["env"]
        assert "GH_REPO" in alert_step["env"]

        for job_name, job in doc["jobs"].items():
            if job_name != "notify":
                assert "alert-issue.sh" not in str(job.get("steps", ""))

        result_expressions = {
            value
            for value in alert_step["env"].values()
            if isinstance(value, str) and value.startswith("${{ needs")
        }
        expected_result_expressions = set()
        for job in expected_needs:
            if "-" in job:
                expected_result_expressions.add("${{ needs['" + job + "'].result }}")
            else:
                expected_result_expressions.add(f"${{{{ needs.{job}.result }}}}")
        assert result_expressions == expected_result_expressions
        for variable in alert_step["env"]:
            if variable.endswith("_RESULT"):
                assert f'"${variable}"' in alert_step["run"]


def test_weekly_workflow_carries_failure_and_recovery_alert_steps() -> None:
    for filename in {"weekly-pg-repack.yml"}:
        slug = CRON_WORKFLOWS[filename]
        steps = _steps(_load(WORKFLOWS / filename))

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
