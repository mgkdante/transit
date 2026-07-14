from __future__ import annotations

import json
import logging
import os
import time
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from tempfile import NamedTemporaryFile

import typer
from alembic import command
from alembic.config import Config
from sqlalchemy import text

from transit_ops.backups import (
    BackupError,
    download_latest_backup,
    list_database_backups,
    run_database_backup,
)
from transit_ops.core.models import FeedKind, ProviderManifest
from transit_ops.db.connection import make_engine, test_connection
from transit_ops.gold import (
    alert_archive_default_bounds,
    backfill_alert_archive,
    backfill_dim_name_history,
    build_gold_marts,
    build_warm_rollups,
    provider_is_seeded,
    rebuild_warm_rollups,
    refresh_gold_realtime,
    refresh_gold_static,
    sync_alert_archive,
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
    prune_i3_storage,
    prune_silver_storage,
    prune_warm_rollup_storage,
    vacuum_storage,
)
from transit_ops.orchestration import (
    run_pruner_loop,
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
    replay_realtime_silver_window,
)
from transit_ops.snapshots.gate import GateError
from transit_ops.snapshots.historic_gc import run_historic_snapshot_gc
from transit_ops.snapshots.publish import publish_snapshot, validate_snapshots
from transit_ops.source_factory.runner import run_source_factory_rebuild
from transit_ops.validation.historic_publish import (
    HistoricPublishProofReport,
    build_historic_publish_proof,
)
from transit_ops.validation.proof import build_retention_proof_report
from transit_ops.validation.static_feeds import validate_static_feeds

logger = logging.getLogger(__name__)

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


def _skip_if_unseeded(settings: Settings, provider_id: str, *, step: str) -> bool:
    """Return True (and emit a skip marker) when the provider has no gold data.

    An enrolled-but-unseeded provider (no gold.dim_provider row — its static
    pipeline has never run) has nothing for the per-provider warm-rollup /
    prune / retention steps to act on. The Daily Warm Rollups workflow loops
    these over EVERY registered provider under ``set -e``, so each must skip
    cleanly (logged no-op, exit 0) rather than crash the all-providers run.

    The prune/retention bodies already filter on ``provider_id`` and no-op on
    empty result sets, so this guard is a cheap, explicit short-circuit that
    also avoids spending an R2 / DB round-trip on a provider with zero data.
    """
    with make_engine(settings).connect() as conn:
        if provider_is_seeded(conn, provider_id):
            return False
    logger.info(
        "provider %r not seeded (no gold.dim_provider row) — skipping %s",
        provider_id,
        step,
    )
    typer.echo(
        json.dumps(
            {"provider_id": provider_id, "skipped_not_seeded": True, "step": step},
            indent=2,
        )
    )
    return True


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


def _write_report_atomic(report_path: Path, body: str) -> None:
    temporary_path: Path | None = None
    try:
        with NamedTemporaryFile(
            mode="w",
            encoding="utf-8",
            dir=report_path.parent,
            prefix=f".{report_path.name}.",
            suffix=".tmp",
            delete=False,
        ) as handle:
            temporary_path = Path(handle.name)
            handle.write(body)
            handle.flush()
            os.fsync(handle.fileno())
        temporary_path.replace(report_path)
    finally:
        if temporary_path is not None:
            temporary_path.unlink(missing_ok=True)


def _read_json_object(path: Path, *, option_name: str) -> dict[str, object]:
    if not path.exists():
        raise typer.BadParameter(f"{option_name} does not exist: {path}")
    if path.is_dir():
        raise typer.BadParameter(f"{option_name} must be a file path, got directory: {path}")

    try:
        raw = path.read_text(encoding="utf-8")
    except (OSError, UnicodeError) as exc:
        raise typer.BadParameter(f"{option_name} is not readable: {path}") from exc

    def reject_nonstandard_constant(_value: str) -> None:
        raise ValueError

    try:
        payload = json.loads(raw, parse_constant=reject_nonstandard_constant)
    except ValueError as exc:
        raise typer.BadParameter(f"{option_name} must contain valid JSON: {path}") from exc
    if not isinstance(payload, dict):
        raise typer.BadParameter(f"{option_name} must contain a JSON object: {path}")
    return payload


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


