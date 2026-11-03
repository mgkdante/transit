import json
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
DAILY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "daily-warm-rollups.yml"

UPLOAD_ACTION = "actions/upload-artifact@043fb46d1a93c77aae656e7c1c64a875d1fc6a0a"
DOWNLOAD_ACTION = "actions/download-artifact@3e5f45b2cfb9172054b4087a40e8e0b5a5461e7c"
ATTEMPT_SCOPED_ARTIFACT_NAMES = {
    "prepare": "daily-warm-prepare-${{ github.run_id }}-${{ github.run_attempt }}",
    "rollups": "daily-warm-rollups-${{ github.run_id }}-${{ github.run_attempt }}",
    "publish": "daily-warm-publish-${{ github.run_id }}-${{ github.run_attempt }}",
    "proof": "daily-warm-proof-${{ github.run_id }}-${{ github.run_attempt }}",
    "retention": "daily-warm-retention-${{ github.run_id }}-${{ github.run_attempt }}",
}
ARTIFACT_UPLOAD_WITH = {
    job_name: {
        "name": ATTEMPT_SCOPED_ARTIFACT_NAMES[job_name],
        "path": f"apps/db/artifacts/daily-warm-rollups/{job_name}/",
        "retention-days": 30,
        "if-no-files-found": "warn",
    }
    for job_name in ATTEMPT_SCOPED_ARTIFACT_NAMES
}


def _load(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _on_block(document: dict) -> dict:
    return document.get("on", document.get(True, {}))


def test_daily_workflow_keeps_triggers_concurrency_and_bounded_job_graph() -> None:
    document = _load(DAILY_WORKFLOW)
    jobs = document["jobs"]

    assert _on_block(document) == {
        "workflow_dispatch": {
            "inputs": {
                "bronze_catch_up_batches": {
                    "description": (
                        "One-off bronze backlog drain: up to this many 5,000-object batches "
                        "per provider, without a historic publish. 0 runs the normal pipeline."
                    ),
                    "type": "number",
                    "default": 0,
                }
            }
        },
        "schedule": [{"cron": "0 7 * * 0,1,2,4,5,6"}, {"cron": "0 7 * * 3"}],
    }
    assert document["permissions"] == {"contents": "read", "issues": "write"}
    assert document["concurrency"] == {
        "group": "daily-warm-rollups",
        "cancel-in-progress": False,
    }
    assert set(jobs) == {"prepare", "rollups", "publish", "proof", "retention", "notify"}
    assert all("strategy" not in job for job in jobs.values())
    assert jobs["rollups"]["needs"] == "prepare"
    assert set(jobs["publish"]["needs"]) == {"prepare", "rollups"}
    assert set(jobs["proof"]["needs"]) == {"prepare", "publish"}
    assert set(jobs["retention"]["needs"]) == {"prepare", "rollups", "proof"}
    assert set(jobs["notify"]["needs"]) == {
        "prepare",
        "rollups",
        "publish",
        "proof",
        "retention",
    }
    provider_jobs = [jobs["rollups"], jobs["retention"]]
    provider_steps = [step for job in provider_jobs for step in job["steps"]]
    assert (
        sum(str(step.get("uses", "")).startswith("actions/checkout@") for step in provider_steps)
        == 2
    )
    assert sum(step.get("uses") == "./.github/actions/setup-py" for step in provider_steps) == 2
    assert "matrix.provider" not in DAILY_WORKFLOW.read_text(encoding="utf-8")


def test_evidence_uploads_are_attempt_scoped_required_and_exact() -> None:
    jobs = _load(DAILY_WORKFLOW)["jobs"]
    upload_steps = [
        (job_name, step)
        for job_name, job in jobs.items()
        for step in job["steps"]
        if step.get("uses") == UPLOAD_ACTION
    ]

    assert len(upload_steps) == len(ATTEMPT_SCOPED_ARTIFACT_NAMES)
    assert {job_name for job_name, _ in upload_steps} == set(ATTEMPT_SCOPED_ARTIFACT_NAMES)
    for job_name, upload in upload_steps:
        assert upload["if"] == "always()"
        assert "continue-on-error" not in upload
        assert upload["with"] == ARTIFACT_UPLOAD_WITH[job_name]


def test_publish_uses_prepare_artifact_id_when_only_failed_jobs_and_dependents_rerun() -> None:
    jobs = _load(DAILY_WORKFLOW)["jobs"]
    prepare_upload = next(s for s in jobs["prepare"]["steps"] if s.get("uses") == UPLOAD_ACTION)
    prepare_download = next(
        s
        for s in jobs["proof"]["steps"]
        if s.get("with", {}).get("artifact-ids")
        == "${{ needs.prepare.outputs.prepare_artifact_id }}"
    )

    assert prepare_upload["id"] == "upload-prepare-evidence"
    assert jobs["prepare"]["outputs"] == {
        "providers": "${{ steps.discover.outputs.providers }}",
        "prepare_artifact_id": "${{ steps.upload-prepare-evidence.outputs.artifact-id }}",
        "historic_publish": (
            "${{ (github.event_name == 'workflow_dispatch' "
            "&& inputs.bronze_catch_up_batches == 0) "
            "|| github.event.schedule == '0 7 * * 3' }}"
        ),
    }
    assert "prepare" in jobs["proof"]["needs"]
    assert prepare_download["uses"] == DOWNLOAD_ACTION
    assert prepare_download["with"] == {
        "artifact-ids": "${{ needs.prepare.outputs.prepare_artifact_id }}",
        "path": "apps/db/artifacts/daily-warm-rollups/prepare",
    }
    assert "github.run_attempt" not in json.dumps(prepare_download["with"])


def test_jobs_delegate_policy_and_preserve_proof_handoff_and_retention_gates() -> None:
    jobs = _load(DAILY_WORKFLOW)["jobs"]
    for name, job in jobs.items():
        runs = [step for step in job["steps"] if "run" in step]
        expected = ["check-handoff", "proof"] if name == "proof" else [name]
        assert [step["run"] for step in runs] == [
            f"uv run python -m transit_ops.cli daily-run {command}" for command in expected
        ]
    proof = jobs["proof"]
    guard = next(step for step in proof["steps"] if "check-handoff" in step.get("run", ""))
    for producer in ("prepare", "publish"):
        source = "${{ needs." + producer + ".outputs." + producer + "_artifact_id }}"
        download = next(
            step for step in proof["steps"] if step.get("with", {}).get("artifact-ids") == source
        )
        assert download["uses"] == DOWNLOAD_ACTION
        assert download["with"] == {
            "artifact-ids": source,
            "path": f"apps/db/artifacts/daily-warm-rollups/{producer}",
        }
        assert guard["env"][producer.upper() + "_ARTIFACT_ID"] == source
        assert proof["steps"].index(guard) < proof["steps"].index(download)
    assert proof["if"] == "needs.publish.result == 'success'"
    assert jobs["publish"]["if"] == (
        "${{ always() && needs.prepare.result == 'success' && needs.rollups.result == 'success' "
        "&& needs.prepare.outputs.historic_publish == 'true' }}"
    )
    assert " ".join(jobs["retention"]["if"].split()) == (
        "${{ !cancelled() && needs.prepare.result == 'success' "
        "&& needs.rollups.result == 'success' "
        "&& (needs.proof.result == 'success' "
        "|| (needs.proof.result == 'skipped' "
        "&& needs.prepare.outputs.historic_publish == 'false')) }}"
    )
    assert jobs["notify"]["if"] == "always()"
