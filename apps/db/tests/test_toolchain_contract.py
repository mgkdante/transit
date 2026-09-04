from __future__ import annotations

import json
import re
import tomllib
from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[3]
WORKFLOWS = REPO_ROOT / ".github/workflows"

NODE_VERSION = "22.23.2"
PYTHON_LINE = "3.12"
PRODUCTION_PYTHON_VERSION = "3.12.14"
BUN_VERSION = "1.3.11"
UV_VERSION = "0.11.15"
WRANGLER_VERSION = "4.115.0"
PLAYWRIGHT_VERSION = "1.62.0"
CHROMIUM_VERSION = "151.0.7922.34"

PYTHON_IMAGE = (
    "python:3.12.14-slim-bookworm@"
    "sha256:782412e85d0f0984994c290652577d4018aff08145c85b262bb63dc0c7522254"
)
POSTGRES_IMAGE = (
    "postgres:16.15-bookworm@"
    "sha256:bb3e1a57e5407e0a5280b4211980a5e537f4abd234a87014ac979849a78dd825"
)
CADDY_IMAGE = (
    "caddy:2.11.4-alpine@sha256:5f5c8640aae01df9654968d946d8f1a56c497f1dd5c5cda4cf95ab7c14d58648"
)
DISPOSABLE_POSTGIS_IMAGE = (
    "postgis/postgis:16-3.4@sha256:44126d872ac91993766c341e369c539e8196614321765d36a6f1bab0419a5fa5"
)


def _json(path: str) -> dict[str, object]:
    return json.loads((REPO_ROOT / path).read_text(encoding="utf-8"))


def _yaml(path: Path) -> dict[str, object]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _step_uses(job: dict[str, object]) -> list[str]:
    return [str(step.get("uses", "")) for step in job.get("steps", []) if isinstance(step, dict)]


def _step_runs(job: dict[str, object]) -> str:
    return "\n".join(
        str(step.get("run", "")) for step in job.get("steps", []) if isinstance(step, dict)
    )


def test_node_and_bun_have_one_executable_workspace_contract() -> None:
    root_package = _json("package.json")

    assert (REPO_ROOT / ".nvmrc").read_text(encoding="utf-8").strip() == NODE_VERSION
    assert not (REPO_ROOT / "apps/web/.nvmrc").exists()
    assert (REPO_ROOT / ".bun-version").read_text(encoding="utf-8").strip() == BUN_VERSION
    assert root_package["packageManager"] == f"bun@{BUN_VERSION}"
    assert root_package["engines"] == {
        "bun": BUN_VERSION,
        "node": ">=22.12.0 <23",
    }

    setup = _yaml(REPO_ROOT / ".github/actions/setup/action.yml")
    steps = setup["runs"]["steps"]
    node_index = next(
        index
        for index, step in enumerate(steps)
        if str(step.get("uses", "")).startswith("actions/setup-node@")
    )
    bun_index = next(
        index
        for index, step in enumerate(steps)
        if str(step.get("uses", "")).startswith("oven-sh/setup-bun@")
    )
    assert node_index < bun_index
    assert steps[node_index]["with"] == {
        "node-version-file": ".nvmrc",
        "package-manager-cache": False,
    }


def test_python_and_uv_have_one_executable_workspace_contract() -> None:
    pyproject = tomllib.loads((REPO_ROOT / "apps/db/pyproject.toml").read_text(encoding="utf-8"))
    setup = _yaml(REPO_ROOT / ".github/actions/setup-py/action.yml")
    steps = setup["runs"]["steps"]
    python_step = next(
        step for step in steps if str(step.get("uses", "")).startswith("actions/setup-python@")
    )
    uv_step = next(
        step for step in steps if str(step.get("uses", "")).startswith("astral-sh/setup-uv@")
    )

    assert (REPO_ROOT / ".python-version").read_text(encoding="utf-8").strip() == PYTHON_LINE
    assert pyproject["project"]["requires-python"] == ">=3.12,<3.13"
    assert python_step["with"] == {"python-version-file": ".python-version"}
    assert uv_step["with"]["version"] == UV_VERSION
    assert any(step.get("name") == "Verify Python toolchain" for step in steps)


def test_wrangler_has_one_installed_owner_and_no_ad_hoc_versions() -> None:
    root_package = _json("package.json")
    data_proxy_package = _json("apps/data-proxy/package.json")

    assert root_package["devDependencies"]["wrangler"] == WRANGLER_VERSION
    assert "wrangler" not in data_proxy_package.get("devDependencies", {})

    offenders: list[str] = []
    for relative in [
        "package.json",
        "apps/data-proxy/package.json",
        "apps/web/CLOUDFLARE.md",
        ".github/workflows/web.yml",
        ".github/workflows/configure-data-edge.yml",
        ".github/workflows/deploy-data-proxy.yml",
        ".github/scripts/refresh-basemap-r2.mjs",
    ]:
        text = (REPO_ROOT / relative).read_text(encoding="utf-8")
        if re.search(r"wrangler@\d", text, flags=re.IGNORECASE):
            offenders.append(relative)
    assert offenders == []


