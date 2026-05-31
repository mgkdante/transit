from __future__ import annotations

import json
from datetime import UTC, date, datetime, timedelta
from pathlib import Path

import typer
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from transit_ops.core.models import FeedKind, ProviderManifest
from transit_ops.db.connection import make_engine, test_connection
from transit_ops.gold import (
    build_gold_marts,
    build_warm_rollups,
    refresh_gold_realtime,
    refresh_gold_static,
)
from transit_ops.ingestion import (
    capture_i3_alerts,
    capture_realtime_feed,
    ingest_gis_feed,
    ingest_static_feed,
)
from transit_ops.logging import configure_logging
from transit_ops.maintenance import (
    prune_bronze_storage,
    prune_gold_storage,
    prune_silver_storage,
    prune_warm_rollup_storage,
    vacuum_storage,
)
from transit_ops.orchestration import (
    run_realtime_cycle,
    run_realtime_worker_loop,
    run_static_pipeline,
)
from transit_ops.providers import ProviderRegistry
from transit_ops.recovery import RECOVERY_ACTION_IDS, run_recovery_action
from transit_ops.settings import Settings, get_settings
from transit_ops.silver import (
    load_latest_gis_to_silver,
    load_latest_i3_to_silver,
    load_latest_realtime_to_silver,
    load_latest_static_to_silver,
)
from transit_ops.snapshots.publish import publish_snapshot
from transit_ops.source_factory.runner import run_source_factory_rebuild
from transit_ops.validation.proof import build_retention_proof_report
from transit_ops.validation.static_feeds import validate_static_feeds

app = typer.Typer(
    help=(
        "Transit Ops CLI for repository bootstrap, provider registry, "
        "Bronze ingestion, Silver loading, Gold marts, and database foundation."
    )
)


def _project_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _alembic_config(settings: Settings) -> Config:
    if not settings.sqlalchemy_database_url:
        raise typer.BadParameter("DATABASE_URL is required for init-db.")

    config = Config(str(_project_root() / "alembic.ini"))
    script_location = _project_root() / "src/transit_ops/db/migrations"
    config.set_main_option("script_location", str(script_location))
    config.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_url)
    return config


def _provider_registry(settings: Settings) -> ProviderRegistry:
    return ProviderRegistry.from_project_root(project_root=_project_root(), settings=settings)


def _preflight_report_path(report_path: Path | None) -> None:
    if report_path is None:
        return

    if report_path.exists() and report_path.is_dir():
        raise typer.BadParameter(f"--report-path must be a file path, got directory: {report_path}")
    if not report_path.parent.exists():
        raise typer.BadParameter(
            f"--report-path parent directory does not exist: {report_path.parent}"
        )

    try:
        with report_path.open("a", encoding="utf-8"):
            pass
    except OSError as exc:
        raise typer.BadParameter(f"--report-path is not writable: {report_path}") from exc


def _preflight_report_dir(report_dir: Path) -> None:
    if report_dir.exists() and not report_dir.is_dir():
        raise typer.BadParameter(f"--report-dir must be a directory, got file: {report_dir}")
    if not report_dir.parent.exists():
        raise typer.BadParameter(
            f"--report-dir parent directory does not exist: {report_dir.parent}"
        )

    try:
        report_dir.mkdir(exist_ok=True)
    except OSError as exc:
        raise typer.BadParameter(f"--report-dir is not writable: {report_dir}") from exc


def _default_source_factory_keep_from_date(settings: Settings) -> date:
    retention_days = max(
        settings.BRONZE_REALTIME_RETENTION_DAYS,
        settings.BRONZE_STATIC_RETENTION_DAYS,
    )
    return datetime.now(UTC).date() - timedelta(days=retention_days)


