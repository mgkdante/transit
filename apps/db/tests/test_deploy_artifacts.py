import math
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
    # PR-B / slice-9.8: the dedicated `pruner` service joins the runtime set.
    assert set(services) == {"postgres", "worker", "pruner", "health", "caddy"}
    assert services["postgres"]["build"]["dockerfile"] == "Dockerfile.postgis"
    assert services["postgres"]["image"] == "transit-postgres-postgis:16"
    assert services["worker"]["build"]["dockerfile"] == "Dockerfile"
    assert services["pruner"]["build"]["dockerfile"] == "Dockerfile"
    assert services["health"]["build"]["dockerfile"] == "Dockerfile.health"
    assert services["caddy"]["image"].startswith("caddy:2")


def test_compose_pruner_service_runs_decoupled_prune_loop() -> None:
    services = _compose()["services"]
    pruner = services["pruner"]
    # Same image as the worker, with a command override to the pruner loop.
    assert pruner["build"]["dockerfile"] == "Dockerfile"
    assert pruner["command"] == ["run-pruner-loop", "stm"]
    assert pruner["restart"] == "unless-stopped"
    assert pruner["depends_on"] == {"postgres": {"condition": "service_healthy"}}
    # DB-only worker: NO bronze volume, NO STM_API_KEY / R2 / snapshot secrets.
    assert "volumes" not in pruner
    pruner_keys = _environment_keys(pruner)
    assert "STM_API_KEY" not in pruner_keys
    assert not any(key.startswith("BRONZE_S3") for key in pruner_keys)
    assert not any(key.startswith("SNAPSHOT_") for key in pruner_keys)
    # It DOES get the DB url, the retention knobs, the pruner cadence, and pause.
    assert pruner["environment"]["DATABASE_URL"] == (
        "postgresql://${POSTGRES_USER:-transit}:"
        "${POSTGRES_PASSWORD:-transit-local-password}@postgres:5432/"
        "${POSTGRES_DB:-transit}"
    )
    assert {
        "PRUNER_SLEEP_SECONDS",
        "SILVER_REALTIME_RETENTION_DAYS",
        "SILVER_REALTIME_PRUNE_BATCH",
        "GOLD_FACT_RETENTION_DAYS",
        "GOLD_FACT_PRUNE_BATCH",
        "STATIC_DATASET_RETENTION_COUNT",
        "PIPELINE_PAUSED",
    } <= pruner_keys
    # The pruner env is a strict subset of the worker's (no new knobs introduced).
    assert pruner_keys <= _environment_keys(services["worker"])


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


def test_weekly_pg_repack_workflow_is_dry_run_monitor() -> None:
    workflow = (REPO_ROOT / ".github/workflows/weekly-pg-repack.yml").read_text(
        encoding="utf-8"
    )

    assert 'cron: "0 8 * * 0"' in workflow
    # 2026-06-22: the workflow is now a dry-run bloat MONITOR. pg_repack's execute
    # path runs over the WAN (GitHub runner to the OCI Postgres); the long ACCESS
    # EXCLUSIVE swap dropped the SSL connection and orphaned repack objects, so
    # the scheduled run must NEVER execute. The flag is hardcoded true, and the
    # schedule-executes expression + the dry_run dispatch input are both gone.
    # Actual repack is done on-box via the on-VM runbook.
    assert 'PG_REPACK_DRY_RUN: "true"' in workflow
    assert "github.event_name == 'schedule'" not in workflow
    assert "&& 'false'" not in workflow
    assert "inputs.dry_run" not in workflow
    # No dead GITHUB_ENV mode step (job-level env wins over GITHUB_ENV).
    assert "GITHUB_ENV" not in workflow
    # psql is needed for the size report + the (execute-only) leftover-object check.
    assert "postgresql-16-repack" in workflow
    assert "postgresql-client-16" in workflow
    # The size-report artifact is the bloat signal a dry-run leaves behind.
    assert "actions/upload-artifact@v4" in workflow
    assert "pg-repack-size-report" in workflow
    # Dry-run is fast; no multi-hour WAN-rewrite headroom needed.
    assert "timeout-minutes: 30" in workflow
    assert "bash scripts/run-pg-repack.sh" in workflow