def _parse_alert_archive_date(value: str, *, option_name: str) -> date:
    try:
        return datetime.strptime(value, "%Y-%m-%d").date()
    except ValueError as exc:
        raise typer.BadParameter(f"{option_name} must be YYYY-MM-DD, got: {value!r}") from exc


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
                short_name,
                city,
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
                :short_name,
                :city,
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
                short_name = EXCLUDED.short_name,
                city = EXCLUDED.city,
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
def seed_core(
    provider: str | None = typer.Option(  # noqa: B008
        None,
        "--provider",
        help="Seed only this provider id; default seeds every configured manifest.",
    ),
) -> None:
    """Seed provider metadata and feed endpoints from the provider manifests."""

    settings = get_settings()
    registry = _provider_registry(settings)
    provider_ids = [provider] if provider else registry.list_provider_ids()
    engine = make_engine(settings)
    with engine.begin() as connection:
        for provider_id in provider_ids:
            manifest = registry.get_provider(provider_id)
            _seed_provider(connection, manifest)
            _seed_feed_endpoints(connection, manifest, settings)
        provider_count = connection.execute(
            text("SELECT count(*) FROM core.providers")
        ).scalar_one()
        endpoint_count = connection.execute(
            text("SELECT count(*) FROM core.feed_endpoints")
        ).scalar_one()
    typer.echo(
        f"Seeded core metadata for {len(provider_ids)} provider(s). "
        f"Providers={provider_count}, Feed endpoints={endpoint_count}."
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

    if _skip_if_unseeded(settings, provider_id, step="retention-proof-report"):
        return

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


@app.command("gc-historic-snapshots")
def gc_historic_snapshots_command(
    provider_id: str,
    mode: str = typer.Option(
        "dry-run",
        "--mode",
        help="Non-destructive mode: dry-run inventories only; mark persists reachability marks.",
    ),
    report_path: Path | None = typer.Option(  # noqa: B008
        None,
        "--report-path",
        help="Write the JSON scan receipt to this path as well as stdout.",
    ),
) -> None:
    """Validate historic generation reachability and optionally persist marks."""

    if mode not in {"dry-run", "mark"}:
        raise typer.BadParameter(
            "--mode must be dry-run or mark; apply is disabled pending the R2 delete canary"
        )
    settings = get_settings()
    registry = _provider_registry(settings)
    try:
        registry.get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    _preflight_report_path(report_path)
    if _skip_if_unseeded(settings, provider_id, step="gc-historic-snapshots"):
        payload = {
            "status": "skip",
            "provider_id": provider_id,
            "mode": mode,
            "skipped_not_seeded": True,
        }
        report = json.dumps(payload, indent=2, sort_keys=True)
        if report_path is not None:
            report_path.write_text(report + "\n", encoding="utf-8")
        typer.echo(report)
        return
    try:
        result = run_historic_snapshot_gc(
            provider_id,
            settings=settings,
            registry=registry,
            mode=mode,  # type: ignore[arg-type]
        )
        payload = result.display_dict()
    except Exception as exc:
        payload = {
            "status": "fail",
            "provider_id": provider_id,
            "mode": mode,
            "failure_type": type(exc).__name__,
            "failure": str(exc),
        }
        report = json.dumps(payload, indent=2, sort_keys=True)
        if report_path is not None:
            report_path.write_text(report + "\n", encoding="utf-8")
        typer.echo(report)
        raise typer.Exit(code=1) from exc
    report = json.dumps(payload, indent=2, sort_keys=True)
    if report_path is not None:
        report_path.write_text(report + "\n", encoding="utf-8")
    typer.echo(report)


@app.command("verify-historic-publish")
def verify_historic_publish_command(
    provider_id: str,
    sync_report: Path = typer.Option(..., "--sync-report"),  # noqa: B008
    gate_report: Path = typer.Option(..., "--gate-report"),  # noqa: B008
    report_path: Path = typer.Option(..., "--report-path"),  # noqa: B008
) -> None:
    """Verify one migrated, synced, gated historic publication against public /v1."""
    settings = get_settings()
    try:
        _provider_registry(settings).get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    if _skip_if_unseeded(settings, provider_id, step="verify-historic-publish"):
        return
    _preflight_report_path(report_path)
    sync_payload = _read_json_object(sync_report, option_name="--sync-report")
    gate_payload = _read_json_object(gate_report, option_name="--gate-report")
    try:
        result = build_historic_publish_proof(
            provider_id,
            sync_receipt=sync_payload,
            gate_report=gate_payload,
            settings=settings,
            isolate_process=True,
        )
    except TimeoutError:
        result = HistoricPublishProofReport(
            provider_id=provider_id,
            verified_at_utc=datetime.now(UTC),
            status="fail",
            migration={"status": "unavailable"},
            sync={"status": "unavailable"},
            gate={"status": "unavailable"},
            public={
                "deadline": {
                    "exceeded": True,
                    "failure": "historic_proof_deadline_exceeded",
                    "receipt_source": "cli_exception_fallback",
                }
            },
            source_messages={"status": "unavailable"},
            failures=("historic_proof_deadline_exceeded",),
        )
    body = json.dumps(result.display_dict(), indent=2, sort_keys=True)
    _write_report_atomic(report_path, body + "\n")
    typer.echo(body)
    if result.status != "pass":
        raise typer.Exit(code=1)


@app.command("capture-realtime")
def capture_realtime(provider_id: str, endpoint_key: str) -> None:
    """Capture, archive, and register one GTFS-RT snapshot."""

    if endpoint_key not in {
        FeedKind.TRIP_UPDATES.value,
        FeedKind.VEHICLE_POSITIONS.value,
    }:
        raise typer.BadParameter("endpoint_key must be 'trip_updates' or 'vehicle_positions'.")

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
        raise typer.BadParameter("endpoint_key must be 'trip_updates' or 'vehicle_positions'.")

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


def _parse_replay_instant(value: str, *, flag: str) -> datetime:
    """Parse an ISO-8601 datetime for a replay window flag and normalize to UTC.

    Accepts both naive (assumed UTC) and timezone-aware ISO strings. A bare date
    (YYYY-MM-DD) is accepted and treated as midnight UTC.
    """

    try:
        parsed = datetime.fromisoformat(value)
    except ValueError as exc:
        raise typer.BadParameter(
            f"{flag} must be an ISO-8601 datetime (e.g. 2026-06-20T00:00:00Z), got: {value!r}"
        ) from exc
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=UTC)
    return parsed.astimezone(UTC)