def _seed_provider(connection, manifest: ProviderManifest) -> None:
    provider = manifest.to_provider_seed()
    connection.execute(
        text(
            """
            INSERT INTO core.providers (
                provider_id,
                provider_key,
                display_name,
                timezone,
                default_language,
                default_currency,
                min_latitude,
                max_latitude,
                min_longitude,
                max_longitude,
                attribution_text,
                website_url,
                is_active
            )
            VALUES (
                :provider_id,
                :provider_key,
                :display_name,
                :timezone,
                :default_language,
                :default_currency,
                :min_latitude,
                :max_latitude,
                :min_longitude,
                :max_longitude,
                :attribution_text,
                :website_url,
                :is_active
            )
            ON CONFLICT (provider_id) DO UPDATE SET
                provider_key = EXCLUDED.provider_key,
                display_name = EXCLUDED.display_name,
                timezone = EXCLUDED.timezone,
                default_language = EXCLUDED.default_language,
                default_currency = EXCLUDED.default_currency,
                min_latitude = EXCLUDED.min_latitude,
                max_latitude = EXCLUDED.max_latitude,
                min_longitude = EXCLUDED.min_longitude,
                max_longitude = EXCLUDED.max_longitude,
                attribution_text = EXCLUDED.attribution_text,
                website_url = EXCLUDED.website_url,
                is_active = EXCLUDED.is_active,
                updated_at_utc = now()
            """
        ),
        provider.as_params(),
    )


def _seed_feed_endpoints(connection, manifest: ProviderManifest, settings: Settings) -> None:
    feed_endpoints = manifest.to_feed_endpoint_seeds(settings)
    statement = text(
        """
        INSERT INTO core.feed_endpoints (
            provider_id,
            endpoint_key,
            feed_kind,
            source_format,
            source_url,
            auth_type,
            refresh_interval_seconds,
            is_enabled
        )
        VALUES (
            :provider_id,
            :endpoint_key,
            :feed_kind,
            :source_format,
            :source_url,
            :auth_type,
            :refresh_interval_seconds,
            :is_enabled
        )
        ON CONFLICT (provider_id, endpoint_key) DO UPDATE SET
            feed_kind = EXCLUDED.feed_kind,
            source_format = EXCLUDED.source_format,
            source_url = EXCLUDED.source_url,
            auth_type = EXCLUDED.auth_type,
            refresh_interval_seconds = EXCLUDED.refresh_interval_seconds,
            is_enabled = EXCLUDED.is_enabled,
            updated_at_utc = now()
        """
    )
    for feed_endpoint in feed_endpoints:
        connection.execute(statement, feed_endpoint.as_params())


@app.callback()
def main() -> None:
    settings = get_settings()
    configure_logging(settings.LOG_LEVEL)


@app.command("recover")
def recover_command(
    action_id: str = typer.Argument(
        ...,
        help=(
            "Recovery action id. Choices: "
            f"{', '.join(RECOVERY_ACTION_IDS)}. "
            "/health is the report/webhook target; this command only performs recovery actions."
        ),
    ),
    execute: bool = typer.Option(
        False,
        "--execute",
        help="Execute the recovery command. Defaults to dry-run planning only.",
    ),
    confirmation: str | None = typer.Option(
        None,
        "--confirm",
        help="Required with --execute; must exactly match the action id.",
    ),
) -> None:
    """/health is the report/webhook target; perform guarded recovery actions only."""

    try:
        result = run_recovery_action(
            action_id,
            execute=execute,
            confirmation=confirmation,
        )
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc

    payload = result.display_dict()
    typer.echo(json.dumps(payload, indent=2, sort_keys=True))
    if payload["status"] == "failed":
        raise typer.Exit(code=1)


@app.command("show-config")
def show_config() -> None:
    """Print the current configuration with secrets redacted."""

    typer.echo(json.dumps(get_settings().display_dict(), indent=2, sort_keys=True))


@app.command("list-providers")
def list_providers() -> None:
    """List available provider manifest ids."""

    registry = _provider_registry(get_settings())
    for provider_id in registry.list_provider_ids():
        typer.echo(provider_id)


@app.command("show-provider")
def show_provider(provider_id: str) -> None:
    """Print a validated provider manifest."""

    settings = get_settings()
    registry = _provider_registry(settings)
    try:
        provider = registry.get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(provider.to_display_dict(settings), indent=2))


@app.command("db-test")
def db_test() -> None:
    """Run a simple connectivity test against the configured database."""

    settings = get_settings()
    try:
        test_connection(settings)
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo("Database connection test passed.")


@app.command("init-db")
def init_db() -> None:
    """Apply the base Alembic migration."""

    settings = get_settings()
    command.upgrade(_alembic_config(settings), "head")
    typer.echo("Database initialized to the latest migration.")


