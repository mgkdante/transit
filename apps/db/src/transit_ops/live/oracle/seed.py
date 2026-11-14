"""Seed the old live path with the recorded provider and schedule edition."""

from dataclasses import asdict

from sqlalchemy import Connection, text

from transit_ops.gold.marts import refresh_gold_static
from transit_ops.gold.realtime import initialize_realtime_serving
from transit_ops.ingestion.storage import BronzeStorageResolver
from transit_ops.live.oracle.database import OracleDatabase, OracleDatabaseRefused
from transit_ops.live.oracle.window import ReplayWindow
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.silver.static_gtfs import BronzeStaticArchive, load_static_zip_to_silver


class SeedRefused(RuntimeError):
    pass


def seed_static(
    oracle: OracleDatabase,
    window: ReplayWindow,
    *,
    settings: Settings,
    registry: ProviderRegistry,
    bronze: BronzeStorageResolver,
) -> None:
    """The caller pins the database clock to the window's serving initialization time."""
    from transit_ops.cli import _seed_provider

    if type(oracle) is not OracleDatabase:
        raise SeedRefused("active owned oracle required")
    try:
        engine = oracle.engine
    except OracleDatabaseRefused as exc:
        raise SeedRefused(str(exc)) from exc
    manifest = registry.get_provider(window.provider_id)
    strict = manifest.provider.strict_gtfs
    endpoints = {seed.endpoint_key: seed for seed in manifest.to_feed_endpoint_seeds(settings)}
    for key in window.feed_endpoints:
        if key not in endpoints:
            raise SeedRefused(f"endpoint {key} is not declared by the provider manifest")
    static = manifest.static_feed().endpoint_key
    if window.feed_endpoints.get(static) != window.edition.feed_endpoint_id:
        raise SeedRefused(f"edition feed_endpoint_id does not match endpoint {static}")
    with engine.begin() as connection:
        _seed_provider(connection, manifest)
        for key, endpoint_id in window.feed_endpoints.items():
            params = endpoints[key].as_params() | {"feed_endpoint_id": endpoint_id}
            columns = ", ".join(params)
            values = ", ".join(f":{column}" for column in params)
            connection.execute(
                text(f"INSERT INTO core.feed_endpoints ({columns}) VALUES ({values})"), params
            )
        _seed_edition(connection, window)
        archive = _archive(window, bronze)
        load_static_zip_to_silver(
            connection,
            archive=archive,
            bronze_storage=bronze(window.edition.storage_backend),
            strict_gtfs=strict if strict is not None else settings.STRICT_GTFS,
        )
    refresh_gold_static(window.provider_id, settings=settings, registry=registry, engine=engine)
    realtime = sorted(window.feed_endpoints.keys() & {"trip_updates", "vehicle_positions"})
    initialize_realtime_serving(window.provider_id, realtime, engine=engine, settings=settings)
    with engine.begin() as connection:
        _advance_sequences(connection)


def _seed_edition(connection: Connection, window: ReplayWindow) -> None:
    params = asdict(window.edition) | {"provider_id": window.provider_id}
    connection.execute(
        text("""
        INSERT INTO raw.ingestion_runs
            (ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status,
             requested_at_utc, started_at_utc, completed_at_utc)
        VALUES (:ingestion_run_id, :provider_id, :feed_endpoint_id, 'static_schedule',
                'succeeded', :requested_at_utc, :started_at_utc, :completed_at_utc)
    """),
        params,
    )
    connection.execute(
        text("""
        INSERT INTO raw.ingestion_objects
            (ingestion_object_id, ingestion_run_id, provider_id, object_kind,
             storage_backend, storage_path, source_url, checksum_sha256, byte_size, created_at_utc)
        VALUES (:ingestion_object_id, :ingestion_run_id, :provider_id, 'gtfs_schedule_zip',
                :storage_backend, :storage_path, :source_url, :checksum_sha256, :byte_size,
                :object_created_at_utc)
    """),
        params,
    )


def _archive(window: ReplayWindow, bronze: BronzeStorageResolver) -> BronzeStaticArchive:
    edition = window.edition
    return BronzeStaticArchive(
        provider_id=window.provider_id,
        storage_backend=edition.storage_backend,
        feed_endpoint_id=edition.feed_endpoint_id,
        source_ingestion_run_id=edition.ingestion_run_id,
        source_ingestion_object_id=edition.ingestion_object_id,
        storage_path=edition.storage_path,
        archive_full_path=bronze(edition.storage_backend).describe_location(edition.storage_path),
        source_url=edition.source_url,
        checksum_sha256=edition.checksum_sha256,
        byte_size=edition.byte_size,
        source_completed_at_utc=edition.completed_at_utc,
    )


def _advance_sequences(connection: Connection) -> None:
    for table, column in (
        ("core.feed_endpoints", "feed_endpoint_id"),
        ("raw.ingestion_runs", "ingestion_run_id"),
        ("raw.ingestion_objects", "ingestion_object_id"),
    ):
        connection.execute(
            text(f"""
            SELECT setval(pg_get_serial_sequence(:table, :column),
                          GREATEST((SELECT max({column}) FROM {table}),
                                   nextval(pg_get_serial_sequence(:table, :column))))
        """),
            {"table": table, "column": column},
        )