@app.command("replay-realtime-silver")
def replay_realtime_silver_command(
    provider_id: str,
    since: str = typer.Option(
        ...,
        "--since",
        help=(
            "Window start (inclusive), ISO-8601 datetime. Snapshots with "
            "captured_at_utc >= this instant are replayed (e.g. 2026-06-20T00:00:00Z)."
        ),
    ),
    until: str | None = typer.Option(
        None,
        "--until",
        help=(
            "Window end (exclusive), ISO-8601 datetime. Defaults to now (UTC). "
            "Snapshots with captured_at_utc < this instant are replayed."
        ),
    ),
) -> None:
    """Rebuild realtime Silver + Gold from raw Bronze .pb over a captured window.

    The rebuild-from-raw replay (disaster-recovery / thin-silver gate): reads the
    archived realtime .pb objects in ``[--since, --until)`` and re-derives the
    realtime Silver tables (idempotent; already-loaded snapshots are skipped),
    then runs the full-history Gold rebuild so Gold facts re-derive from the
    reconstructed Silver. Additive and provider-agnostic: nothing auto-invokes
    it and no retention setting is read or changed.
    """

    start_utc = _parse_replay_instant(since, flag="--since")
    end_utc = (
        _parse_replay_instant(until, flag="--until") if until is not None else datetime.now(UTC)
    )
    if end_utc <= start_utc:
        raise typer.BadParameter(
            f"--until ({end_utc.isoformat()}) must be after --since ({start_utc.isoformat()})."
        )

    settings = get_settings()
    registry = _provider_registry(settings)
    started = time.perf_counter()
    try:
        silver_result = replay_realtime_silver_window(
            provider_id,
            start_utc=start_utc,
            end_utc=end_utc,
            settings=settings,
            registry=registry,
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    payload: dict[str, object] = {
        "provider_id": silver_result.provider_id,
        "window_start_utc": start_utc.isoformat(),
        "window_end_utc": end_utc.isoformat(),
        "snapshots_found": (
            silver_result.loaded_count + len(silver_result.skipped_existing_snapshot_ids)
        ),
        "silver": silver_result.display_dict(),
    }

    if silver_result.loaded_count == 0 and not silver_result.skipped_existing_snapshot_ids:
        # Honest no-op: no archived snapshots in the window. Clean exit, not an error.
        payload["gold"] = None
        payload["status"] = "no-snapshots-in-window"
        payload["elapsed_seconds"] = round(time.perf_counter() - started, 3)
        typer.echo(json.dumps(payload, indent=2))
        return

    try:
        gold_result = build_gold_marts(
            provider_id,
            settings=settings,
            registry=registry,
        )
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    payload["gold"] = gold_result.display_dict()
    payload["status"] = "rebuilt"
    payload["elapsed_seconds"] = round(time.perf_counter() - started, 3)
    typer.echo(json.dumps(payload, indent=2))


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


@app.command("backfill-dim-history")
def backfill_dim_history_command(
    provider_id: str,
    from_gtfs_zip: Path = typer.Option(  # noqa: B008
        ...,
        "--from-gtfs-zip",
        help=(
            "Archived GTFS zip (e.g. from bronze R2) whose routes.txt/stops.txt "
            "carry the names of ids retired before migration 0029 existed."
        ),
    ),
) -> None:
    """Heal gold.dim_*_history from an archived GTFS zip.

    Inserts CLOSED name rows ONLY for ids missing entirely from the history
    tables (e.g. route/stop ids retired by a GTFS edition drop that predates
    migration 0029). Existing history rows are never touched, so the command
    is idempotent and a current-edition zip is a no-op. When healing from
    several old editions, run the NEWEST zip first — the first zip providing
    a missing id wins.
    """

    settings = get_settings()
    try:
        result = backfill_dim_name_history(
            provider_id,
            gtfs_zip_path=from_gtfs_zip,
            settings=settings,
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


@app.command("sync-alert-archive")
def sync_alert_archive_command(
    provider_id: str,
    from_date: str | None = typer.Option(
        None,
        "--from",
        help="First provider-local capture date to sync (YYYY-MM-DD, inclusive).",
    ),
    to_date: str | None = typer.Option(
        None,
        "--to",
        help="Last provider-local capture date to sync (YYYY-MM-DD, inclusive).",
    ),
) -> None:
    """Sync a bounded retained window of Silver alerts into the Gold archive."""

    parsed_from = (
        _parse_alert_archive_date(from_date, option_name="--from")
        if from_date is not None
        else None
    )
    parsed_to = (
        _parse_alert_archive_date(to_date, option_name="--to") if to_date is not None else None
    )
    if parsed_from is not None and parsed_to is not None and parsed_from > parsed_to:
        raise typer.BadParameter("--from must be on or before --to")

    settings = get_settings()
    try:
        manifest = _provider_registry(settings).get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    if _skip_if_unseeded(settings, provider_id, step="sync-alert-archive"):
        return

    default_from, default_to = alert_archive_default_bounds(
        provider_timezone=manifest.provider.timezone,
        retention_days=settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
    )
    effective_from = parsed_from or default_from
    effective_to = parsed_to or default_to
    if effective_from > effective_to:
        raise typer.BadParameter("--from must be on or before --to")

    result = sync_alert_archive(
        provider_id,
        from_date=effective_from,
        to_date=effective_to,
        settings=settings,
    )
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("backfill-alert-archive")
def backfill_alert_archive_command(
    provider_id: str,
    from_date: str = typer.Option(  # noqa: B008
        ...,
        "--from",
        help="First provider-local capture date to backfill (YYYY-MM-DD, inclusive).",
    ),
    to_date: str = typer.Option(  # noqa: B008
        ...,
        "--to",
        help="Last provider-local capture date to backfill (YYYY-MM-DD, inclusive).",
    ),
    month_batch: int = typer.Option(
        1,
        "--month-batch",
        help="Number of complete provider-local calendar months per committed batch.",
    ),
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Classify every batch without upserting archive rows.",
    ),
) -> None:
    """Backfill the alert archive in resumable, oldest-first calendar batches."""

    parsed_from = _parse_alert_archive_date(from_date, option_name="--from")
    parsed_to = _parse_alert_archive_date(to_date, option_name="--to")
    if parsed_from > parsed_to:
        raise typer.BadParameter("--from must be on or before --to")
    if month_batch <= 0:
        raise typer.BadParameter("--month-batch must be positive")

    settings = get_settings()
    try:
        _provider_registry(settings).get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    if _skip_if_unseeded(settings, provider_id, step="backfill-alert-archive"):
        return

    result = backfill_alert_archive(
        provider_id,
        from_date=parsed_from,
        to_date=parsed_to,
        month_batch=month_batch,
        dry_run=dry_run,
        settings=settings,
    )
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("prune-i3-storage")
def prune_i3_storage_command(
    provider_id: str,
    dry_run: bool = typer.Option(
        False,
        "--dry-run",
        help="Print what would be deleted without executing any deletions or R2 removals.",
    ),
) -> None:
    """Prune closed i3 silver history and old raw i3 snapshots + their R2 JSON."""

    settings = get_settings()
    if _skip_if_unseeded(settings, provider_id, step="prune-i3-storage"):
        return
    try:
        result = prune_i3_storage(provider_id, settings=settings, dry_run=dry_run)
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))
    if not dry_run and any(result.failed_object_counts.values()):
        raise typer.Exit(code=1)


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
        result = vacuum_storage(provider_id, full=full, tables=table or None, settings=settings)
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
    max_objects: int | None = typer.Option(  # noqa: B008
        None,
        "--max-objects",
        min=1,
        help="Eligible objects per batch (defaults to BRONZE_PRUNE_MAX_OBJECTS_PER_BATCH).",
    ),
    max_batches: int | None = typer.Option(  # noqa: B008
        None,
        "--max-batches",
        min=1,
        help="Batches per phase this invocation (defaults to BRONZE_PRUNE_MAX_BATCHES).",
    ),
    require_exhausted: bool = typer.Option(
        False,
        "--require-exhausted",
        help="Exit 1 after the JSON receipt when a live run leaves eligible backlog.",
    ),
) -> None:
    """Prune old Bronze R2 objects and raw metadata after downstream Silver data is gone."""

    settings = get_settings()
    if _skip_if_unseeded(settings, provider_id, step="prune-bronze-storage"):
        return
    try:
        result = prune_bronze_storage(
            provider_id,
            settings=settings,
            dry_run=dry_run,
            max_objects=max_objects,
            max_batches=max_batches,
        )
    except (ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))
    if not dry_run and (
        any(result.failed_object_counts.values()) or (require_exhausted and not result.exhausted)
    ):
        raise typer.Exit(code=1)