@app.command("seed-core")
def seed_core() -> None:
    """Seed STM provider metadata and feed endpoints."""

    settings = get_settings()
    provider_manifest = _provider_registry(settings).get_provider(settings.STM_PROVIDER_ID)
    engine = make_engine(settings)
    with engine.begin() as connection:
        _seed_provider(connection, provider_manifest)
        _seed_feed_endpoints(connection, provider_manifest, settings)
        provider_count = connection.execute(
            text("SELECT count(*) FROM core.providers")
        ).scalar_one()
        endpoint_count = connection.execute(
            text("SELECT count(*) FROM core.feed_endpoints")
        ).scalar_one()
    typer.echo(
        f"Seeded core metadata successfully. Providers={provider_count}, "
        f"Feed endpoints={endpoint_count}."
    )


@app.command("ingest-static")
def ingest_static(provider_id: str) -> None:
    """Download, archive, and register one static GTFS feed."""

    settings = get_settings()
    try:
        result = ingest_static_feed(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("ingest-gis")
def ingest_gis(provider_id: str) -> None:
    """Download, archive, and register one STM GIS ZIP."""

    settings = get_settings()
    try:
        result = ingest_gis_feed(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("validate-static-feeds")
def validate_static_feeds_command(
    provider_id: str,
    report_path: Path | None = typer.Option(  # noqa: B008
        None,
        "--report-path",
        help="Write the JSON validation report to this path as well as stdout.",
    ),
) -> None:
    """Validate the active static GTFS feed without ingesting it."""

    settings = get_settings()
    try:
        _preflight_report_path(report_path)
        result = validate_static_feeds(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc

    report = json.dumps(result.display_dict(), indent=2, sort_keys=True)
    if report_path is not None:
        report_path.write_text(report + "\n", encoding="utf-8")
    typer.echo(report)


@app.command("retention-proof-report")
def retention_proof_report_command(
    provider_id: str,
    report_path: Path | None = typer.Option(  # noqa: B008
        None,
        "--report-path",
        help="Write the JSON proof report to this path as well as stdout.",
    ),
) -> None:
    """Build a non-destructive retention and storage proof report."""

    settings = get_settings()
    registry = _provider_registry(settings)
    try:
        registry.get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc

    _preflight_report_path(report_path)
    try:
        result = build_retention_proof_report(
            provider_id,
            settings=settings,
            registry=registry,
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    report = json.dumps(result.display_dict(), indent=2, sort_keys=True)
    if report_path is not None:
        report_path.write_text(report + "\n", encoding="utf-8")
    typer.echo(report)


@app.command("capture-realtime")
def capture_realtime(provider_id: str, endpoint_key: str) -> None:
    """Capture, archive, and register one GTFS-RT snapshot."""

    if endpoint_key not in {
        FeedKind.TRIP_UPDATES.value,
        FeedKind.VEHICLE_POSITIONS.value,
    }:
        raise typer.BadParameter(
            "endpoint_key must be 'trip_updates' or 'vehicle_positions'."
        )

    settings = get_settings()
    try:
        result = capture_realtime_feed(
            provider_id,
            endpoint_key,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("capture-i3")
def capture_i3(provider_id: str) -> None:
    """Capture, archive, and register one API i3 alert snapshot."""

    settings = get_settings()
    try:
        result = capture_i3_alerts(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("load-static-silver")
def load_static_silver(provider_id: str) -> None:
    """Parse the latest Bronze static GTFS archive into Silver tables."""

    settings = get_settings()
    try:
        result = load_latest_static_to_silver(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("load-gis-silver")
def load_gis_silver(provider_id: str) -> None:
    """Parse the latest Bronze GIS ZIP into Silver source tables."""

    settings = get_settings()
    try:
        result = load_latest_gis_to_silver(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("load-realtime-silver")
def load_realtime_silver(provider_id: str, endpoint_key: str) -> None:
    """Parse the latest Bronze realtime snapshot into Silver tables."""

    if endpoint_key not in {
        FeedKind.TRIP_UPDATES.value,
        FeedKind.VEHICLE_POSITIONS.value,
    }:
        raise typer.BadParameter(
            "endpoint_key must be 'trip_updates' or 'vehicle_positions'."
        )

    settings = get_settings()
    try:
        result = load_latest_realtime_to_silver(
            provider_id,
            endpoint_key,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("load-i3-silver")
def load_i3_silver(provider_id: str) -> None:
    """Normalize the latest raw i3 alert snapshot into Silver tables."""

    settings = get_settings()
    try:
        result = load_latest_i3_to_silver(
            provider_id,
            settings=settings,
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("build-gold-marts")
def build_gold(provider_id: str) -> None:
    """Run the heavy full-history Gold rebuild and refresh latest snapshot tables."""

    settings = get_settings()
    try:
        result = build_gold_marts(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("refresh-gold-realtime")
def refresh_gold_realtime_command(provider_id: str) -> None:
    """Upsert the latest realtime snapshots into Gold history and latest tables."""

    settings = get_settings()
    try:
        result = refresh_gold_realtime(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("refresh-gold-static")
def refresh_gold_static_command(provider_id: str) -> None:
    """Refresh only Gold dimension tables from the current static Silver dataset."""

    settings = get_settings()
    try:
        result = refresh_gold_static(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("prune-silver-storage")
def prune_silver_storage_command(
    provider_id: str,
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be deleted without executing any deletions.",
    ),
) -> None:
    """Prune old static and realtime Silver rows according to retention settings."""

    settings = get_settings()
    try:
        result = prune_silver_storage(provider_id, settings=settings, dry_run=dry_run)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("prune-gold-storage")
def prune_gold_storage_command(
    provider_id: str,
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be deleted without executing any deletions.",
    ),
) -> None:
    """Prune old Gold fact rows according to GOLD_FACT_RETENTION_DAYS."""

    settings = get_settings()
    try:
        result = prune_gold_storage(provider_id, settings=settings, dry_run=dry_run)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("vacuum-storage")
def vacuum_storage_command(
    provider_id: str,
    full: bool = typer.Option(
        False,
        "--full",
        help="Run VACUUM FULL ANALYZE instead of VACUUM ANALYZE.",
    ),
    table: list[str] = typer.Option(  # noqa: B008
        [],
        "--table",
        help="Vacuum only specific tables (repeatable). Defaults to all maintenance tables.",
    ),
) -> None:
    """Run one-shot storage maintenance on the large Silver and Gold tables."""

    settings = get_settings()
    try:
        result = vacuum_storage(
            provider_id, full=full, tables=table or None, settings=settings
        )
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("prune-bronze-storage")
def prune_bronze_storage_command(
    provider_id: str,
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be deleted without executing any deletions or R2 object removals.",
    ),
) -> None:
    """Prune old Bronze R2 objects and raw metadata after downstream Silver data is gone."""

    settings = get_settings()
    try:
        result = prune_bronze_storage(provider_id, settings=settings, dry_run=dry_run)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("run-static-pipeline")
def run_static_pipeline_command(provider_id: str) -> None:
    """Run ingest-static, load-static-silver, and refresh-gold-static for one provider."""

    settings = get_settings()
    try:
        result = run_static_pipeline(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("run-realtime-cycle")
def run_realtime_cycle_command(provider_id: str) -> None:
    """Run both realtime captures, both Silver loads, refresh Gold, and prune Silver."""

    settings = get_settings()
    try:
        result = run_realtime_cycle(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    typer.echo(json.dumps(result.display_dict(), indent=2))
    if result.has_failures:
        raise typer.Exit(code=1)


@app.command("publish-snapshot")
def publish_snapshot_command(
    provider_id: str,
    tier: str = typer.Option("live", "--tier", help="live  (static/historic land in later phases)"),  # noqa: B008
    dry_run: bool = typer.Option(False, "--dry-run", help="write to the local backend (requires SNAPSHOT_STORAGE_BACKEND=local + SNAPSHOT_LOCAL_ROOT)"),  # noqa: B008
) -> None:
    """Build and publish the /v1 snapshot for a provider to R2 (or local)."""
    settings = get_settings()
    if dry_run and settings.SNAPSHOT_STORAGE_BACKEND != "local":
        raise typer.BadParameter(
            "--dry-run requires SNAPSHOT_STORAGE_BACKEND=local and SNAPSHOT_LOCAL_ROOT to be set"
        )
    try:
        result = publish_snapshot(
            provider_id, tier=tier, settings=settings, registry=_provider_registry(settings)
        )
    except (KeyError, ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("run-realtime-worker")
def run_realtime_worker_command(
    provider_id: str,
    max_cycles: int | None = typer.Option(
        None,
        "--max-cycles",
        min=1,
        help="Stop after a fixed number of realtime cycles for bounded validation.",
    ),
) -> None:
    """Run the realtime cycle forever with configurable polling delays."""

    settings = get_settings()
    try:
        run_realtime_worker_loop(
            provider_id,
            settings=settings,
            registry=_provider_registry(settings),
            max_cycles=max_cycles,
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc


@app.command("build-warm-rollups")
def build_warm_rollups_command(
    provider_id: str,
    since: str | None = typer.Option(
        None,
        "--since",
        help=(
            "Only build periods with captured_at_utc >= this date (YYYY-MM-DD). "
            "Defaults to all missing periods."
        ),
    ),
) -> None:
    """Build 5-minute warm rollups for any Gold fact periods not yet summarized."""

    settings = get_settings()
    since_utc = None
    if since:
        from datetime import UTC, datetime

        try:
            since_utc = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError as exc:
            raise typer.BadParameter(f"--since must be YYYY-MM-DD, got: {since!r}") from exc

    result = build_warm_rollups(provider_id, settings=settings, since_utc=since_utc)
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("rebuild-source-factory")
def rebuild_source_factory_command(
    provider_id: str,
    execute: bool = typer.Option(
        False,
        "--execute",
        help="Actually reset and rebuild Oracle data. Defaults to dry-run proof only.",
    ),
    destructive_r2_cleanup: bool = typer.Option(
        False,
        "--destructive-r2-cleanup",
        help="Allow approved known Bronze cleanup as part of an execute rebuild.",
    ),
    active_prefix_wipe: bool = typer.Option(
        False,
        "--active-prefix-wipe",
        help="Plan or execute a separately confirmed active-prefix wipe.",
    ),
    confirm_worker_stopped: bool = typer.Option(
        False,
        "--confirm-worker-stopped",
        help="Confirm the realtime worker is stopped before executing the rebuild.",
    ),
    confirm_oracle_target: bool = typer.Option(
        False,
        "--confirm-oracle-target",
        help="Confirm DATABASE_URL points at the Oracle runtime database.",
    ),
    confirm_r2_cleanup: bool = typer.Option(
        False,
        "--confirm-r2-cleanup",
        help="Confirm approved known Bronze objects may be deleted.",
    ),
    confirm_active_prefix_wipe: bool = typer.Option(
        False,
        "--confirm-active-prefix-wipe",
        help="Confirm active Bronze prefixes may be wiped.",
    ),
    report_dir: Path = typer.Option(  # noqa: B008
        Path("artifacts/slice-8.6"),
        "--report-dir",
        help="Directory for source-factory proof artifacts.",
    ),
) -> None:
    """Rebuild STM Oracle from source truth and write source-factory proof artifacts."""

    settings = get_settings()
    try:
        _preflight_report_dir(report_dir)
        if execute and not destructive_r2_cleanup:
            raise typer.BadParameter(
                "--destructive-r2-cleanup is required with --execute."
            )
        result = run_source_factory_rebuild(
            provider_id,
            artifact_dir=report_dir,
            keep_from_date=_default_source_factory_keep_from_date(settings),
            execute=execute,
            destructive_r2_cleanup=destructive_r2_cleanup,
            active_prefix_wipe=active_prefix_wipe,
            confirm_worker_stopped=confirm_worker_stopped,
            confirm_oracle_target=confirm_oracle_target,
            confirm_r2_cleanup=confirm_r2_cleanup,
            confirm_active_prefix_wipe=confirm_active_prefix_wipe,
            settings=settings,
        )
        report = json.dumps(result.display_dict(), indent=2, sort_keys=True)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    typer.echo(report)


@app.command("prune-warm-rollup-storage")
def prune_warm_rollup_storage_command(
    provider_id: str,
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be deleted without executing any deletions.",
    ),
) -> None:
    """Prune warm rollup rows older than GOLD_WARM_ROLLUP_RETENTION_DAYS (default 365 days)."""

    settings = get_settings()
    result = prune_warm_rollup_storage(provider_id, settings=settings, dry_run=dry_run)
    typer.echo(json.dumps(result.display_dict(), indent=2))


if __name__ == "__main__":
    app()
