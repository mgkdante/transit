from pathlib import Path

import yaml

REPO_ROOT = Path(__file__).resolve().parents[1]


def _compose() -> dict:
    return yaml.safe_load((REPO_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))


def _active_lines(text: str) -> list[str]:
    return [
        line.split("#", 1)[0].strip()
        for line in text.splitlines()
        if line.split("#", 1)[0].strip()
    ]


def test_compose_defines_oracle_ready_runtime_services() -> None:
    services = _compose()["services"]
    assert set(services) == {"postgres", "worker", "health", "caddy"}
    assert services["postgres"]["image"] == "postgres:16"
    assert services["worker"]["build"]["dockerfile"] == "Dockerfile"
    assert services["health"]["build"]["dockerfile"] == "Dockerfile.health"
    assert services["caddy"]["image"].startswith("caddy:2")


def test_compose_waits_for_postgres_health_before_app_services() -> None:
    services = _compose()["services"]
    assert services["postgres"]["healthcheck"]["test"] == [
        "CMD-SHELL",
        'pg_isready -U "$${POSTGRES_USER}" -d "$${POSTGRES_DB}"',
    ]
    for service_name in ("worker", "health"):
        assert services[service_name]["depends_on"] == {
            "postgres": {"condition": "service_healthy"}
        }


def test_compose_defaults_app_services_to_internal_postgres() -> None:
    services = _compose()["services"]
    expected = (
        "postgresql://${POSTGRES_USER:-transit}:"
        "${POSTGRES_PASSWORD:-transit-local-password}@postgres:5432/"
        "${POSTGRES_DB:-transit}"
    )
    assert services["worker"]["environment"]["DATABASE_URL"] == expected
    assert services["health"]["environment"]["DATABASE_URL"] == expected
    assert services["postgres"]["ports"] == ["${POSTGRES_HOST_PORT:-5432}:5432"]


def test_caddyfile_proxies_only_health_service() -> None:
    caddyfile = (REPO_ROOT / "Caddyfile").read_text(encoding="utf-8")
    active_directives = _active_lines(caddyfile)
    reverse_proxy_targets = [
        line.split()[1]
        for line in active_directives
        if line.startswith("reverse_proxy ")
    ]
    assert reverse_proxy_targets == ["health:8080"]
    assert "health_uri /health/live" in active_directives
    assert not any("dashboard" in line.lower() for line in active_directives)
    assert not any("powerbi" in line.lower() for line in active_directives)


def test_env_example_documents_compose_runtime_contract() -> None:
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    assignments = {line for line in _active_lines(env_example) if "=" in line}
    assert {
        "POSTGRES_DB=transit",
        "POSTGRES_USER=transit",
        "POSTGRES_PASSWORD=transit-local-password",
        "POSTGRES_HOST_PORT=5432",
        "CADDY_SITE_ADDRESS=:80",
        "CADDY_HTTP_PORT=8080",
        "CADDY_HTTPS_PORT=8443",
    }.issubset(assignments)
    assert not any(line.startswith("DATABASE_COMPUTE_") for line in assignments)
    assert not any(line.startswith("NE" "ON_") for line in assignments)
    assert not any(line.startswith("RAIL" "WAY_") for line in assignments)
    assert "Oracle VM Postgres" in env_example


def test_weekly_pg_repack_workflow_runs_guardrail_script() -> None:
    workflow = (REPO_ROOT / ".github/workflows/weekly-pg-repack.yml").read_text(
        encoding="utf-8"
    )

    assert "name: Weekly pg_repack Guardrail" in workflow
    assert 'cron: "0 8 * * 0"' in workflow
    assert 'PG_REPACK_DRY_RUN: "true"' in workflow
    assert "postgresql-16-repack" in workflow
    assert "bash scripts/run-pg-repack.sh" in workflow
