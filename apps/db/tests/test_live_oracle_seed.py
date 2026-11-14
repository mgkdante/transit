import hashlib
import os
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from types import SimpleNamespace

import pytest
import yaml
from sqlalchemy import create_engine, text
from test_static_silver import _write_minimal_compliant_gtfs_zip

from transit_ops.cli import _seed_feed_endpoints, _seed_provider
from transit_ops.ingestion.storage import LocalBronzeStorage
from transit_ops.live.oracle.database import PinnedClock, oracle_database
from transit_ops.live.oracle.seed import SeedRefused, seed_static
from transit_ops.live.oracle.window import EditionInput, ReplayWindow
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings


def registry(config, settings):
    feeds = {}
    for key, source in (
        ("static_schedule", "gtfs_schedule_zip"),
        ("trip_updates", "gtfs_rt_trip_updates"),
        ("vehicle_positions", "gtfs_rt_vehicle_positions"),
    ):
        feeds[key] = dict(
            endpoint_key=key,
            feed_kind=key,
            source_format=source,
            source_url=f"https://fixture.test/{key}",
            auth={"auth_type": "none"},
            refresh_interval_seconds=60,
        )
    config.mkdir()
    manifest = dict(
        provider=dict(
            provider_id="oracle_seed", display_name="Oracle seed", timezone="America/Toronto"
        ),
        feeds=feeds,
        realtime={"lines_without_live_data": [{"gap_id": "gap", "route_ids": ["1"]}]},
    )
    (config / "test.yaml").write_text(yaml.safe_dump(manifest), encoding="utf-8")
    return ProviderRegistry(config, settings)


@pytest.fixture
def case(tmp_path):
    path = tmp_path / "schedule.zip"
    _write_minimal_compliant_gtfs_zip(path)
    payload = path.read_bytes()
    at = datetime(2026, 3, 24, 12, 0, 0, 123456, tzinfo=UTC)
    edition = EditionInput(
        901,
        902,
        903,
        "local",
        path.name,
        hashlib.sha256(payload).hexdigest(),
        len(payload),
        None,
        at,
        at,
        at + timedelta(seconds=1),
        at + timedelta(seconds=2),
    )
    window = ReplayWindow(
        "oracle_seed",
        {"static_schedule": 901, "trip_updates": 904, "vehicle_positions": 905},
        (),
        edition,
        at + timedelta(seconds=3),
        (),
    )
    settings = Settings(_env_file=None)
    return SimpleNamespace(
        window=window,
        settings=settings,
        registry=registry(tmp_path / "providers", settings),
        bronze=lambda backend: LocalBronzeStorage(backend, tmp_path),
    )


@pytest.fixture
def oracle(real_db_engine, case):
    clock = PinnedClock(case.window.serving_initialized_at_utc)
    with oracle_database(
        real_db_engine.url.render_as_string(hide_password=False),
        clock=clock,
        environment=os.environ,
    ) as engine:
        yield engine


def seed(engine, case):
    seed_static(
        engine, case.window, settings=case.settings, registry=case.registry, bronze=case.bronze
    )


def test_seeded_endpoints_equal_what_seed_core_writes_except_the_id(oracle, case):
    manifest = case.registry.get_provider(case.window.provider_id)
    with oracle.connect() as connection:
        transaction = connection.begin()
        _seed_provider(connection, manifest)
        _seed_feed_endpoints(connection, manifest, case.settings)
        expected = (
            connection.execute(text("SELECT * FROM core.feed_endpoints ORDER BY endpoint_key"))
            .mappings()
            .all()
        )
        expected = [{k: v for k, v in row.items() if k != "feed_endpoint_id"} for row in expected]
        transaction.rollback()
    seed(oracle, case)
    with oracle.connect() as connection:
        rows = (
            connection.execute(text("SELECT * FROM core.feed_endpoints ORDER BY endpoint_key"))
            .mappings()
            .all()
        )
        assert [
            {k: v for k, v in row.items() if k != "feed_endpoint_id"} for row in rows
        ] == expected
        assert {
            row["endpoint_key"]: row["feed_endpoint_id"] for row in rows
        } == case.window.feed_endpoints
        assert connection.execute(
            text("SELECT lines_without_live_data FROM core.providers")
        ).scalar_one() == [{"gap_id": "gap", "route_ids": ["1"], "route_types": []}]


def assert_raw_edition(connection, edition):
    assert tuple(
        connection.execute(
            text("""
        SELECT ingestion_run_id, feed_endpoint_id, status, requested_at_utc,
               started_at_utc, completed_at_utc FROM raw.ingestion_runs
    """)
        ).one()
    ) == (
        902,
        901,
        "succeeded",
        edition.requested_at_utc,
        edition.started_at_utc,
        edition.completed_at_utc,
    )
    assert tuple(
        connection.execute(
            text("""
        SELECT ingestion_object_id, ingestion_run_id, source_url, checksum_sha256,
               byte_size, created_at_utc FROM raw.ingestion_objects
    """)
        ).one()
    ) == (
        903,
        902,
        None,
        edition.checksum_sha256,
        edition.byte_size,
        edition.object_created_at_utc,
    )


def test_seed_static_loads_the_edition_and_its_source_version_is_set(oracle, case):
    seed(oracle, case)
    edition = case.window.edition
    with oracle.connect() as connection:
        version = connection.execute(
            text("""
            SELECT source_version, source_ingestion_run_id, source_ingestion_object_id
            FROM core.dataset_versions WHERE is_current
        """)
        ).one()
        assert tuple(version) == (edition.storage_path, 902, 903)
        assert connection.execute(
            text("SELECT trip_id FROM gold.trip_service_span")
        ).scalars().all() == ["trip-1"]
        assert connection.execute(text("SELECT route_id FROM gold.dim_route")).scalars().all() == [
            "1"
        ]
        assert_raw_edition(connection, edition)
        states = connection.execute(
            text("""
            SELECT endpoint_key, initialized_at_utc, realtime_snapshot_id, captured_at_utc
            FROM gold.realtime_serving_state ORDER BY endpoint_key
        """)
        ).all()
        assert [tuple(row) for row in states] == [
            (key, case.window.serving_initialized_at_utc, None, None)
            for key in ("trip_updates", "vehicle_positions")
        ]


def test_unknown_endpoint_is_refused(case):
    case.window = replace(case.window, feed_endpoints={"unknown": 999})
    engine = create_engine("sqlite://")
    try:
        with pytest.raises(SeedRefused, match="unknown"):
            seed(engine, case)
    finally:
        engine.dispose()


def test_sequences_move_past_seeded_ids(oracle, case):
    seed(oracle, case)
    for table, column, maximum in (
        ("core.feed_endpoints", "feed_endpoint_id", 905),
        ("raw.ingestion_runs", "ingestion_run_id", 902),
        ("raw.ingestion_objects", "ingestion_object_id", 903),
    ):
        with oracle.begin() as connection:
            next_id = connection.execute(
                text("SELECT nextval(pg_get_serial_sequence(:table, :column))"),
                {"table": table, "column": column},
            ).scalar_one()
            assert next_id > maximum