@app.command("run-static-pipeline")
def run_static_pipeline_command(provider_id: str) -> None:
    """Run ingest-static, load-static-silver, refresh-gold-static, then the GIS
    chain (best-effort) for one provider."""

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
    # GIS is best-effort: surface a failure on stderr without failing the command,
    # so the downstream publish-snapshot --tier static step still runs (slice-9.1.1v).
    if getattr(result, "gis_error_message", None):
        typer.echo(
            f"WARNING: GIS step failed (static pipeline succeeded): {result.gis_error_message}",
            err=True,
        )


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
    tier: str = typer.Option("live", "--tier", help="live | static | historic"),  # noqa: B008
    dry_run: bool = typer.Option(  # noqa: B008
        False,
        "--dry-run",
        help=(
            "write to the local backend "
            "(requires SNAPSHOT_STORAGE_BACKEND=local + SNAPSHOT_LOCAL_ROOT)"
        ),
    ),
    gate: bool = typer.Option(  # noqa: B008
        True,
        "--gate/--no-gate",
        help="run the value gate over the built payloads before upload (historic aborts on ERROR)",
    ),
    force: bool = typer.Option(  # noqa: B008
        False,
        "--force",
        help="publish even when the gate finds ERROR-severity issues (logged override)",
    ),
) -> None:
    """Build and publish the /v1 snapshot for a provider to R2 (or local)."""
    settings = get_settings()
    if dry_run and settings.SNAPSHOT_STORAGE_BACKEND != "local":
        raise typer.BadParameter(
            "--dry-run requires SNAPSHOT_STORAGE_BACKEND=local and SNAPSHOT_LOCAL_ROOT to be set"
        )
    try:
        result = publish_snapshot(
            provider_id,
            tier=tier,
            settings=settings,
            registry=_provider_registry(settings),
            gate_enabled=gate,
            force=force,
        )
    except GateError as exc:
        typer.echo(json.dumps(exc.report.to_dict(), indent=2), err=True)
        raise typer.Exit(code=1) from exc
    except (KeyError, ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("publish-all")
def publish_all_command(
    tier: str = typer.Option("live", "--tier", help="live | static | historic"),  # noqa: B008
    gate: bool = typer.Option(  # noqa: B008
        True,
        "--gate/--no-gate",
        help="run the value gate over the built payloads before upload (historic aborts on ERROR)",
    ),
    force: bool = typer.Option(  # noqa: B008
        False,
        "--force",
        help="publish even when the gate finds ERROR-severity issues (logged override)",
    ),
    report_dir: Path | None = typer.Option(  # noqa: B008
        None,
        "--report-dir",
        help="write each provider's gate report JSON to {report_dir}/publish-gate-{provider}.json",
    ),
) -> None:
    """Build and publish the /v1 snapshot for EVERY configured provider.

    Attempts every provider so one provider's failure does not skip the others;
    exits non-zero if any failed. A gate ERROR raises PER-PROVIDER (the others still
    publish) and makes the process exit non-zero so the workflow goes red.
    """
    settings = get_settings()
    registry = _provider_registry(settings)
    engine = make_engine(settings)
    if report_dir is not None:
        _preflight_report_dir(report_dir)
    results: list[dict[str, object]] = []
    failures: list[str] = []
    skipped: list[str] = []
    for provider_id in registry.list_provider_ids():
        # Enrolled-but-unseeded providers have no gold.dim_provider row and thus
        # no gold data to build/publish; skip cleanly so the all-providers run
        # never fails on a provider whose static pipeline has not run yet.
        if not provider_is_seeded(engine, provider_id):
            logger.info(
                "provider %r not seeded (no gold.dim_provider row) — skipping publish-all",
                provider_id,
            )
            skipped.append(provider_id)
            continue
        try:
            result = publish_snapshot(
                provider_id,
                tier=tier,
                settings=settings,
                registry=registry,
                gate_enabled=gate,
                force=force,
            )
            results.append(result.display_dict())
            # Write the gate report on SUCCESS too (not only on GateError) so CI /
            # status can always consume {report_dir}/publish-gate-{provider}.json.
            if report_dir is not None and result.gate_report is not None:
                (report_dir / f"publish-gate-{provider_id}.json").write_text(
                    json.dumps(result.gate_report, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
        except GateError as exc:
            if report_dir is not None:
                (report_dir / f"publish-gate-{provider_id}.json").write_text(
                    json.dumps(exc.report.to_dict(), indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                )
            failures.append(f"{provider_id}: {exc}")
        except (KeyError, ValueError, FileNotFoundError) as exc:
            failures.append(f"{provider_id}: {exc}")
    if skipped:
        typer.echo(f"publish-all skipped unseeded providers: {', '.join(skipped)}", err=True)
    typer.echo(json.dumps(results, indent=2))
    if failures:
        for failure in failures:
            typer.echo(f"publish-all failure — {failure}", err=True)
        raise typer.Exit(code=1)


@app.command("validate-snapshots")
def validate_snapshots_command(
    provider_id: str,
    tier: str = typer.Option("historic", "--tier", help="live | static | historic"),  # noqa: B008
    report_path: Path | None = typer.Option(  # noqa: B008
        None,
        "--report-path",
        help="write the JSON gate report to this path as well as stdout.",
    ),
    strict: bool = typer.Option(  # noqa: B008
        False,
        "--strict",
        help="exit 1 on WARN findings too (default: exit 1 only on ERROR findings).",
    ),
) -> None:
    """Read-only pre-publish audit: build every payload, run the value gate, report.

    Exercises the real build over the real DB but uploads NOTHING. Exits 1 when the
    gate has ERROR findings (or any WARN under --strict); otherwise exits 0.
    """
    settings = get_settings()
    registry = _provider_registry(settings)
    try:
        registry.get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc

    _preflight_report_path(report_path)
    try:
        report = validate_snapshots(provider_id, tier=tier, settings=settings)
    except (KeyError, ValueError, FileNotFoundError) as exc:
        raise typer.BadParameter(str(exc)) from exc

    body = json.dumps(report.to_dict(), indent=2, sort_keys=True)
    if report_path is not None:
        report_path.write_text(body + "\n", encoding="utf-8")
    typer.echo(body)
    if report.errors or (strict and report.warnings):
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


@app.command("run-pruner-loop")
def run_pruner_loop_command(
    provider_id: str,
    max_cycles: int | None = typer.Option(
        None,
        "--max-cycles",
        min=1,
        help="Stop after a fixed number of prune passes for bounded validation.",
    ),
) -> None:
    """Run the dedicated retention pruner loop (silver + gold) forever.

    Decoupled from the realtime worker (PR-B / slice-9.8): this is the always-on
    `pruner` compose service's entrypoint. It never skips a prune on a gold or
    endpoint failure (it has no capture/gold step that could throw first), so it
    drains the silver/gold backlog independent of the realtime cycle.
    """

    settings = get_settings()
    try:
        run_pruner_loop(
            provider_id,
            settings=settings,
            max_cycles=max_cycles,
        )
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
        try:
            since_utc = datetime.strptime(since, "%Y-%m-%d").replace(tzinfo=UTC)
        except ValueError as exc:
            raise typer.BadParameter(f"--since must be YYYY-MM-DD, got: {since!r}") from exc

    result = build_warm_rollups(provider_id, settings=settings, since_utc=since_utc)
    typer.echo(json.dumps(result.display_dict(), indent=2))


def _rebuild_prompt(plan) -> str:  # noqa: ANN001
    """Destructive-rebuild confirmation showing total rows + watermarks per kind."""
    kinds = sorted(set(plan.deleted_row_counts) | set(plan.deleted_watermark_counts))
    lines = [
        f"Rebuild {plan.provider_id} append-only daily rollups for rows "
        f"{plan.from_date.isoformat()}..{plan.to_date.isoformat()} — this DELETEs the "
        "affected rollup rows + watermarks and recomputes them.",
    ]
    if kinds:
        lines.append("Affected per kind (rows / watermarks):")
        for kind in kinds:
            rows = plan.deleted_row_counts.get(kind, 0)
            watermarks = plan.deleted_watermark_counts.get(kind, 0)
            lines.append(f"  {kind}: {rows} rows / {watermarks} watermarks")
    lines.append("Continue?")
    return "\n".join(lines)


@app.command("rebuild-warm-rollups")
def rebuild_warm_rollups_command(
    provider_id: str,
    from_date: str = typer.Option(  # noqa: B008
        ...,
        "--from",
        help="First ROW date to rebuild (YYYY-MM-DD, inclusive) — the local date "
        "visible as wrong in the gold tables. For route_service_span_daily the "
        "internal run/watermark date is this row date + 1.",
    ),
    to_date: str = typer.Option(  # noqa: B008
        ...,
        "--to",
        help="Last ROW date to rebuild (YYYY-MM-DD, inclusive).",
    ),
    kinds: str | None = typer.Option(  # noqa: B008
        None,
        "--kinds",
        help="Comma-separated append-only daily kinds to rebuild; default = all. "
        "Reporting marts and the 5m rollup are rejected — refresh those with "
        "build-warm-rollups.",
    ),
    dry_run: bool = typer.Option(  # noqa: B008
        False,
        "--dry-run",
        help="Print the affected row/watermark counts per kind without deleting or rebuilding.",
    ),
    yes: bool = typer.Option(  # noqa: B008
        False,
        "--yes",
        help="Skip the destructive-delete confirmation prompt AND its preview COUNT "
        "pass (fast path). Without --yes the prompt shows total rows + watermarks "
        "per kind before deleting.",
    ),
) -> None:
    """Rebuild present-but-wrong closed days in the append-only daily rollups.

    --from/--to are ROW dates (the dates visible as wrong in serving), inclusive.
    Deletes the affected rollup rows + their watermarks for the requested kinds,
    then re-runs the builder over exactly that window. The DELETE+UPSERT reporting
    marts are NOT rebuilt here — run build-warm-rollups afterward to refresh them.
    """

    settings = get_settings()
    try:
        _provider_registry(settings).get_provider(provider_id)
    except KeyError as exc:
        raise typer.BadParameter(str(exc)) from exc
    if _skip_if_unseeded(settings, provider_id, step="rebuild-warm-rollups"):
        return
    try:
        d_from = datetime.strptime(from_date, "%Y-%m-%d").date()
        d_to = datetime.strptime(to_date, "%Y-%m-%d").date()
    except ValueError as exc:
        raise typer.BadParameter("--from/--to must be YYYY-MM-DD") from exc

    kind_list = [k.strip() for k in kinds.split(",")] if kinds else None
    try:
        result = rebuild_warm_rollups(
            provider_id,
            settings=settings,
            from_date=d_from,
            to_date=d_to,
            kinds=kind_list,
            dry_run=dry_run,
            # --yes = fast path: confirm=None skips both the preview COUNT pass and
            # the prompt. Otherwise the prompt renders the plan's per-kind counts.
            confirm=None if yes else (lambda plan: typer.confirm(_rebuild_prompt(plan))),
        )
    except ValueError as exc:
        raise typer.BadParameter(str(exc)) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))
    if not dry_run and not result.aborted:
        # Advisory: the DELETE+UPSERT reporting marts (route_delay_hourly,
        # habit/repeat/headway, ...) derive from these spines but are refreshed
        # only by a full build-warm-rollups run.
        typer.echo(
            f"Advisory: run `run-static-pipeline`/`build-warm-rollups {provider_id}` "
            "to refresh the derived DELETE+UPSERT reporting marts.",
            err=True,
        )


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
            raise typer.BadParameter("--destructive-r2-cleanup is required with --execute.")
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
    """Prune warm rollup rows older than GOLD_WARM_ROLLUP_RETENTION_DAYS (default 730 days)."""

    settings = get_settings()
    if _skip_if_unseeded(settings, provider_id, step="prune-warm-rollup-storage"):
        return
    result = prune_warm_rollup_storage(provider_id, settings=settings, dry_run=dry_run)
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("backup-database")
def backup_database_command() -> None:
    """Stream a pg_dump of the configured database to Bronze R2 and prune old dumps."""

    settings = get_settings()
    try:
        result = run_database_backup(settings)
    except (BackupError, ValueError) as exc:
        typer.echo(f"Backup failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json.dumps(result.display_dict(), indent=2))


@app.command("list-backups")
def list_backups_command() -> None:
    """List database backup objects in Bronze R2, newest first."""

    settings = get_settings()
    try:
        backups = list_database_backups(settings)
    except (BackupError, ValueError) as exc:
        typer.echo(f"Listing backups failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json.dumps(backups, indent=2))


@app.command("download-latest-backup")
def download_latest_backup_command(
    dest: Path = typer.Option(  # noqa: B008
        ...,
        "--dest",
        help="Destination file path for the newest backup dump.",
    ),
) -> None:
    """Download the newest database backup from Bronze R2 to --dest."""

    settings = get_settings()
    try:
        result = download_latest_backup(settings, dest)
    except (BackupError, ValueError) as exc:
        typer.echo(f"Download failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc
    typer.echo(json.dumps(result, indent=2))


@app.command("verify-backup-freshness")
def verify_backup_freshness_command(
    max_age_hours: float = typer.Option(
        26.0,
        "--max-age-hours",
        help="Fail if the newest backup is older than this many hours (default 26; "
        "the backup cron runs daily at 09:30, so 26h tolerates a late run).",
    ),
) -> None:
    """Verify a fresh database backup artifact exists in Bronze R2 (READ-ONLY).

    With silver now ephemeral (raw R2 is the rebuild source), a silently-missing
    backup is a DR hole the GHA graph never catches today (the pg_dump runs as a
    VM cron, not a workflow). This external check on the backup ARTIFACT also
    covers the R2-disabled outage class. Exits 1 if no backup exists or the newest
    one is stale.
    """

    settings = get_settings()
    try:
        backups = list_database_backups(settings)
    except (BackupError, ValueError) as exc:
        typer.echo(f"Backup freshness check failed: {exc}", err=True)
        raise typer.Exit(code=1) from exc

    if not backups:
        typer.echo("Backup freshness check FAILED: no backup objects found in R2", err=True)
        raise typer.Exit(code=1)

    # Entries are sorted newest-first by timestamped key; last_modified is an ISO
    # string. Parse it and compare to a UTC now, normalizing naive -> aware so the
    # subtraction never raises on a missing tzinfo.
    newest = backups[0]
    last_modified_raw = newest.get("last_modified")
    if not isinstance(last_modified_raw, str):
        typer.echo(
            f"Backup freshness check FAILED: newest backup '{newest.get('key')}' "
            "has no parseable last_modified",
            err=True,
        )
        raise typer.Exit(code=1)
    try:
        last_modified = datetime.fromisoformat(last_modified_raw)
    except ValueError as exc:
        typer.echo(
            f"Backup freshness check FAILED: unparseable last_modified '{last_modified_raw}'",
            err=True,
        )
        raise typer.Exit(code=1) from exc
    if last_modified.tzinfo is None:
        last_modified = last_modified.replace(tzinfo=UTC)

    age = datetime.now(UTC) - last_modified
    age_hours = age.total_seconds() / 3600.0
    if age_hours > max_age_hours:
        typer.echo(
            f"Backup freshness check FAILED: newest backup '{newest.get('key')}' is "
            f"{age_hours:.1f}h old > {max_age_hours:.1f}h threshold",
            err=True,
        )
        raise typer.Exit(code=1)

    typer.echo(
        f"Backup freshness OK: newest backup '{newest.get('key')}' is "
        f"{age_hours:.1f}h old (<= {max_age_hours:.1f}h)"
    )


@app.command("db-storage-report")
def db_storage_report_command(
    limit: int = typer.Option(
        15,
        "--limit",
        help="Number of largest tables to report per schema.",
    ),
) -> None:
    """Report pg_total_relation_size for the largest silver.* / gold.* tables (READ-ONLY).

    Pure SELECT against pg_catalog — no writes, no DDL. Lets the operator measure
    storage before/after the thin-silver live prune. Sizes are pg_size_pretty'd.
    """

    settings = get_settings()
    engine = make_engine(settings)
    report: dict[str, object] = {}
    table_sql = text(
        """
        SELECT n.nspname AS schema,
               c.relname AS table,
               pg_size_pretty(pg_total_relation_size(c.oid)) AS total_size,
               pg_total_relation_size(c.oid) AS total_bytes
        FROM pg_class AS c
        JOIN pg_namespace AS n ON n.oid = c.relnamespace
        WHERE c.relkind = 'r'
          AND n.nspname = :schema
        ORDER BY pg_total_relation_size(c.oid) DESC
        LIMIT :limit
        """
    )
    with engine.connect() as conn:
        for schema in ("silver", "gold"):
            rows = conn.execute(table_sql, {"schema": schema, "limit": limit}).mappings()
            report[schema] = [
                {
                    "table": f"{r['schema']}.{r['table']}",
                    "total_size": r["total_size"],
                    "total_bytes": int(r["total_bytes"]),
                }
                for r in rows
            ]
        grand = conn.execute(
            text("SELECT pg_size_pretty(pg_database_size(current_database())) AS pretty")
        ).scalar_one()
    report["database_total"] = grand
    typer.echo(json.dumps(report, indent=2))


if __name__ == "__main__":
    app()
