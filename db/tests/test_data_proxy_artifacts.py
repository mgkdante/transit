"""Artifact contracts for the transit-data-proxy Cloudflare Worker (slice-9.1.1p).

The worker serves the canonical snapshot URLs (https://transit.yesid.dev/data/...)
already baked into the published manifest. These tests pin the wrangler config,
the deploy workflow, and the .env.example base URL to each other so the canonical
``cd db && uv run pytest`` gate covers the JS surface; the behavioral suite itself
runs under ``node --test`` (bridged below when node is available).
"""

from __future__ import annotations

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
