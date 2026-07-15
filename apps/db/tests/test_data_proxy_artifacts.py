"""Artifact contracts for the transit-data-proxy Cloudflare Worker (slice-9.1.1p).

The worker serves the canonical snapshot URLs (https://transit.yesid.dev/data/...)
already baked into the published manifest. These tests pin the wrangler config,
the deploy workflow, and the .env.example base URL to each other so the canonical
``cd apps/db && uv run pytest`` gate covers the JS surface; the behavioral suite itself
runs under ``node --test`` (bridged below when node is available).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import textwrap
import tomllib
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
PROXY_DIR = REPO_ROOT / "apps" / "data-proxy"
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


def test_wrangler_config_routes_public_contracts_to_snapshots_bucket() -> None:
    config = _wrangler_config()

    assert config["name"] == "transit-data-proxy"
    assert config["main"] == "src/worker.js"
    assert config["routes"] == [
        {"pattern": "transit.yesid.dev/data/*", "zone_name": "yesid.dev"},
        {"pattern": "transit.yesid.dev/api/v1/*", "zone_name": "yesid.dev"},
    ]
    assert config["r2_buckets"] == [{"binding": "SNAPSHOTS", "bucket_name": "transit-snapshots"}]


def test_wrangler_config_disables_workers_dev_and_pins_account() -> None:
    config = _wrangler_config()

    assert config["workers_dev"] is False
    # The R2 account hash already committed in .env.example / settings defaults.
    assert config["account_id"] == "eccfb9bedd87d413eaf4cac6ae2285d3"


def test_deploy_workflow_runs_worker_tests_then_wrangler_action() -> None:
    workflow = _deploy_workflow()

    triggers = _workflow_triggers(workflow)
    assert "workflow_dispatch" not in triggers
    # CI runs the worker tests on both lanes (develop = dev gate); the deploy STEP
    # stays main-only (gated by the job `if` on refs/heads/main).
    assert triggers["push"]["branches"] == ["main", "develop"]
    assert "apps/data-proxy/**" in triggers["push"]["paths"]
    # The workflow must also redeploy when only the deploy pipeline changes.
    assert ".github/workflows/deploy-data-proxy.yml" in triggers["push"]["paths"]
    assert workflow["permissions"] == {"contents": "read"}

    # Two jobs: the worker behavioral suite gates the (main-only) deploy.
    jobs = workflow["jobs"]
    test_job = jobs["test-data-proxy"]
    deploy_job = jobs["deploy-data-proxy"]

    test_runs = [step.get("run", "") for step in test_job["steps"]]
    assert any("node --test" in run for run in test_runs), (
        "test job must run the worker behavioral suite"
    )
    assert deploy_job["needs"] == "test-data-proxy", "tests must gate the deploy"

    # Production is push-only from main. workflow_dispatch lets an operator
    # select another ref, which could publish that branch's stale route config.
    assert deploy_job["if"] == ("github.event_name == 'push' && github.ref == 'refs/heads/main'")
    assert deploy_job["environment"] == "production"

    # CI must deploy with the EXACT wrangler the worker declares, or the
    # dry-run-validated toolchain and the deployed one silently drift. Under the
    # bun workspace the data-proxy carries no per-app lockfile (deps resolve via
    # the root bun.lock), so wrangler is pinned EXACTLY in package.json and the
    # deploy command must use that same pin.
    deploy_steps = deploy_job["steps"]
    wrangler_steps = [
        step
        for step in deploy_steps
        if "wrangler" in step.get("run", "") and "deploy" in step.get("run", "")
    ]
    assert wrangler_steps, "deploy job must publish via `wrangler deploy`"
    wrangler_step = wrangler_steps[0]
    assert wrangler_step["env"]["CLOUDFLARE_API_TOKEN"] == "${{ secrets.CLOUDFLARE_API_TOKEN }}"

    deploy_runs = [step.get("run", "") for step in deploy_steps]
    wrangler_index = next(index for index, run in enumerate(deploy_runs) if "wrangler" in run)
    smoke_index = next(index for index, run in enumerate(deploy_runs) if run == "bash smoke.sh")
    assert smoke_index > wrangler_index, "live smoke must verify the deployed Worker"

    proxy_pkg = json.loads((PROXY_DIR / "package.json").read_text(encoding="utf-8"))
    declared_wrangler = proxy_pkg["devDependencies"]["wrangler"]
    assert f"wrangler@{declared_wrangler}" in wrangler_step["run"]


def test_env_example_public_base_url_matches_worker_route() -> None:
    lines = ENV_EXAMPLE.read_text(encoding="utf-8").splitlines()
    (base_url_line,) = [line for line in lines if line.startswith("SNAPSHOT_PUBLIC_BASE_URL=")]
    base_url = base_url_line.split("=", 1)[1]

    assert base_url == "https://transit.yesid.dev/data"

    route = next(
        route for route in _wrangler_config()["routes"] if route["pattern"].endswith("/data/*")
    )
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
    # All three cache tiers hard-asserted (storage.py CACHE_CONTROL values;
    # old|new alternations tolerate the hash-guarded header rollout).
    assert "max-age=30" in text
    assert "max-age=604800" in text
    assert "max-age=86400" in text
    assert "max-age=3600, stale-while-revalidate=86400" in text
    # All three tiers + provenance covered (historic went live 2026-06-10).
    assert "live/vehicles.json" in text
    assert "static/routes_index.json" in text
    assert "historic/network_trend.json" in text
    assert "provenance.json" in text
    # Negatives: method guard, error responses never cacheable, CORS proof.
    assert "405" in text
    assert "no-store" in text
    assert "access-control-allow-origin" in text
    assert 'BROWSER_ORIGIN="${BROWSER_ORIGIN:-https://transit.yesid.dev}"' in text
    assert "Origin: $BROWSER_ORIGIN" in text
    # Direct R2 is not cost-optimized until Cloudflare's edge actually reuses the
    # object. The deployment smoke must warm one canonical URL, repeat the same
    # GET, and require a HIT with a positive Age rather than accepting DYNAMIC.
    assert "assert_edge_hit" in text
    assert "cf-cache-status: hit" in text.lower()
    assert "^age: [1-9][0-9]*$" in text
    assert "edge gate" in text.lower()
    # The deployment gate must fail if a future Worker publish drops the KPI
    # route or sends it back to the web app's HTML catch-all.
    assert "/api/v1/kpis" in text
    for field in (
        "snapshotAt",
        "freshnessS",
        "vehicles",
        "avgDelayS",
        "coverage",
        "routesLive",
        "routesTotal",
        "topRoutes",
    ):
        assert field in text
    assert "/api/v1/definitely-missing" in text
    assert "/api/vitals" in text


def test_smoke_retries_kpis_during_bounded_route_propagation_window() -> None:
    text = (PROXY_DIR / "smoke.sh").read_text(encoding="utf-8")

    assert 'KPIS_MAX_ATTEMPTS="${KPIS_MAX_ATTEMPTS:-24}"' in text
    assert 'KPIS_RETRY_DELAY_S="${KPIS_RETRY_DELAY_S:-5}"' in text
    assert "attempt <= KPIS_MAX_ATTEMPTS" in text
    assert 'sleep "$KPIS_RETRY_DELAY_S"' in text
    assert "exhausted $KPIS_MAX_ATTEMPTS attempts" in text


def test_smoke_recovers_when_kpi_route_appears_after_propagation(
    tmp_path: Path,
) -> None:
    mock_bin = tmp_path / "bin"
    mock_bin.mkdir()
    curl = mock_bin / "curl"
    curl.write_text(
        textwrap.dedent(
            r"""
            #!/usr/bin/env bash
            set -euo pipefail

            url="${*: -1}"
            method=GET
            status_only=false
            head_only=false
            dump_headers=false
            for ((index = 1; index <= $#; index++)); do
              argument="${!index}"
              [ "$argument" = "-w" ] && status_only=true
              [ "$argument" = "-D" ] && dump_headers=true
              case "$argument" in -*I*) head_only=true ;; esac
              if [ "$argument" = "-X" ]; then
                next=$((index + 1))
                method="${!next}"
              fi
            done

            if [ "$status_only" = true ]; then
              case "$url" in
                */api/vitals) printf 400 ;;
                */api/v1/definitely-missing) printf 404 ;;
                */definitely-missing.json|*/secrets.txt) printf 404 ;;
                */manifest.json)
                  [ "$method" = POST ] && printf 405 || printf 200
                  ;;
                *) printf 200 ;;
              esac
              exit 0
            fi

            if [ "$head_only" = true ]; then
              case "$url" in
                */definitely-missing.json) cache_control='no-store' ;;
                */api/v1/kpis) cache_control='no-store' ;;
                */live/vehicles.json|*/manifest.json) cache_control='public, max-age=30' ;;
                */static/routes_index.json) cache_control='public, max-age=604800' ;;
                *) cache_control='public, max-age=86400' ;;
              esac
              printf 'HTTP/2 200\r\n'
              printf 'content-type: application/json\r\n'
              printf 'cache-control: %s\r\n' "$cache_control"
              printf 'access-control-allow-origin: *\r\n\r\n'
              exit 0
            fi

            if [ "$dump_headers" = true ]; then
              if [ "$method" = OPTIONS ]; then
                printf 'HTTP/2 204\r\n'
                printf 'access-control-allow-origin: *\r\n'
                printf 'access-control-allow-methods: GET, HEAD\r\n'
                printf 'access-control-allow-headers: range\r\n\r\n'
                exit 0
              fi
              if [[ "$url" == */definitely-missing.json ]]; then
                printf 'HTTP/2 404\r\n'
                printf 'content-type: application/json\r\n\r\n'
                exit 0
              fi
              printf 'HTTP/2 200\r\n'
              printf 'content-type: application/json\r\n'
              printf 'cache-control: public, max-age=30\r\n'
              printf 'cf-cache-status: HIT\r\n'
              printf 'age: 2\r\n'
              printf 'access-control-allow-origin: *\r\n\r\n'
              exit 0
            fi

            if [[ "$url" == */api/v1/kpis ]]; then
              count="$(cat "$CURL_COUNT_FILE" 2>/dev/null || printf 0)"
              count=$((count + 1))
              printf '%s' "$count" > "$CURL_COUNT_FILE"
              [ "$count" -ge 3 ] || exit 22
              printf '%s' \
                '{"snapshotAt":"now","freshnessS":1,"vehicles":1,' \
                '"avgDelayS":0,"coverage":1,"routesLive":1,' \
                '"routesTotal":1,"topRoutes":[]}'
              exit 0
            fi

            [[ "$url" == */manifest.json ]] && printf '{"provider":"stm"}' || printf '{}'
            """
        ).lstrip(),
        encoding="utf-8",
    )
    curl.chmod(0o755)

    count_file = tmp_path / "kpi-attempts"
    env = {
        **os.environ,
        "PATH": f"{mock_bin}:{os.environ['PATH']}",
        "CURL_COUNT_FILE": str(count_file),
        "CANONICAL_BASE": "https://canonical.test/data",
        "FALLBACK_BASE": "https://fallback.test",
        "APEX_BASE": "https://apex.test",
        "KPIS_MAX_ATTEMPTS": "3",
        "KPIS_RETRY_DELAY_S": "0",
    }
    result = subprocess.run(
        ["bash", str(PROXY_DIR / "smoke.sh")],
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stderr
    assert count_file.read_text(encoding="utf-8") == "3"
    assert result.stderr.count("not ready") == 2
    assert "SMOKE OK" in result.stdout


@pytest.mark.skipif(shutil.which("git") is None, reason="git is not installed")
def test_smoke_script_committed_with_executable_bit() -> None:
    # os.access(X_OK) only sees the working tree; under core.fileMode=false a
    # local chmod never reaches the commit, so fresh clones materialize the
    # tracked mode. Pin the index mode itself (100755, like pipeline-control.sh).
    result = subprocess.run(
        ["git", "ls-files", "--stage", "--", "apps/data-proxy/smoke.sh"],
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
    # Expand the glob here: node only expands --test glob args itself on
    # >= 21, and a literal "test/*.test.mjs" hard-fails (MODULE_NOT_FOUND)
    # on 18/20 LTS. Explicit file paths run on every node with the runner.
    test_files = sorted(
        path.relative_to(PROXY_DIR).as_posix() for path in (PROXY_DIR / "test").glob("*.test.mjs")
    )
    assert test_files, "worker behavioral suite has no test files"

    result = subprocess.run(
        ["node", "--test", *test_files],
        cwd=PROXY_DIR,
        text=True,
        capture_output=True,
        check=False,
    )

    assert result.returncode == 0, result.stdout + result.stderr
