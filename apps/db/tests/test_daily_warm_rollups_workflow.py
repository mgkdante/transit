import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DAILY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "daily-warm-rollups.yml"
RECOVERY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "historic-publish-recovery.yml"

SETUP_STEP_NAMES = [
    "Check out repository",
    "Set up Python",
    "Set up uv",
    "Install project dependencies",
]


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on_block(document: dict) -> dict:
    return document.get("on", document.get(True, {}))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def _run_step(
    job: dict,
    name: str,
    *,
    cwd: Path,
    environment: dict[str, str],
    replacements: dict[str, str] | None = None,
) -> subprocess.CompletedProcess[str]:
    script = cwd / "github-step.sh"
    body = _step(job, name)["run"]
    for source, target in (replacements or {}).items():
        body = body.replace(source, target)
    script.write_text(body, encoding="utf-8")
    return subprocess.run(
        ["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)],
        cwd=cwd,
        env=environment,
        capture_output=True,
        text=True,
        check=False,
    )


def _fake_uv_environment(tmp_path: Path, body: str) -> dict[str, str]:
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    fake_uv = bin_dir / "uv"
    fake_uv.write_text(f"#!/usr/bin/env bash\nset -eu\n{body}", encoding="utf-8")
    fake_uv.chmod(0o755)
    environment = os.environ.copy()
    environment["PATH"] = f"{bin_dir}:{environment['PATH']}"
    environment["GITHUB_OUTPUT"] = str(tmp_path / "github-output.txt")
    return environment


def test_daily_workflow_keeps_triggers_concurrency_and_bounded_job_graph() -> None:
    document = _load(DAILY_WORKFLOW)
    jobs = document["jobs"]

    assert set(_on_block(document)) == {"workflow_dispatch", "schedule"}
    assert _on_block(document)["schedule"] == [{"cron": "0 7 * * *"}]
    assert document["permissions"] == {"contents": "read", "issues": "write"}
    assert document["concurrency"] == {
        "group": "daily-warm-rollups",
        "cancel-in-progress": False,
    }
    assert set(jobs) == {"prepare", "rollups", "publish", "retention", "notify"}
    assert jobs["rollups"]["needs"] == "prepare"
    assert set(jobs["publish"]["needs"]) == {"prepare", "rollups"}
    assert set(jobs["retention"]["needs"]) == {"prepare", "publish"}
    assert set(jobs["notify"]["needs"]) == {
        "prepare",
        "rollups",
        "publish",
        "retention",
    }


def test_prepare_reuses_recovery_setup_migrates_and_emits_safe_provider_matrix() -> None:
    document = _load(DAILY_WORKFLOW)
    prepare = document["jobs"]["prepare"]
    recovery = next(iter(_load(RECOVERY_WORKFLOW)["jobs"].values()))

    assert prepare["steps"][:4] == recovery["steps"][:4]
    assert [step.get("name") for step in prepare["steps"][:4]] == SETUP_STEP_NAMES
    assert prepare["defaults"] == {"run": {"working-directory": "apps/db", "shell": "bash"}}
    assert prepare["outputs"] == {"providers": "${{ steps.discover.outputs.providers }}"}

    run_bodies = "\n".join(str(step["run"]) for step in prepare["steps"] if "run" in step)
    assert run_bodies.index("transit_ops.cli init-db") < run_bodies.index(
        "alembic current --check-heads"
    )
    assert run_bodies.index("alembic current --check-heads") < run_bodies.index(
        "transit_ops.cli list-providers"
    )
    assert run_bodies.index("transit_ops.cli list-providers") < run_bodies.index(
        "transit_ops.cli sync-alert-archive"
    )

    discover = _step(prepare, "Discover providers and sync alert archive")
    assert discover["id"] == "discover"
    assert "^[A-Za-z0-9][A-Za-z0-9._-]*$" in discover["run"]
    assert "duplicate provider id" in discover["run"]
    assert "jq -cn --args" in discover["run"]
    assert "printf 'providers=%s\\n'" in discover["run"]
    assert '>> "$GITHUB_OUTPUT"' in discover["run"]
    upload = _step(prepare, "Upload prepare evidence")
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
    assert upload["with"]["if-no-files-found"] == "warn"


def test_prepare_discovery_emits_compact_unique_json_and_sync_receipts(tmp_path: Path) -> None:
    environment = _fake_uv_environment(
        tmp_path,
        """\
if [[ "$*" == *"list-providers"* ]]; then
  printf 'stm\\nsto\\n'
  exit 0
fi
if [[ "$*" == *"sync-alert-archive"* ]]; then
  provider="${!#}"
  printf '{"provider_id":"%s"}\\n' "$provider"
  exit 0
fi
exit 0
""",
    )
    prepare = _load(DAILY_WORKFLOW)["jobs"]["prepare"]

    result = _run_step(
        prepare,
        "Discover providers and sync alert archive",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 0, result.stderr
    output = Path(environment["GITHUB_OUTPUT"]).read_text(encoding="utf-8")
    assert output == 'providers=["stm","sto"]\n'
    artifact_dir = tmp_path / "artifacts" / "daily-warm-rollups" / "prepare"
    assert json.loads((artifact_dir / "provider-discovery.json").read_text()) == [
        "stm",
        "sto",
    ]
    for provider in ("stm", "sto"):
        receipt = json.loads((artifact_dir / f"alert-archive-sync-{provider}.json").read_text())
        assert receipt == {"provider_id": provider}


@pytest.mark.parametrize(
    ("provider_output", "expected_error"),
    [
        ("", "no providers"),
        ("../sto", "unsafe provider id"),
        ("stm\\nstm", "duplicate provider id"),
    ],
)
def test_prepare_discovery_rejects_empty_unsafe_or_duplicate_ids_before_sync(
    tmp_path: Path,
    provider_output: str,
    expected_error: str,
) -> None:
    calls = tmp_path / "sync-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
if [[ "$*" == *"list-providers"* ]]; then
  printf '%b' "$PROVIDER_OUTPUT"
  exit 0
fi
printf '%s\\n' "$*" >> "$SYNC_CALLS"
exit 0
""",
    )
    environment["PROVIDER_OUTPUT"] = provider_output
    environment["SYNC_CALLS"] = str(calls)
    prepare = _load(DAILY_WORKFLOW)["jobs"]["prepare"]

    result = _run_step(
        prepare,
        "Discover providers and sync alert archive",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert expected_error in result.stderr
    assert not calls.exists()


def test_prepare_discovery_propagates_list_provider_failure(tmp_path: Path) -> None:
    environment = _fake_uv_environment(
        tmp_path,
        'if [[ "$*" == *"list-providers"* ]]; then exit 23; fi\nexit 0\n',
    )
    prepare = _load(DAILY_WORKFLOW)["jobs"]["prepare"]

    result = _run_step(
        prepare,
        "Discover providers and sync alert archive",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 23


def test_rollups_are_serial_per_provider_with_a_bounded_budget_and_receipt() -> None:
    rollups = _load(DAILY_WORKFLOW)["jobs"]["rollups"]

    assert rollups["timeout-minutes"] == 100
    assert rollups["strategy"] == {
        "fail-fast": False,
        "max-parallel": 1,
        "matrix": {"provider": "${{ fromJSON(needs.prepare.outputs.providers) }}"},
    }
    build = _step(rollups, "Build warm rollups")
    assert build["timeout-minutes"] == 75
    assert build["env"] == {"PROVIDER_ID": "${{ matrix.provider }}"}
    assert 'build-warm-rollups "$PROVIDER_ID"' in build["run"]
    assert "rollup-stage-${PROVIDER_ID}.json" in build["run"]
    assert "rollup-${PROVIDER_ID}.log" in build["run"]
    upload = _step(rollups, "Upload rollup receipt")
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
    assert upload["with"]["if-no-files-found"] == "warn"


def test_rollup_failure_returns_nonzero_and_writes_failure_receipt_and_log(
    tmp_path: Path,
) -> None:
    environment = _fake_uv_environment(
        tmp_path,
        """\
if [[ "$*" == *"build-warm-rollups"* ]]; then
  printf 'partial rollup output\\n'
  exit 41
fi
exit 0
""",
    )
    environment["PROVIDER_ID"] = "stm"
    rollups = _load(DAILY_WORKFLOW)["jobs"]["rollups"]

    result = _run_step(
        rollups,
        "Build warm rollups",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 41
    artifact_dir = tmp_path / "artifacts" / "daily-warm-rollups" / "rollups"
    receipt = json.loads((artifact_dir / "rollup-stage-stm.json").read_text())
    assert receipt["provider_id"] == "stm"
    assert receipt["status"] == "failure"
    assert receipt["exit_code"] == 41
    assert (artifact_dir / "rollup-stm.log").read_text() == "partial rollup output\n"


def test_publish_requires_prepare_and_rollups_success_and_proves_messages() -> None:
    publish = _load(DAILY_WORKFLOW)["jobs"]["publish"]

    assert publish["env"]["SNAPSHOT_BASEMAP_PMTILES_URL"] == (
        "${{ vars.SNAPSHOT_BASEMAP_PMTILES_URL }}"
    )
    assert publish["env"]["SNAPSHOT_BASEMAP_STYLE_URL"] == (
        "${{ vars.SNAPSHOT_BASEMAP_STYLE_URL }}"
    )
    guard = publish["if"]
    assert "always()" in guard
    assert "needs.prepare.result == 'success'" in guard
    assert "needs.rollups.result == 'success'" in guard
    assert publish["timeout-minutes"] == 90
    download = _step(publish, "Download alert archive receipts")
    assert download["uses"] == (
        "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"
    )
    assert download["with"]["name"] == "daily-warm-prepare-${{ github.run_id }}"
    publish_run = _step(publish, "Publish gated historic snapshot")["run"]
    assert "publish-all" in publish_run
    assert "--tier historic" in publish_run
    assert "--report-dir" in publish_run
    proof = _step(publish, "Prove public historic snapshots and source messages")["run"]
    assert "verify-historic-publish" in proof
    assert "--sync-report" in proof
    assert "--gate-report" in proof
    assert "--report-path" in proof
    upload = _step(publish, "Upload publish evidence")
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
    assert upload["with"]["if-no-files-found"] == "warn"


def _write_daily_publish_inputs(
    tmp_path: Path,
    *,
    discovery: object,
    receipts: dict[str, str | object],
    published: object,
) -> None:
    prepare_dir = tmp_path / "artifacts" / "daily-warm-rollups" / "prepare"
    publish_dir = tmp_path / "artifacts" / "daily-warm-rollups" / "publish"
    prepare_dir.mkdir(parents=True)
    publish_dir.mkdir(parents=True)
    (prepare_dir / "provider-discovery.json").write_text(
        json.dumps(discovery),
        encoding="utf-8",
    )
    for provider, payload in receipts.items():
        body = payload if isinstance(payload, str) else json.dumps(payload)
        (prepare_dir / f"alert-archive-sync-{provider}.json").write_text(
            body,
            encoding="utf-8",
        )
    (publish_dir / "historic-publish.json").write_text(
        json.dumps(published),
        encoding="utf-8",
    )


def test_publish_proof_accepts_seeded_provider_and_skips_unseeded_receipt(
    tmp_path: Path,
) -> None:
    _write_daily_publish_inputs(
        tmp_path,
        discovery=["stm", "sto"],
        receipts={
            "stm": {"provider_id": "stm"},
            "sto": {"provider_id": "sto", "skipped_not_seeded": True},
        },
        published=[{"provider_id": "stm"}],
    )
    calls = tmp_path / "verify-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        """\
if [[ "$*" == *"verify-historic-publish"* ]]; then
  provider="$6"
  printf '%s\\n' "$provider" >> "$VERIFY_CALLS"
  printf '{"provider_id":"%s","status":"pass"}\\n' "$provider" \\
    > "artifacts/daily-warm-rollups/publish/public-proof-${provider}.json"
fi
exit 0
""",
    )
    environment["VERIFY_CALLS"] = str(calls)
    publish = _load(DAILY_WORKFLOW)["jobs"]["publish"]

    result = _run_step(
        publish,
        "Prove public historic snapshots and source messages",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode == 0, result.stderr
    assert calls.read_text(encoding="utf-8") == "stm\n"


def test_publish_proof_rejects_multiple_sync_documents_before_verification(
    tmp_path: Path,
) -> None:
    _write_daily_publish_inputs(
        tmp_path,
        discovery=["stm"],
        receipts={"stm": '{"provider_id":"stm"}\n{"provider_id":"stm"}\n'},
        published=[{"provider_id": "stm"}],
    )
    calls = tmp_path / "verify-calls.txt"
    environment = _fake_uv_environment(
        tmp_path,
        'printf "%s\\n" "$*" >> "$VERIFY_CALLS"\nexit 0\n',
    )
    environment["VERIFY_CALLS"] = str(calls)
    publish = _load(DAILY_WORKFLOW)["jobs"]["publish"]

    result = _run_step(
        publish,
        "Prove public historic snapshots and source messages",
        cwd=tmp_path,
        environment=environment,
    )

    assert result.returncode != 0
    assert not calls.exists()


def test_retention_is_serial_after_publish_and_requires_bronze_exhaustion() -> None:
    retention = _load(DAILY_WORKFLOW)["jobs"]["retention"]

    assert retention["if"] == "needs.publish.result == 'success'"
    assert retention["strategy"] == {
        "fail-fast": False,
        "max-parallel": 1,
        "matrix": {"provider": "${{ fromJSON(needs.prepare.outputs.providers) }}"},
    }
    prune = _step(retention, "Prune retained storage")["run"]
    i3 = prune.index('prune-i3-storage "$PROVIDER_ID"')
    warm = prune.index('prune-warm-rollup-storage "$PROVIDER_ID"')
    bronze = prune.index('prune-bronze-storage "$PROVIDER_ID" --require-exhausted')
    assert i3 < warm < bronze
    proof = _step(retention, "Write retention proof")["run"]
    assert _step(retention, "Write retention proof")["if"] == "always()"
    assert 'retention-proof-report "$PROVIDER_ID" --report-path' in proof
    upload = _step(retention, "Upload retention receipts")
    assert upload["if"] == "always()"
    assert upload["uses"] == "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
    assert upload["with"]["if-no-files-found"] == "warn"


def test_notify_always_fires_or_resolves_one_existing_issue_from_all_results() -> None:
    notify = _load(DAILY_WORKFLOW)["jobs"]["notify"]

    assert notify["if"] == "always()"
    step = _step(notify, "Update daily warm rollups issue")
    assert step["env"] == {
        "PREPARE_RESULT": "${{ needs.prepare.result }}",
        "ROLLUPS_RESULT": "${{ needs.rollups.result }}",
        "PUBLISH_RESULT": "${{ needs.publish.result }}",
        "RETENTION_RESULT": "${{ needs.retention.result }}",
        "GH_TOKEN": "${{ github.token }}",
        "GH_REPO": "${{ github.repository }}",
    }
    assert "alert-issue.sh fire daily-warm-rollups" in step["run"]
    assert "alert-issue.sh resolve daily-warm-rollups" in step["run"]


@pytest.mark.parametrize(
    ("results", "expected_action"),
    [
        (("success", "success", "success", "success"), "resolve"),
        (("success", "failure", "success", "skipped"), "fire"),
    ],
)
def test_notify_shell_selects_action_from_all_job_results(
    tmp_path: Path,
    results: tuple[str, str, str, str],
    expected_action: str,
) -> None:
    script_dir = tmp_path / ".github" / "scripts"
    script_dir.mkdir(parents=True)
    alert_script = script_dir / "alert-issue.sh"
    alert_script.write_text(
        '#!/usr/bin/env bash\nprintf \'%s\\n\' "$*" >> "$ALERT_CALLS"\n',
        encoding="utf-8",
    )
    alert_script.chmod(0o755)
    calls = tmp_path / "alert-calls.txt"
    environment = os.environ.copy()
    environment.update(
        {
            "PREPARE_RESULT": results[0],
            "ROLLUPS_RESULT": results[1],
            "PUBLISH_RESULT": results[2],
            "RETENTION_RESULT": results[3],
            "GH_TOKEN": "test-token",
            "GH_REPO": "owner/repo",
            "ALERT_CALLS": str(calls),
        }
    )
    notify = _load(DAILY_WORKFLOW)["jobs"]["notify"]

    result = _run_step(
        notify,
        "Update daily warm rollups issue",
        cwd=tmp_path,
        environment=environment,
        replacements={
            "${{ github.run_id }}": "123",
            "${{ github.server_url }}": "https://github.example",
            "${{ github.repository }}": "owner/repo",
        },
    )

    assert result.returncode == 0, result.stderr
    assert calls.read_text(encoding="utf-8").startswith(f"{expected_action} daily-warm-rollups ")
