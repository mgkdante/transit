from __future__ import annotations

import json
from pathlib import Path

import typer
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from transit_ops.core.models import FeedKind, ProviderManifest
from transit_ops.db.connection import make_engine, test_connection
from transit_ops.gold import build_gold_marts, refresh_gold_realtime
from transit_ops.ingestion import capture_realtime_feed, ingest_static_feed
from transit_ops.logging import configure_logging
from transit_ops.maintenance import prune_gold_storage, prune_silver_storage, vacuum_storage
from transit_ops.orchestration import (
    run_realtime_cycle,
    run_realtime_worker_loop,
    run_static_pipeline,
)
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings
from transit_ops.silver import (
    load_latest_realtime_to_silver,
    load_latest_static_to_silver,
)

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
        raise typer.BadParameter("NEON_DATABASE_URL is required for init-db.")

    config = Config(str(_project_root() / "alembic.ini"))
    script_location = _project_root() / "src/transit_ops/db/migrations"
    config.set_main_option("script_location", str(script_location))
    config.set_main_option("sqlalchemy.url", settings.sqlalchemy_database_url)
    return config


def _provider_registry(settings: Settings) -> ProviderRegistry:
    return ProviderRegistry.from_project_root(project_root=_project_root(), settings=settings)


def _seed_provider(connection, manifest: ProviderManifest) -> None:
    provider = manifest.to_provider_seed()
    connection.execute(
        text(
            """
            INSERT INTO core.providers (
                provider_id,
                display_name,
                timezone,
                attribution_text,
                website_url,
                is_active
            )
            VALUES (
                :provider_id,
                :display_name,
                :timezone,
                :attribution_text,
                :website_url,
                :is_active
            )
            ON CONFLICT (provider_id) DO UPDATE SET
                display_name = EXCLUDED.display_name,
                timezone = EXCLUDED.timezone,
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
    """Run a simple connectivity test against Neon Postgres."""

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


@app.command("prune-silver-storage")
def prune_silver_storage_command(provider_id: str) -> None:
    """Prune old static and realtime Silver rows according to retention settings."""

    settings = get_settings()
    try:
        result = prune_silver_storage(provider_id, settings=settings)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("prune-gold-storage")
def prune_gold_storage_command(provider_id: str) -> None:
    """Prune old Gold fact rows according to GOLD_FACT_RETENTION_DAYS."""

    settings = get_settings()
    try:
        result = prune_gold_storage(provider_id, settings=settings)
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
) -> None:
    """Run one-shot storage maintenance on the large Silver and Gold tables."""

    settings = get_settings()
    try:
        result = vacuum_storage(provider_id, full=full, settings=settings)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("run-static-pipeline")
def run_static_pipeline_command(provider_id: str) -> None:
    """Run ingest-static, load-static-silver, and build-gold-marts for one provider."""

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


if __name__ == "__main__":
    app()