def test_every_javascript_workflow_lane_installs_the_selected_node() -> None:
    consumers: list[str] = []
    missing_setup: list[str] = []
    literal_node_versions: list[str] = []

    for workflow_path in sorted(WORKFLOWS.glob("*.yml")):
        workflow = _yaml(workflow_path)
        for job_name, job in workflow.get("jobs", {}).items():
            if not isinstance(job, dict):
                continue
            runs = _step_runs(job)
            if not re.search(r"(^|[\s;&|])(node|bun|bunx)(?=\s|$)", runs):
                continue
            label = f"{workflow_path.name}:{job_name}"
            consumers.append(label)
            uses = _step_uses(job)
            has_shared_setup = "./.github/actions/setup" in uses
            has_node_setup = any(value.startswith("actions/setup-node@") for value in uses)
            if not (has_shared_setup or has_node_setup):
                missing_setup.append(label)
            for step in job.get("steps", []):
                if not isinstance(step, dict) or not str(step.get("uses", "")).startswith(
                    "actions/setup-node@"
                ):
                    continue
                with_values = step.get("with", {})
                if with_values.get("node-version-file") != ".nvmrc":
                    literal_node_versions.append(label)

    assert consumers
    assert missing_setup == []
    assert literal_node_versions == []


def test_browser_runtime_is_verified_from_installed_playwright_metadata() -> None:
    web_package = _json("apps/web/package.json")
    receipt = _json("apps/web/static/map/basemap-montreal-posters.json")
    verifier = REPO_ROOT / "apps/web/scripts/verify-browser-toolchain.mjs"

    assert web_package["devDependencies"]["playwright-core"] == PLAYWRIGHT_VERSION
    assert receipt["reproduced_with"] == {
        "playwright_core_version": PLAYWRIGHT_VERSION,
        "chromium_version": CHROMIUM_VERSION,
    }
    assert verifier.is_file()

    web_workflow = _yaml(WORKFLOWS / "web.yml")
    ci_runs = _step_runs(web_workflow["jobs"]["ci-work"])
    assert "playwright-core/browsers.json" in verifier.read_text(encoding="utf-8")
    assert "browser.version()" in verifier.read_text(encoding="utf-8")
    assert "verify-browser-toolchain.mjs" in ci_runs


def test_external_container_images_are_readable_and_immutable() -> None:
    assert (REPO_ROOT / "apps/db/Dockerfile").read_text(encoding="utf-8").splitlines()[
        0
    ] == f"FROM {PYTHON_IMAGE}"
    assert PRODUCTION_PYTHON_VERSION in PYTHON_IMAGE
    assert (REPO_ROOT / "apps/db/Dockerfile.health").read_text(encoding="utf-8").splitlines()[
        0
    ] == f"FROM {PYTHON_IMAGE}"
    assert (REPO_ROOT / "apps/db/Dockerfile.postgis").read_text(encoding="utf-8").splitlines()[
        0
    ] == f"FROM {POSTGRES_IMAGE}"

    compose = _yaml(REPO_ROOT / "apps/db/docker-compose.yml")
    disposable = _yaml(REPO_ROOT / "apps/db/docker-compose.real-db.yml")
    assert compose["services"]["caddy"]["image"] == CADDY_IMAGE
    assert disposable["services"]["postgres"]["image"] == DISPOSABLE_POSTGIS_IMAGE

    external_images: list[str] = []
    for compose_path in sorted((REPO_ROOT / "apps/db").glob("docker-compose*.yml")):
        document = _yaml(compose_path)
        for service in document.get("services", {}).values():
            image = str(service.get("image", ""))
            if image and not image.startswith("transit-"):
                external_images.append(image)
    assert external_images
    assert all(re.search(r":[^@\s]+@sha256:[0-9a-f]{64}$", image) for image in external_images)


def test_protected_ci_executes_container_runtime_proof_without_renaming_contexts() -> None:
    ci = _yaml(WORKFLOWS / "ci.yml")
    real_db_runs = _step_runs(ci["jobs"]["real-db-tests-work"])
    contexts = {
        row["context"] for row in ci["jobs"]["required-contexts"]["strategy"]["matrix"]["include"]
    }

    assert (REPO_ROOT / "apps/db/scripts/verify-runtime-images.sh").is_file()
    assert "verify-runtime-images.sh" in real_db_runs
    assert contexts == {"offline-tests", "alembic-single-head", "real-db-tests"}
    assert _yaml(WORKFLOWS / "web.yml")["jobs"]["ci"]["name"] == "ci"
    assert _yaml(WORKFLOWS / "secret-scan.yml")["jobs"]["gitleaks"]["name"] == "gitleaks"


def test_hosted_runner_series_and_gitleaks_installer_are_explicit() -> None:
    wrong_runners: list[str] = []
    for workflow_path in sorted(WORKFLOWS.glob("*.yml")):
        workflow = _yaml(workflow_path)
        for job_name, job in workflow.get("jobs", {}).items():
            if isinstance(job, dict) and job.get("runs-on") != "ubuntu-24.04":
                wrong_runners.append(f"{workflow_path.name}:{job_name}")
    assert wrong_runners == []

    installer = REPO_ROOT / ".github/scripts/install-gitleaks.sh"
    assert installer.is_file()
    installer_text = installer.read_text(encoding="utf-8")
    assert 'GITLEAKS_VERSION="8.30.1"' in installer_text
    assert (
        'GITLEAKS_ARCHIVE_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"'
        in installer_text
    )
    secret_scan = (WORKFLOWS / "secret-scan.yml").read_text(encoding="utf-8")
    assert "install-gitleaks.sh" in secret_scan
    assert "gitleaks_${GITLEAKS_VERSION}" not in secret_scan
