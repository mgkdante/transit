import re
from pathlib import Path

import yaml

DB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[2]


def _compose() -> dict:
    return yaml.safe_load((DB_ROOT / "docker-compose.yml").read_text(encoding="utf-8"))


def _active_lines(text: str) -> list[str]:
    return [
        line.split("#", 1)[0].strip()
        for line in text.splitlines()
        if line.split("#", 1)[0].strip()
    ]


def test_compose_defines_oracle_ready_runtime_services() -> None:
    services = _compose()["services"]
    assert set(services) == {"postgres", "worker", "health", "caddy"}
    assert services["postgres"]["build"]["dockerfile"] == "Dockerfile.postgis"
    assert services["postgres"]["image"] == "transit-postgres-postgis:16"
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
    caddyfile = (DB_ROOT / "Caddyfile").read_text(encoding="utf-8")
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


def test_worker_dockerfile_ships_pg_dump_16_client() -> None:
    dockerfile = (DB_ROOT / "Dockerfile").read_text(encoding="utf-8")

    # The compose postgres service is transit-postgres-postgis:16 (postgres:16
    # base), and slim bookworm's stock client is 15, so the worker needs the
    # pgdg postgresql-client-16 to run pg_dump against it.
    assert "apt.postgresql.org.sh" in dockerfile
    assert "postgresql-client-16" in dockerfile


def test_weekly_pg_repack_workflow_executes_on_schedule() -> None:
    workflow = (REPO_ROOT / ".github/workflows/weekly-pg-repack.yml").read_text(
        encoding="utf-8"
    )

    # slice-9.1.1m: the scheduled Sunday run now EXECUTES a table-scoped repack.
    assert 'cron: "0 8 * * 0"' in workflow
    # The dry-run pin is gone: a hard 'PG_REPACK_DRY_RUN: "true"' at job level
    # overrode GITHUB_ENV, so manual dry_run=false ALSO never executed. The flag
    # is now an expression — schedule executes, dispatch defaults to dry-run.
    assert 'PG_REPACK_DRY_RUN: "true"' not in workflow
    assert "github.event_name == 'schedule' && 'false'" in workflow
    assert "inputs.dry_run" in workflow
    # The dead 'Select manual mode' GITHUB_ENV step is removed (job-level env wins
    # over GITHUB_ENV — that was the original silent-no-execute bug).
    assert "GITHUB_ENV" not in workflow
    # psql is needed for the before/after size report + leftover-object check.
    assert "postgresql-16-repack" in workflow
    assert "postgresql-client-16" in workflow
    # Size-report artifact gives an execute run an auditable receipt.
    assert "actions/upload-artifact@v4" in workflow
    assert "pg-repack-size-report" in workflow
    # First execute weeks rewrite live rows over WAN copies — give it headroom.
    assert "timeout-minutes: 180" in workflow
    assert "bash scripts/run-pg-repack.sh" in workflow


def test_daily_warm_rollups_workflow_prunes_bronze_and_uploads_retention_proof() -> None:
    workflow = (REPO_ROOT / ".github/workflows/daily-warm-rollups.yml").read_text(
        encoding="utf-8"
    )

    # Bronze prune runs after the warm-rollup prune, with defaults
    # (1 batch x 5000 per phase) so a backlog can never blow the job timeout.
    assert "prune-bronze-storage stm" in workflow
    assert workflow.index("prune-bronze-storage stm") > workflow.index(
        "prune-warm-rollup-storage stm"
    )
    # Proof report + artifact give the prune a daily visible receipt.
    assert "retention-proof-report stm --report-path" in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert "if: always()" in workflow
    # upload-artifact paths are workspace-relative (working-directory does
    # not apply to `uses:` steps).
    assert "db/artifacts/retention-proof.json" in workflow

    timeout_match = re.search(r"timeout-minutes:\s*(\d+)", workflow)
    assert timeout_match is not None
    assert int(timeout_match.group(1)) >= 35


def test_daily_static_pipeline_workflow_runs_gis_inside_pipeline_before_static_publish() -> None:
    workflow = (REPO_ROOT / ".github/workflows/daily-static-pipeline.yml").read_text(
        encoding="utf-8"
    )

    # slice-9.1.1v: GIS runs in-process as a best-effort tail of run-static-pipeline,
    # NOT as a separate YAML step (failure isolation lives in run_static_pipeline so a
    # GIS outage never blocks the static publish).
    assert 'cron: "0 6 * * *"' in workflow
    assert "Run static + GIS Bronze -> Silver -> Gold pipeline" in workflow
    assert "ingest-gis" not in workflow
    assert workflow.index("run-static-pipeline stm") < workflow.index(
        "publish-snapshot stm --tier static"
    )
    assert "concurrency" in workflow
    assert "group: daily-static-pipeline" in workflow


def test_daily_warm_rollups_workflow_prunes_i3_after_historic_publish() -> None:
    workflow = (REPO_ROOT / ".github/workflows/daily-warm-rollups.yml").read_text(
        encoding="utf-8"
    )

    # slice-9.1.1l: the i3 prune runs daily from this job, AFTER the historic
    # /v1 publish so alert_history.json builds from unpruned silver history.
    assert "prune-i3-storage stm" in workflow
    assert workflow.index("prune-i3-storage stm") > workflow.index(
        "publish-snapshot stm --tier historic"
    )
