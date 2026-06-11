"""Artifact contracts for the transit-data-proxy Cloudflare Worker (slice-9.1.1p).

The worker serves the canonical snapshot URLs (https://transit.yesid.dev/data/...)
already baked into the published manifest. These tests pin the wrangler config,
the deploy workflow, and the .env.example base URL to each other so the canonical
``cd db && uv run pytest`` gate covers the JS surface; the behavioral suite itself
runs under ``node --test`` (bridged below when node is available).
"""

from __future__ import annotations

import os
import shutil
import subprocess
import tomllib
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[2]
PROXY_DIR = REPO_ROOT / "infra" / "cloudflare" / "data-proxy"
WRANGLER_TOML = PROXY_DIR / "wrangler.toml"
DEPLOY_WORKFLOW = REPO_ROOT / ".github" / "workflows" / "deploy-data-proxy.yml"
ENV_EXAMPLE = REPO_ROOT / ".env.example"


def _wrangler_config() -> dict:
    return tomllib.loads(WRANGLER_TOML.read_text(encoding="utf-8"))


def _deploy_workflow() -> dict:
    return yaml.safe_load(DEPLOY_WORKFLOW.read_text(encoding="utf-8"))


def _workflow_triggers(workflow: dict) -> dict:
    # pyyaml parses the bare `on:` key as boolean True.
    return workflow.get("on", workflow.get(True))


def test_wrangler_config_routes_canonical_data_path_to_snapshots_bucket() -> None:
    config = _wrangler_config()

    assert config["name"] == "transit-data-proxy"
    assert config["main"] == "src/worker.js"
    assert config["routes"] == [
        {"pattern": "transit.yesid.dev/data/*", "zone_name": "yesid.dev"}
    ]
    assert config["r2_buckets"] == [
        {"binding": "SNAPSHOTS", "bucket_name": "transit-snapshots"}
    ]


def test_wrangler_config_disables_workers_dev_and_pins_account() -> None:
    config = _wrangler_config()

    assert config["workers_dev"] is False
    # The R2 account hash already committed in .env.example / settings defaults.
    assert config["account_id"] == "eccfb9bedd87d413eaf4cac6ae2285d3"


def test_deploy_workflow_runs_worker_tests_then_wrangler_action() -> None:
    workflow = _deploy_workflow()

    triggers = _workflow_triggers(workflow)
    assert "workflow_dispatch" in triggers
    assert triggers["push"]["branches"] == ["main"]
    assert "infra/cloudflare/data-proxy/**" in triggers["push"]["paths"]
    assert workflow["permissions"] == {"contents": "read"}

    (job,) = workflow["jobs"].values()
    steps = job["steps"]
    node_test_indexes = [
        index for index, step in enumerate(steps) if "node --test" in step.get("run", "")
    ]
    wrangler_indexes = [
        index
        for index, step in enumerate(steps)
        if step.get("uses", "").startswith("cloudflare/wrangler-action")
    ]
    assert node_test_indexes, "deploy workflow must run the worker behavioral suite"
    assert wrangler_indexes, "deploy workflow must publish via cloudflare/wrangler-action"
    assert node_test_indexes[0] < wrangler_indexes[0], "tests must gate the deploy"

    wrangler_step = steps[wrangler_indexes[0]]
    assert wrangler_step["with"]["apiToken"] == "${{ secrets.CLOUDFLARE_API_TOKEN }}"
    assert wrangler_step["with"]["workingDirectory"] == "infra/cloudflare/data-proxy"


def test_env_example_public_base_url_matches_worker_route() -> None:
    lines = ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
    (base_url_line,) = [
        line for line in lines if line.startswith("SNAPSHOT_PUBLIC_BASE_URL=")
    ]
    base_url = base_url_line.split("=", 1)[1]

    assert base_url == "https://transit.yesid.dev/data"

    (route,) = _wrangler_config()["routes"]
    host_and_path = base_url.removeprefix("https://")
    assert route["pattern"] == f"{host_and_path}/*"


def test_smoke_script_asserts_canonical_and_fallback_objects() -> None:
    smoke = PROXY_DIR / "smoke.sh"

    assert smoke.exists(), "smoke.sh is the prod verification gate for this slice"
    assert os.access(smoke, os.X_OK), "smoke.sh must be executable"

    syntax_check = subprocess.run(
        ["bash", "-n", str(smoke)], text=True, capture_output=True, check=False
    )
    assert syntax_check.returncode == 0, syntax_check.stderr

    text = smoke.read_text(encoding="utf-8")
    # Canonical host and untouched fallback origin both probed.
    assert "transit.yesid.dev/data" in text
    assert "data.yesid.dev" in text
    # All three cache tiers hard-asserted (storage.py CACHE_CONTROL values).
    assert "max-age=30" in text
    assert "max-age=604800" in text
    assert "max-age=86400" in text
    # All three tiers + provenance covered (historic went live 2026-06-10).
    assert "live/vehicles.json" in text
    assert "static/routes_index.json" in text
    assert "historic/network_trend.json" in text
    assert "provenance.json" in text
    # Negatives: method guard, error responses never cacheable, CORS proof.
    assert "405" in text
    assert "no-store" in text
    assert "access-control-allow-origin" in text


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_smoke_script_committed_with_executable_bit() -> None:
    # os.access(X_OK) only sees the working tree; under core.fileMode=false a
    # local chmod never reaches the commit, so fresh clones materialize the
    # tracked mode. Pin the index mode itself (100755, like pipeline-control.sh).
    result = subprocess.run(
        ["git", "ls-files", "--stage", "--", "infra/cloudflare/data-proxy/smoke.sh"],
        cwd=REPO_ROOT,
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        pytest.skip(f"not a git checkout: {result.stderr.strip()}")

    assert result.stdout.strip(), "smoke.sh must be tracked by git"
    mode = result.stdout.split()[0]
    assert mode == "100755", (
        f"smoke.sh tracked as {mode}; fresh clones would get a non-executable file"
    )


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_worker_behavioral_suite_passes_under_node() -> None:
    result = subprocess.run(
        ["node", "--test", "test/*.test.mjs"],
        cwd=PROXY_DIR,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
