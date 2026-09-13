from __future__ import annotations

import json
import posixpath
import re
import shlex
import subprocess
import tomllib
from functools import cache
from pathlib import Path

import pytest
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
CHROMIUM_ARCHIVE_SHA256 = "3cfc2bd00d1bafcf8a68dc74c9c92bb7150ddc8d26ade948a776316e1cec4f14"
CHROMIUM_EXECUTABLE_SHA256 = "e11fc9ce65c96313476f7ee9844b6fb6a9220fb048693cfe9eee00acf4170a9f"

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

VERSION_OWNERS = {
    ".nvmrc",
    ".bun-version",
    ".python-version",
    "package.json",
    "apps/db/pyproject.toml",
    ".github/actions/setup-py/action.yml",
    "apps/db/Dockerfile",
    "apps/db/Dockerfile.health",
    "apps/web/package.json",
    "apps/web/browser-toolchain.json",
    ".github/scripts/install-gitleaks.sh",
}
COMPATIBILITY_PROOFS = {
    "apps/db/tests/test_toolchain_contract.py",
    "apps/db/tests/test_deploy_artifacts.py",
    "apps/db/tests/test_setup_py_action.py",
    "apps/db/tests/test_data_proxy_artifacts.py",
    "apps/db/tests/test_runtime_images_verifier.py",
    "apps/db/tests/test_install_gitleaks_script.py",
    "apps/db/tests/test_health_checks.py",
    "apps/db/tests/test_snapshot_publish_typing_contract.py",
    "apps/web/scripts/install-browser-toolchain.test.mjs",
    "apps/web/scripts/verify-browser-toolchain.test.mjs",
    "apps/web/src/tests/shared-tooling-adoption.test.ts",
    "apps/web/src/tests/map-poster-assets.test.ts",
}
PUBLIC_RECEIPTS = {
    "README.md",
    "CONTRIBUTING.md",
    "apps/db/README.md",
    "apps/web/README.md",
    "apps/web/CLOUDFLARE.md",
    "apps/web/static/map/basemap-montreal-posters.json",
    "apps/web/wrangler.toml",
}
TOOL_NAMES = r"node(?:js|\.js)?|python|bun|uv|wrangler|playwright(?:[-_]?core)?|chromium|gitleaks"
TOOL_LITERAL = re.compile(
    rf"\b(?:{TOOL_NAMES})(?:[-_ ]?version)?[\s\"':=@v<>~^/-]*\d+\.\d+",
    re.IGNORECASE,
)
OWNED_LITERAL = re.compile(
    r"(?<![\w.])(?:"
    + "|".join(
        re.escape(value)
        for value in (
            NODE_VERSION,
            PRODUCTION_PYTHON_VERSION,
            BUN_VERSION,
            UV_VERSION,
            WRANGLER_VERSION,
            PLAYWRIGHT_VERSION,
            CHROMIUM_VERSION,
            "8.30.1",
        )
    )
    + r")(?![\w.])"
)


@cache
def _tracked_sources() -> dict[str, str]:
    paths = subprocess.check_output(["git", "ls-files", "-z"], cwd=REPO_ROOT, text=True).split("\0")
    sources = {}
    for path in paths:
        if (
            not path
            or path in {"bun.lock", "apps/db/uv.lock"}
            or path.startswith(
                (
                    "apps/web/vendor/design/",
                    "apps/db/src/transit_ops/db/migrations/versions/",
                )
            )
        ):
            continue
        try:
            sources[path] = (REPO_ROOT / path).read_text(encoding="utf-8")
        except (UnicodeDecodeError, FileNotFoundError):
            continue
    return sources


def _external_docker_images(source: str) -> list[str]:
    stages = {"scratch"}
    images = []
    for line in re.sub(r"\\\r?\n", " ", source).splitlines():
        if not re.match(r"\s*FROM\s", line, re.IGNORECASE):
            continue
        words = [word for word in shlex.split(line, comments=True)[1:] if not word.startswith("--")]
        image, *alias = words
        if image.lower() not in stages:
            images.append(image)
        if alias:
            assert len(alias) == 2 and alias[0].lower() == "as", line
            stages.add(alias[1].lower())
    return images


def _mappings(document: object) -> list[dict[str, object]]:
    if isinstance(document, list):
        return [mapping for child in document for mapping in _mappings(child)]
    if not isinstance(document, dict):
        return []
    return [document, *(mapping for child in document.values() for mapping in _mappings(child))]


