import math
import re
from pathlib import Path

import yaml

from transit_ops.settings import Settings

DB_ROOT = Path(__file__).resolve().parents[1]
REPO_ROOT = Path(__file__).resolve().parents[3]

# Third-party / local-tooling secrets the operator keeps in the root .env for AI
# tooling and 1Password inject. NONE of them are app config, so NO container
# should ever receive them — the whole point of scoping compose env per service.
THIRD_PARTY_SECRETS = {
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GOOGLE_API_KEY",
    "OP_TOKEN",
    "NOTION_INTEGRATION_TOKEN",
    "ARCGIS_API_KEY",
    "ARCGIS_CLIENT_ID",
    "ARCGIS_CLIENT_SECRET",
}

# HEALTH_* knobs are read ONLY by transit_ops.health (verified: no usage outside
# src/transit_ops/health/). They are the one slice of the Settings surface the
# worker does NOT need, so the worker env = full Settings surface minus these.
HEALTH_ONLY_SETTINGS = {
    "HEALTH_DATABASE_TIMEOUT_SECONDS",
    "HEALTH_FEED_TIMEOUT_SECONDS",
    "HEALTH_MAX_PIPELINE_AGE_SECONDS",
    "HEALTH_RUNTIME_CACHE_SECONDS",
}

# Explicit pin for the health service: DB + bronze-storage + HEALTH_* + provider
# id + the five retention values run_health_checks reports. NO STM_API_KEY
# (run_health_checks does not reach any STM feed).
HEALTH_ENVIRONMENT_KEYS = {
    "DATABASE_URL",
    "APP_ENV",
    "LOG_LEVEL",
    "STM_PROVIDER_ID",
    "BRONZE_STORAGE_BACKEND",
    "BRONZE_LOCAL_ROOT",
    "BRONZE_S3_ENDPOINT",
    "BRONZE_S3_BUCKET",
    "BRONZE_S3_ACCESS_KEY",
    "BRONZE_S3_SECRET_KEY",
    "BRONZE_S3_REGION",
    "HEALTH_DATABASE_TIMEOUT_SECONDS",
    "HEALTH_FEED_TIMEOUT_SECONDS",
    "HEALTH_MAX_PIPELINE_AGE_SECONDS",
    "HEALTH_RUNTIME_CACHE_SECONDS",
    "BRONZE_REALTIME_RETENTION_DAYS",
    "BRONZE_STATIC_RETENTION_DAYS",
    "SILVER_REALTIME_RETENTION_DAYS",
    "GOLD_FACT_RETENTION_DAYS",
    "GOLD_WARM_ROLLUP_RETENTION_DAYS",
}


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
    assert "apps/db/artifacts/retention-proof.json" in workflow

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


def test_refresh_basemap_workflow_extract_is_square_and_centered_on_montreal_island() -> None:
    workflow = yaml.safe_load(
        (REPO_ROOT / ".github/workflows/refresh-basemap.yml").read_text(encoding="utf-8")
    )
    bbox_raw = workflow["env"]["BBOX"]
    min_lon, min_lat, max_lon, max_lat = (float(part) for part in bbox_raw.split(","))

    assert bbox_raw == "-74.17628,45.23742,-73.27628,45.86764"
    # Centered on the OSM Île de Montréal relation bounds-center.
    assert math.isclose((min_lon + max_lon) / 2, -73.72628)
    assert math.isclose((min_lat + max_lat) / 2, 45.55253)

    def mercator_y(lat: float) -> float:
        radians = math.radians(lat)
        return math.log(math.tan(math.pi / 4 + radians / 2))

    width = math.radians(max_lon - min_lon)
    height = mercator_y(max_lat) - mercator_y(min_lat)
    assert abs(width / height - 1) <= 0.03


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


def _environment_keys(service: dict) -> set[str]:
    env = service.get("environment", {})
    # compose accepts both a mapping and a list of "KEY=VALUE" strings.
    if isinstance(env, dict):
        return set(env)
    return {entry.split("=", 1)[0] for entry in env}


def test_compose_services_define_scoped_environment_without_env_file() -> None:
    # slice-9.1.1w: dropping the bulk `env_file: - .env` blocks stops every
    # container (including the third-party caddy:2 image) from receiving the
    # operator's local AI-tooling secrets. Each service now enumerates only the
    # vars it needs via compose interpolation.
    services = _compose()["services"]
    for name, service in services.items():
        assert "env_file" not in service, f"{name} still bulk-injects env_file"
        leaked = _environment_keys(service) & THIRD_PARTY_SECRETS
        assert not leaked, f"{name} environment leaks third-party secrets: {leaked}"


def test_compose_caddy_environment_is_site_address_only() -> None:
    services = _compose()["services"]
    assert _environment_keys(services["caddy"]) == {"CADDY_SITE_ADDRESS"}


def test_compose_worker_environment_covers_pipeline_settings_only() -> None:
    # The worker runs the full pipeline (run-realtime-worker), so it must receive
    # every Settings knob EXCEPT the health-only HEALTH_* ones — otherwise a VM
    # override silently disappears (Settings has extra="ignore") and the default
    # is used at runtime. Computing the expectation from Settings.model_fields
    # keeps this contract honest as new fields land (plan-freshness trigger (b)).
    services = _compose()["services"]
    worker_keys = _environment_keys(services["worker"])
    expected = set(Settings.model_fields) - HEALTH_ONLY_SETTINGS
    assert worker_keys == expected
    # Typo guard: every literal env var (minus the interpolated DATABASE_URL) must
    # be a real Settings field, or extra="ignore" would silently drop it.
    assert (worker_keys - {"DATABASE_URL"}) <= set(Settings.model_fields)
    assert "STM_API_KEY" in worker_keys


