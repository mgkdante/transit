"""Real-Postgres parity and rollback gates for static GTFS COPY loading."""

from __future__ import annotations

from datetime import UTC, datetime
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from psycopg.errors import UniqueViolation
from sqlalchemy import text

import transit_ops.silver.static_gtfs as static_silver_module
from transit_ops.silver.static_gtfs import BronzeStaticArchive, load_static_zip_to_silver

PARITY_PROVIDER = "f3c_copy_parity"
ROLLBACK_PROVIDER = "f3c_copy_rollback"
BUILDER_FAILURE_PROVIDER = "f3c_copy_builder_failure"
PARITY_BASE = 997_310_000
ROLLBACK_BASE = 997_320_000
BUILDER_FAILURE_BASE = 997_330_000

STATIC_TABLES_DELETE_ORDER = (
    "silver.stop_times",
    "silver.trips",
    "silver.stops",
    "silver.translations",
    "silver.shapes",
    "silver.route_patterns",
    "silver.directions",
    "silver.calendar_dates",
    "silver.calendar",
    "silver.feed_info",
    "silver.agency",
    "silver.routes",
    "silver.gtfs_extra_rows",
    "silver.gtfs_source_members",
)


class MemoryBronzeStorage:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload

    def exists(self, storage_path: str) -> bool:
        return True

    def read_bytes(self, storage_path: str) -> bytes:
        return self.payload

    def describe_location(self, storage_path: str) -> str:
        return storage_path


def _zip_bytes(members: dict[str, str]) -> bytes:
    buffer = BytesIO()
    with ZipFile(buffer, "w", compression=ZIP_DEFLATED) as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)
    return buffer.getvalue()


def _edge_members() -> dict[str, str]:
    return {
        "routes.txt": (
            "route_id,route_type,route_short_name,route_long_name\nR1,3,1,Ligne verte\n"
        ),
        "stops.txt": (
            "stop_id,stop_name,stop_desc,stop_lat,stop_lon,location_type\n"
            'S1,"Métro, Central","Ligne une\nLigne deux",45.5001,,0\n'
            "N1,,,,,3\n"
        ),
        "trips.txt": (
            "route_id,service_id,trip_id,trip_headsign,direction_id,note_fr\n"
            "R1,WK,T1,Métro centre,1,Direction est\\ouest\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled\n"
            "T1,25:35:00,25:40:00,S1,12,123.5\n"
        ),
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,"
            "start_date,end_date\n"
            "WK,1,1,1,1,1,0,0,20260324,20260630\n"
        ),
        "shapes.txt": (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,route_pattern_id\n"
            "shape-1,45.5,,7,\n"
        ),
        "translations.txt": (
            "table_name,field_name,language,record_id,translation\n"
            'stops,stop_name,en,S1,"Metro, Central\nLine two \\ accessible"\n'
        ),
    }


def _archive(*, provider_id: str, base: int, checksum: str) -> BronzeStaticArchive:
    return BronzeStaticArchive(
        provider_id=provider_id,
        storage_backend="local",
        feed_endpoint_id=base + 1,
        source_ingestion_run_id=base + 2,
        source_ingestion_object_id=base + 3,
        storage_path=f"{provider_id}/static_schedule/test.zip",
        archive_full_path=f"{provider_id}/static_schedule/test.zip",
        source_url="https://example.test/static.zip",
        checksum_sha256=checksum,
        byte_size=None,
        source_completed_at_utc=datetime(2026, 7, 21, tzinfo=UTC),
    )