def _setup_version_literals(document: object) -> list[str]:
    return [
        str(value)
        for row in _mappings(document)
        if re.search(r"/setup-(?:node|python|bun|uv)@", str(row.get("uses", "")))
        for key, value in row.get("with", {}).items()
        if re.fullmatch(r"(?:node-|python-|bun-)?version", key) and re.search(r"\d", str(value))
    ]


def _inventory_violations(sources: dict[str, str]) -> list[str]:
    violations = []
    documents = {
        path: yaml.safe_load(source)
        for path, source in sources.items()
        if Path(path).suffix in {".yml", ".yaml"}
    }
    dockerfiles = {
        path
        for path in sources
        if Path(path).name.lower().startswith(("dockerfile", "containerfile"))
        or path.lower().endswith(".dockerfile")
    }
    for path, document in documents.items():
        for row in _mappings(document):
            build = row.get("build")
            if isinstance(build, dict) and "dockerfile" in build:
                dockerfiles.add(
                    posixpath.normpath(
                        str(Path(path).parent / build.get("context", ".") / build["dockerfile"])
                    )
                )
    violations.extend(
        f"{path}: referenced Dockerfile must be tracked"
        for path in sorted(dockerfiles - sources.keys())
    )
    for path, source in sources.items():
        if path in COMPATIBILITY_PROOFS:
            continue
        document = documents.get(path)
        if re.search(r"\bwrangler@(?:[^\s\"'`]+)", source, re.IGNORECASE) or re.search(
            r"\b(?:npx|bunx|(?:npm|pnpm|yarn|bun)\s+(?:exec|dlx|add|install))"
            r"[\s\"'`,\[\]]+(?:--?\S+[\s\"'`,\[\]]+)*wrangler\b",
            source,
        ):
            violations.append(f"{path}: ad-hoc Wrangler executable")
        if path not in VERSION_OWNERS | PUBLIC_RECEIPTS and (
            TOOL_LITERAL.search(source)
            or OWNED_LITERAL.search(source)
            or _setup_version_literals(document)
        ):
            violations.append(f"{path}: tool version outside an owner, proof, or receipt")
        images = []
        name = Path(path).name.lower()
        if path in dockerfiles:
            images = _external_docker_images(source)
        elif document is not None:
            images = [
                str(row["image"])
                for row in _mappings(document)
                if row.get("image") and "build" not in row
            ]
            images += [
                image
                for row in _mappings(document)
                if "dockerfile_inline" in row
                for image in _external_docker_images(row["dockerfile_inline"])
            ]
        if any(
            not re.fullmatch(r"[^\s@$]+:[^\s@$]+@sha256:[0-9a-f]{64}", image) for image in images
        ):
            violations.append(f"{path}: external image requires a readable tag and SHA-256 digest")
        if name == "package.json":
            package = json.loads(source)
            if path != "package.json" and any(
                "wrangler" in package.get(section, {})
                for section in ("dependencies", "devDependencies", "optionalDependencies")
            ):
                violations.append(f"{path}: Wrangler is owned by the root package")
    return violations


def test_tracked_toolchain_inventory_has_only_reviewed_owners_and_images() -> None:
    assert _inventory_violations(_tracked_sources()) == []


@pytest.mark.parametrize(
    ("path", "source", "failure"),
    [
        ("new/Dockerfile", f"FROM {PYTHON_IMAGE} AS build\nFROM node:22\n", "external image"),
        ("new/worker.dockerfile", "FROM --platform=$BUILDPLATFORM python:3.12\n", "external image"),
        (
            "new/compose.yaml",
            "services:\n  db:\n    image: transit-external:latest\n",
            "external image",
        ),
        ("new/compose.yml", "services:\n  db:\n    image: '${DB_IMAGE}'\n", "external image"),
        (
            "new/compose.yml",
            "services:\n  db:\n    build:\n      dockerfile_inline: FROM python:3.12\n",
            "external image",
        ),
        ("new/deploy.sh", "npx wrangler deploy", "ad-hoc Wrangler"),
        ("new/deploy.mjs", 'spawn("bunx", ["wrangler@latest", "deploy"]);', "ad-hoc Wrangler"),
        ("new/deploy.js", 'spawn("npx", ["wrangler", "deploy"]);', "ad-hoc Wrangler"),
        ("new/package.json", '{"devDependencies":{"wrangler":"4.999.0"}}', "root package"),
        ("new/tool.mjs", "const NODE_VERSION = '20.18.0';", "tool version outside"),
        ("new/setup.yml", "with:\n  python-version: '3.13'\n", "tool version outside"),
        (
            "new/setup-uv.yml",
            "uses: astral-sh/setup-uv@v9\nwith:\n  version: '0.17.0'\n",
            "tool version outside",
        ),
    ],
)
def test_inventory_rejects_new_unowned_executable_surfaces(
    path: str, source: str, failure: str
) -> None:
    assert any(failure in issue for issue in _inventory_violations({path: source}))