def test_daily_warm_rollups_workflow_prunes_bronze_and_uploads_retention_proof() -> None:
    workflow = (REPO_ROOT / ".github/workflows/daily-warm-rollups.yml").read_text(encoding="utf-8")
    document = yaml.safe_load(workflow)

    # Each provider gets a bounded, serial retention job after publication.
    # Exhaustion is required so a capped backlog cannot silently keep growing.
    assert 'prune-bronze-storage "$PROVIDER_ID" --require-exhausted' in workflow
    assert workflow.index(
        'prune-bronze-storage "$PROVIDER_ID" --require-exhausted'
    ) > workflow.index('prune-warm-rollup-storage "$PROVIDER_ID"')
    # Proof report + artifact give the prune a daily visible receipt.
    assert 'retention-proof-report "$PROVIDER_ID" --report-path' in workflow
    assert "actions/upload-artifact@v4" in workflow
    assert "if: always()" in workflow
    # upload-artifact paths are workspace-relative (working-directory does
    # not apply to `uses:` steps).
    assert "apps/db/artifacts/daily-warm-rollups/retention/" in workflow

    assert document["jobs"]["retention"]["timeout-minutes"] >= 35


def test_daily_warm_rollups_bounds_expensive_work_and_gates_publish() -> None:
    document = yaml.safe_load(
        (REPO_ROOT / ".github/workflows/daily-warm-rollups.yml").read_text(
            encoding="utf-8"
        )
    )
    rollups = document["jobs"]["rollups"]
    build = next(step for step in rollups["steps"] if step["name"] == "Build warm rollups")
    publish = document["jobs"]["publish"]

    assert build["timeout-minutes"] == 75
    assert publish["timeout-minutes"] == 90
    assert publish["if"] == (
        "${{ always() && needs.prepare.result == 'success' "
        "&& needs.rollups.result == 'success' }}"
    )


def test_ci_runs_for_db_and_ci_contract_changes() -> None:
    document = yaml.safe_load(
        (REPO_ROOT / ".github/workflows/ci.yml").read_text(encoding="utf-8")
    )
    on = document.get("on", document.get(True, {}))
    expected_paths = {
        "apps/db/**",
        ".github/workflows/**",
        ".github/scripts/**",
        ".github/actions/**",
        ".bun-version",
    }

    assert set(on["pull_request"]["paths"]) == expected_paths
    assert set(on["push"]["paths"]) == expected_paths


def test_daily_static_pipeline_workflow_runs_gis_inside_pipeline_before_static_publish() -> None:
    workflow = (REPO_ROOT / ".github/workflows/daily-static-pipeline.yml").read_text(
        encoding="utf-8"
    )
    document = yaml.safe_load(workflow)

    # slice-9.1.1v: GIS runs in-process as a best-effort tail of run-static-pipeline,
    # NOT as a separate YAML step (failure isolation lives in run_static_pipeline so a
    # GIS outage never blocks the static publish).
    assert 'cron: "0 6 * * *"' in workflow
    assert "Run static + GIS Bronze -> Silver -> Gold pipeline" in workflow
    assert "ingest-gis" not in workflow
    # One looped job over every provider (no per-provider workflow edit), and the
    # static pipeline still runs before the static publish.
    assert "list-providers" in workflow
    assert 'run-static-pipeline "$provider"' in workflow
    assert workflow.index('run-static-pipeline "$provider"') < workflow.index(
        "publish-all --tier static"
    )
    assert "concurrency" in workflow
    assert "group: daily-static-pipeline" in workflow
    assert document["jobs"]["run-static-pipeline"]["timeout-minutes"] == 30


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
    assert 'prune-i3-storage "$PROVIDER_ID"' in workflow
    assert workflow.index('prune-i3-storage "$PROVIDER_ID"') > workflow.index(
        "publish-all --tier historic"
    )


def test_daily_warm_rollups_archives_alerts_before_expensive_build_and_publish() -> None:
    workflow = (REPO_ROOT / ".github/workflows/daily-warm-rollups.yml").read_text(encoding="utf-8")

    sync = workflow.index('sync-alert-archive "$provider"')
    build = workflow.index('build-warm-rollups "$PROVIDER_ID"')
    publish = workflow.index("publish-all --tier historic")
    prune = workflow.index('prune-i3-storage "$PROVIDER_ID"')

    assert sync < build < publish < prune


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
    pruner_env = services["pruner"]["environment"]
    health_env = services["health"]["environment"]

    for service_env in (worker_env, pruner_env, health_env):
        assert service_env["SILVER_REALTIME_RETENTION_DAYS"] == (
            "${SILVER_REALTIME_RETENTION_DAYS:-1}"
        )
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
    assert worker_env["BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH"] == (
        "${BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH:-5000}"
    )
    assert worker_env["BRONZE_PRUNE_MAX_BATCHES"] == ("${BRONZE_PRUNE_MAX_BATCHES:-2}")


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
        "SILVER_REALTIME_RETENTION_DAYS=1",
        "GOLD_FACT_RETENTION_DAYS=14",
        "BRONZE_REALTIME_RETENTION_DAYS=90",
        "GOLD_WARM_ROLLUP_RETENTION_DAYS=730",
        "BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH=5000",
        "BRONZE_PRUNE_MAX_BATCHES=2",
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