def _seed_lineage(connection, *, provider_id: str, base: int, seed_provider) -> None:  # noqa: ANN001
    seed_provider(
        connection,
        provider_id,
        display_name="F3c COPY test",
        timezone="UTC",
    )
    connection.execute(
        text(
            """
            INSERT INTO core.feed_endpoints (
                feed_endpoint_id, provider_id, endpoint_key, feed_kind, source_format
            ) VALUES (
                :endpoint_id, :provider_id, 'static', 'static_schedule', 'gtfs_schedule_zip'
            )
            """
        ),
        {"endpoint_id": base + 1, "provider_id": provider_id},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_runs (
                ingestion_run_id, provider_id, feed_endpoint_id, run_kind, status
            ) VALUES (
                :run_id, :provider_id, :endpoint_id, 'static_schedule', 'succeeded'
            )
            """
        ),
        {"run_id": base + 2, "provider_id": provider_id, "endpoint_id": base + 1},
    )
    connection.execute(
        text(
            """
            INSERT INTO raw.ingestion_objects (
                ingestion_object_id, ingestion_run_id, provider_id, object_kind,
                storage_backend, storage_path, checksum_sha256
            ) VALUES (
                :object_id, :run_id, :provider_id, 'gtfs_schedule_zip',
                'local', :storage_path, :checksum
            )
            """
        ),
        {
            "object_id": base + 3,
            "run_id": base + 2,
            "provider_id": provider_id,
            "storage_path": f"{provider_id}/static_schedule/test.zip",
            "checksum": "a" * 64,
        },
    )


def _seed_current_dataset_version(connection, *, provider_id: str, base: int, checksum: str) -> int:  # noqa: ANN001
    version_id = base + 4
    connection.execute(
        text(
            """
            INSERT INTO core.dataset_versions (
                dataset_version_id, provider_id, feed_endpoint_id,
                source_ingestion_run_id, source_ingestion_object_id,
                dataset_kind, content_hash, is_current
            ) VALUES (
                :version_id, :provider_id, :endpoint_id, :run_id, :object_id,
                'static_schedule', :checksum, true
            )
            """
        ),
        {
            "version_id": version_id,
            "provider_id": provider_id,
            "endpoint_id": base + 1,
            "run_id": base + 2,
            "object_id": base + 3,
            "checksum": checksum,
        },
    )
    return version_id


def _cleanup(engine, provider_id: str) -> None:  # noqa: ANN001
    with engine.begin() as connection:
        for table_name in STATIC_TABLES_DELETE_ORDER:
            connection.execute(
                text(f"DELETE FROM {table_name} WHERE provider_id = :provider_id"),
                {"provider_id": provider_id},
            )
        connection.execute(
            text("DELETE FROM core.dataset_versions WHERE provider_id = :provider_id"),
            {"provider_id": provider_id},
        )
        connection.execute(
            text("DELETE FROM raw.ingestion_objects WHERE provider_id = :provider_id"),
            {"provider_id": provider_id},
        )
        connection.execute(
            text("DELETE FROM raw.ingestion_runs WHERE provider_id = :provider_id"),
            {"provider_id": provider_id},
        )
        connection.execute(
            text("DELETE FROM core.feed_endpoints WHERE provider_id = :provider_id"),
            {"provider_id": provider_id},
        )
        connection.execute(
            text("DELETE FROM core.providers WHERE provider_id = :provider_id"),
            {"provider_id": provider_id},
        )


def test_static_copy_round_trips_typed_rows_on_real_postgres(real_db_engine, seed_provider) -> None:
    engine = real_db_engine
    _cleanup(engine, PARITY_PROVIDER)
    try:
        with engine.connect() as connection:
            transaction = connection.begin()
            _seed_lineage(
                connection,
                provider_id=PARITY_PROVIDER,
                base=PARITY_BASE,
                seed_provider=seed_provider,
            )
            payload = _zip_bytes(_edge_members())
            result = load_static_zip_to_silver(
                connection,
                archive=_archive(
                    provider_id=PARITY_PROVIDER,
                    base=PARITY_BASE,
                    checksum="b" * 64,
                ),
                bronze_storage=MemoryBronzeStorage(payload),
            )

            assert result.row_counts == {
                "routes": 1,
                "stops": 2,
                "trips": 1,
                "stop_times": 1,
                "calendar": 1,
                "calendar_dates": 0,
                "shapes": 1,
                "translations": 1,
            }
            stop_rows = connection.execute(
                text(
                    """
                    SELECT stop_id, stop_name, stop_desc, stop_lat, stop_lon, location_type
                    FROM silver.stops
                    WHERE dataset_version_id = :version_id
                    ORDER BY stop_id
                    """
                ),
                {"version_id": result.dataset_version_id},
            ).all()
            assert stop_rows == [
                ("N1", None, None, None, None, 3),
                ("S1", "Métro, Central", "Ligne une\nLigne deux", 45.5001, None, 0),
            ]
            assert connection.execute(
                text(
                    """
                    SELECT trip_headsign, direction_id, note_fr
                    FROM silver.trips WHERE dataset_version_id = :version_id
                    """
                ),
                {"version_id": result.dataset_version_id},
            ).one() == ("Métro centre", 1, "Direction est\\ouest")
            assert connection.execute(
                text(
                    """
                    SELECT stop_sequence, arrival_time, departure_time, shape_dist_traveled
                    FROM silver.stop_times WHERE dataset_version_id = :version_id
                    """
                ),
                {"version_id": result.dataset_version_id},
            ).one() == (12, "25:35:00", "25:40:00", 123.5)
            assert connection.execute(
                text(
                    """
                    SELECT shape_pt_sequence, shape_pt_lat, shape_pt_lon, route_pattern_id
                    FROM silver.shapes WHERE dataset_version_id = :version_id
                    """
                ),
                {"version_id": result.dataset_version_id},
            ).one() == (7, 45.5, None, None)
            assert connection.execute(
                text(
                    """
                    SELECT translation_row_number, translation
                    FROM silver.translations WHERE dataset_version_id = :version_id
                    """
                ),
                {"version_id": result.dataset_version_id},
            ).one() == (1, "Metro, Central\nLine two \\ accessible")
            transaction.rollback()
    finally:
        _cleanup(engine, PARITY_PROVIDER)


def test_static_copy_constraint_failure_rolls_back_the_entire_load(
    real_db_engine, seed_provider
) -> None:
    engine = real_db_engine
    _cleanup(engine, ROLLBACK_PROVIDER)
    try:
        with engine.begin() as connection:
            _seed_lineage(
                connection,
                provider_id=ROLLBACK_PROVIDER,
                base=ROLLBACK_BASE,
                seed_provider=seed_provider,
            )
            old_version_id = _seed_current_dataset_version(
                connection,
                provider_id=ROLLBACK_PROVIDER,
                base=ROLLBACK_BASE,
                checksum="c" * 64,
            )

        members = _edge_members()
        members["shapes.txt"] = (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n"
            "duplicate,45.5,-73.5,1\n"
            "duplicate,45.6,-73.6,1\n"
        )
        with pytest.raises(UniqueViolation) as exc_info:
            with engine.begin() as connection:
                load_static_zip_to_silver(
                    connection,
                    archive=_archive(
                        provider_id=ROLLBACK_PROVIDER,
                        base=ROLLBACK_BASE,
                        checksum="d" * 64,
                    ),
                    bronze_storage=MemoryBronzeStorage(_zip_bytes(members)),
                )
        assert exc_info.value.sqlstate == "23505"

        with engine.connect() as connection:
            versions = connection.execute(
                text(
                    """
                    SELECT dataset_version_id, is_current
                    FROM core.dataset_versions
                    WHERE provider_id = :provider_id
                    ORDER BY dataset_version_id
                    """
                ),
                {"provider_id": ROLLBACK_PROVIDER},
            ).all()
            assert versions == [(old_version_id, True)]
            for table_name in (
                "stops",
                "trips",
                "stop_times",
                "shapes",
                "translations",
            ):
                assert (
                    connection.execute(
                        text(
                            f"SELECT count(*) FROM silver.{table_name} "
                            "WHERE provider_id = :provider_id"
                        ),
                        {"provider_id": ROLLBACK_PROVIDER},
                    ).scalar_one()
                    == 0
                )
    finally:
        _cleanup(engine, ROLLBACK_PROVIDER)


def test_static_copy_late_builder_failure_preserves_error_and_rolls_back(
    monkeypatch: pytest.MonkeyPatch,
    real_db_engine,
    seed_provider,
) -> None:
    engine = real_db_engine
    _cleanup(engine, BUILDER_FAILURE_PROVIDER)
    started_copy_targets: list[str] = []
    completed_copy_targets: list[str] = []
    original_copy = static_silver_module.execute_copy_insert

    def recording_copy(connection, *, target, rows):  # noqa: ANN001
        started_copy_targets.append(target.table)
        row_count = original_copy(connection, target=target, rows=rows)
        completed_copy_targets.append(target.table)
        return row_count

    monkeypatch.setattr(static_silver_module, "execute_copy_insert", recording_copy)
    try:
        with engine.begin() as connection:
            _seed_lineage(
                connection,
                provider_id=BUILDER_FAILURE_PROVIDER,
                base=BUILDER_FAILURE_BASE,
                seed_provider=seed_provider,
            )
            old_version_id = _seed_current_dataset_version(
                connection,
                provider_id=BUILDER_FAILURE_PROVIDER,
                base=BUILDER_FAILURE_BASE,
                checksum="e" * 64,
            )

        members = _edge_members()
        members["translations.txt"] = (
            "table_name,field_name,language,record_id,translation\n"
            "stops,stop_name,en,S1,Metro Central\n"
            "stops,stop_name,fr,S1,\n"
        )
        with pytest.raises(ValueError) as exc_info:
            with engine.begin() as connection:
                load_static_zip_to_silver(
                    connection,
                    archive=_archive(
                        provider_id=BUILDER_FAILURE_PROVIDER,
                        base=BUILDER_FAILURE_BASE,
                        checksum="f" * 64,
                    ),
                    bronze_storage=MemoryBronzeStorage(_zip_bytes(members)),
                )
        assert type(exc_info.value) is ValueError
        assert str(exc_info.value) == ("translations.txt requires non-empty column 'translation'.")
        assert started_copy_targets == [
            "stops",
            "trips",
            "stop_times",
            "shapes",
            "translations",
        ]
        assert completed_copy_targets == ["stops", "trips", "stop_times", "shapes"]

        with engine.connect() as connection:
            versions = connection.execute(
                text(
                    """
                    SELECT dataset_version_id, is_current
                    FROM core.dataset_versions
                    WHERE provider_id = :provider_id
                    ORDER BY dataset_version_id
                    """
                ),
                {"provider_id": BUILDER_FAILURE_PROVIDER},
            ).all()
            assert versions == [(old_version_id, True)]
            for table_name in (
                "routes",
                "stops",
                "trips",
                "stop_times",
                "calendar",
                "shapes",
                "translations",
            ):
                assert (
                    connection.execute(
                        text(
                            f"SELECT count(*) FROM silver.{table_name} "
                            "WHERE provider_id = :provider_id"
                        ),
                        {"provider_id": BUILDER_FAILURE_PROVIDER},
                    ).scalar_one()
                    == 0
                )
    finally:
        _cleanup(engine, BUILDER_FAILURE_PROVIDER)