def test_inventory_accepts_local_stages_and_compose_builds() -> None:
    assert (
        _inventory_violations(
            {
                "new/Dockerfile": f"FROM {POSTGRES_IMAGE} AS build\nFROM build\nFROM scratch\n",
                "new/compose.yml": "services:\n  app:\n    build: .\n    image: local-app:test\n",
            }
        )
        == []
    )


def test_inventory_follows_compose_dockerfile_paths() -> None:
    sources = {
        "new/compose.yml": (
            "services:\n  app:\n    build:\n      context: ..\n      dockerfile: custom.build\n"
        ),
        "custom.build": "FROM node:22\n",
    }
    assert any("custom.build: external image" in issue for issue in _inventory_violations(sources))


def _json(path: str) -> dict[str, object]:
    return json.loads((REPO_ROOT / path).read_text(encoding="utf-8"))


def _yaml(path: Path) -> dict[str, object]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def _workflow_paths() -> list[Path]:
    return sorted(
        REPO_ROOT / path
        for path in _tracked_sources()
        if Path(path).parent == Path(".github/workflows") and Path(path).suffix in {".yml", ".yaml"}
    )


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
    assert root_package["devDependencies"]["wrangler"] == WRANGLER_VERSION


def test_every_javascript_workflow_lane_installs_the_selected_node() -> None:
    consumers: list[str] = []
    missing_setup: list[str] = []
    literal_node_versions: list[str] = []

    for workflow_path in _workflow_paths():
        workflow = _yaml(workflow_path)
        for job_name, job in workflow.get("jobs", {}).items():
            if not isinstance(job, dict):
                continue
            runs = _step_runs(job)
            if not re.search(r"(^|[\s;&|])(node|bun|bunx|npm|npx|pnpm|yarn)(?=\s|$)", runs):
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
    browser_contract = _json("apps/web/browser-toolchain.json")
    installer = REPO_ROOT / "apps/web/scripts/install-browser-toolchain.mjs"
    artifact_verifier = REPO_ROOT / "apps/web/scripts/browser-toolchain.mjs"
    verifier = REPO_ROOT / "apps/web/scripts/verify-browser-toolchain.mjs"

    assert web_package["devDependencies"]["playwright-core"] == PLAYWRIGHT_VERSION
    assert receipt["reproduced_with"] == {
        "playwright_core_version": PLAYWRIGHT_VERSION,
        "chromium_version": CHROMIUM_VERSION,
    }
    assert browser_contract["playwrightCoreVersion"] == PLAYWRIGHT_VERSION
    assert browser_contract["browser"]["version"] == CHROMIUM_VERSION
    assert browser_contract["browser"]["revision"] == "1234"
    assert browser_contract["browser"]["platform"] == "linux-x64"
    assert browser_contract["browser"]["archiveBytes"] == 120_231_126
    assert browser_contract["browser"]["archiveSha256"] == CHROMIUM_ARCHIVE_SHA256
    assert browser_contract["browser"]["executableSha256"] == CHROMIUM_EXECUTABLE_SHA256
    assert installer.is_file()
    assert artifact_verifier.is_file()
    assert verifier.is_file()

    web_workflow = _yaml(WORKFLOWS / "web.yml")
    ci_runs = _step_runs(web_workflow["jobs"]["ci-work"])
    assert "playwright-core install" not in ci_runs
    assert "install-browser-toolchain.test.mjs" in ci_runs
    assert "install-browser-toolchain.mjs" in ci_runs
    assert "verify-browser-toolchain.mjs" in ci_runs


def test_external_container_images_are_readable_and_immutable() -> None:
    sources = _tracked_sources()
    assert _external_docker_images(sources["apps/db/Dockerfile"]) == [PYTHON_IMAGE]
    assert PRODUCTION_PYTHON_VERSION in PYTHON_IMAGE
    assert _external_docker_images(sources["apps/db/Dockerfile.health"]) == [PYTHON_IMAGE]
    assert _external_docker_images(sources["apps/db/Dockerfile.postgis"]) == [POSTGRES_IMAGE]

    compose = _yaml(REPO_ROOT / "apps/db/docker-compose.yml")
    disposable = _yaml(REPO_ROOT / "apps/db/docker-compose.real-db.yml")
    assert compose["services"]["caddy"]["image"] == CADDY_IMAGE
    assert disposable["services"]["postgres"]["image"] == DISPOSABLE_POSTGIS_IMAGE


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
    for workflow_path in _workflow_paths():
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