def test_compose_runtime_defaults_match_settings_retention_contract() -> None:
    services = _compose()["services"]
    settings = Settings(_env_file=None)

    worker_env = services["worker"]["environment"]
    health_env = services["health"]["environment"]

    assert (
        worker_env["SILVER_REALTIME_PRUNE_BATCH"]
        == f"${{SILVER_REALTIME_PRUNE_BATCH:-{settings.SILVER_REALTIME_PRUNE_BATCH}}}"
    )
    assert (
        worker_env["GOLD_FACT_PRUNE_BATCH"]
        == f"${{GOLD_FACT_PRUNE_BATCH:-{settings.GOLD_FACT_PRUNE_BATCH}}}"
    )
    assert (
        worker_env["BRONZE_STATIC_RETENTION_DAYS"]
        == f"${{BRONZE_STATIC_RETENTION_DAYS:-{settings.BRONZE_STATIC_RETENTION_DAYS}}}"
    )
    assert (
        health_env["BRONZE_STATIC_RETENTION_DAYS"]
        == f"${{BRONZE_STATIC_RETENTION_DAYS:-{settings.BRONZE_STATIC_RETENTION_DAYS}}}"
    )


def test_compose_health_environment_excludes_stm_credentials() -> None:
    services = _compose()["services"]
    health_keys = _environment_keys(services["health"])
    assert health_keys == HEALTH_ENVIRONMENT_KEYS
    assert "STM_API_KEY" not in health_keys
    assert (health_keys - {"DATABASE_URL"}) <= set(Settings.model_fields)


def test_compose_postgres_environment_is_bootstrap_only() -> None:
    services = _compose()["services"]
    assert _environment_keys(services["postgres"]) == {
        "POSTGRES_DB",
        "POSTGRES_USER",
        "POSTGRES_PASSWORD",
    }


def test_repo_contracts_describe_web_serving_layer_not_powerbi() -> None:
    # slice-9.1.1w: Power BI was retired (2026-05-30) for the web/ citizen app
    # fed by the /v1 R2 snapshot contract. The cross-tool repo contracts must not
    # still claim Power BI is the serving layer.
    for rel in ("AGENTS.md", "CLAUDE.md"):
        text = (REPO_ROOT / rel).read_text(encoding="utf-8")
        assert "Power BI" not in text, f"{rel} still mentions Power BI"
        assert ".pbix" not in text, f"{rel} still mentions .pbix"
    serving_readme = (
        DB_ROOT / "infra" / "postgres-serving-access" / "README.md"
    ).read_text(encoding="utf-8")
    assert "Power BI" not in serving_readme
    assert "/v1" in (REPO_ROOT / "AGENTS.md").read_text(encoding="utf-8")


def test_env_example_documents_all_runtime_knobs() -> None:
    # slice-9.1.1w: these four knobs were live in settings.py / consumed by the
    # worker but undocumented in .env.example, so an operator had no way to know
    # they could be tuned.
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    assignments = {line for line in _active_lines(env_example) if "=" in line}
    assert {
        "STM_GIS_URL=",
        "STM_I3_ALERTS_URL=",
        "PIPELINE_PAUSED=false",
        "HEALTH_RUNTIME_CACHE_SECONDS=30",
        "SILVER_REALTIME_RETENTION_DAYS=10",
        "GOLD_FACT_RETENTION_DAYS=14",
    }.issubset(assignments)


def test_retention_docs_match_gold_fact_default_of_fourteen_days() -> None:
    # GOLD_FACT_RETENTION_DAYS default is 14 (settings.py); the prose must not
    # contradict it with a stale "7 days" claim.
    env_example = (REPO_ROOT / ".env.example").read_text(encoding="utf-8")
    env_1password = (REPO_ROOT / ".env.1password").read_text(encoding="utf-8")
    assert "GOLD_FACT_RETENTION_DAYS=7" not in _active_lines(env_example)
    assert "GOLD_FACT_RETENTION_DAYS=7" not in _active_lines(env_1password)
    assert "Gold facts keep 14 days" in env_example
    assert "keep 7 days" not in env_example
    readme = (REPO_ROOT / "README.md").read_text(encoding="utf-8")
    assert "Gold detail facts 14 days" in readme
    assert "Gold detail facts 7 days" not in readme


def test_env_1password_has_no_retired_neon_or_arcgis_entries() -> None:
    # slice-9.1.1w: the database compute moved off the legacy vendor and ArcGIS
    # was retired with Power BI, so neither belongs in the inject source. String
    # concatenation keeps a grep for the legacy vendor from hitting this test.
    text = (REPO_ROOT / ".env.1password").read_text(encoding="utf-8")
    assert ("Ne" "on") not in text
    assert "ARCGIS_API_KEY" not in text


def test_dead_module_dirs_stay_deleted() -> None:
    # slice-9.1.1w: these dirs held only untracked __pycache__ — the source moved
    # to source_factory/ and infra/postgres-serving-access/. Guard against an
    # accidental resurrection (a stray import re-creating the package dir).
    assert not (DB_ROOT / "src" / "transit_ops" / "rebuild").exists()
    assert not (DB_ROOT / "infra" / "postgres-public-access").exists()
