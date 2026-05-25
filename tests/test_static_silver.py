from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest

import transit_ops.silver.static_gtfs as static_silver_module
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.silver.static_gtfs import (
    BronzeStaticArchive,
    _iter_gtfs_rows,
    discover_gtfs_members,
    load_latest_static_to_silver,
    load_static_zip_to_silver,
    register_dataset_version,
    validate_required_static_members,
)


class FakeResult:
    def __init__(
        self,
        scalar_value: int | None = None,
        rows: list[tuple[int]] | None = None,
    ) -> None:
        self.scalar_value = scalar_value
        self.rows = rows or []

    def scalar_one(self) -> int:
        if self.scalar_value is None:
            raise AssertionError("Expected a scalar value.")
        return self.scalar_value

    def __iter__(self):
        return iter(self.rows)


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "RETURNING dataset_version_id" in sql_text:
            return FakeResult(700)
        if "SELECT dataset_version_id" in sql_text:
            return FakeResult(rows=[(700,)])
        return FakeResult()


class LookupResult:
    def __init__(self, mapping_value: dict[str, object] | None) -> None:
        self.mapping_value = mapping_value

    def mappings(self) -> LookupResult:
        return self

    def one_or_none(self) -> dict[str, object] | None:
        return self.mapping_value


class LookupConnection:
    def __init__(self, row: dict[str, object] | None) -> None:
        self.row = row

    def execute(self, statement, params=None):  # noqa: ANN001
        return LookupResult(self.row)


class _ContextManager:
    def __init__(self, connection) -> None:  # noqa: ANN001
        self.connection = connection

    def __enter__(self):  # noqa: ANN201
        return self.connection

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001, ANN201
        return False


class FakeEngine:
    def __init__(self, connect_connection, begin_connection) -> None:  # noqa: ANN001
        self.connect_connection = connect_connection
        self.begin_connection = begin_connection

    def connect(self):  # noqa: ANN201
        return _ContextManager(self.connect_connection)

    def begin(self):  # noqa: ANN201
        return _ContextManager(self.begin_connection)


class FakeBronzeStorage:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.read_calls: list[str] = []

    def exists(self, storage_path: str) -> bool:
        return True

    def read_bytes(self, storage_path: str) -> bytes:
        self.read_calls.append(storage_path)
        return self.payload

    def describe_location(self, storage_path: str) -> str:
        return f"s3://bronze-bucket/{storage_path}"


class LocalBronzeStorageForTests(FakeBronzeStorage):
    def describe_location(self, storage_path: str) -> str:
        return storage_path


def _write_gtfs_zip(
    zip_path: Path,
    *,
    include_calendar: bool = True,
    include_calendar_dates: bool = True,
    include_routes: bool = True,
) -> None:
    members: dict[str, str] = {
        "feed/trips.txt": (
            "route_id,service_id,trip_id,trip_headsign\n"
            "route-1,weekday,trip-1,Downtown\n"
        ),
        "feed/stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon\n"
            "stop-1,Main Stop,45.5000,-73.5000\n"
        ),
        "feed/stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "trip-1,08:00:00,08:00:00,stop-1,1\n"
            "trip-1,08:10:00,08:10:00,stop-1,2\n"
        ),
    }
    if include_routes:
        members["feed/routes.txt"] = (
            "route_id,route_type,route_short_name,route_long_name\n"
            "route-1,3,10,Green Line\n"
        )
    if include_calendar:
        members["feed/calendar.txt"] = (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,start_date,end_date\n"
            "weekday,1,1,1,1,1,0,0,20260324,20260630\n"
        )
    if include_calendar_dates:
        members["feed/calendar_dates.txt"] = (
            "service_id,date,exception_type\n"
            "weekday,20260325,1\n"
        )

    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)


def _write_beta_gtfs_zip(zip_path: Path) -> None:
    members: dict[str, str] = {
        "agency.txt": (
            "agency_id,agency_name,agency_url,agency_timezone,agency_lang,"
            "agency_phone,agency_fare_url\n"
            "STM,Societe de transport de Montreal,https://www.stm.info,"
            "America/Montreal,fr,,https://www.stm.info/fr/tarifs\n"
        ),
        "feed_info.txt": (
            "feed_publisher_name,feed_publisher_url,feed_lang,"
            "feed_start_date,feed_end_date,feed_version\n"
            "STM,https://www.stm.info,fr,20260105,20260614,20260505090000_26M\n"
        ),
        "routes.txt": (
            "route_id,agency_id,route_short_name,route_long_name,route_type,"
            "route_url,route_color,route_text_color,route_desc,route_desc_detail\n"
            "1,STM,1,Ligne 1 - Verte,1,https://www.stm.info,00B300,FFFFFF,"
            "Metro,Lignes de jour seulement\n"
        ),
        "directions.txt": (
            "route_direction_id,route_id,direction_id,direction,direction_legacy\n"
            "1_0,1,0,Est,EAST\n"
        ),
        "route_patterns.txt": (
            "route_pattern_id,route_id,direction_id,route_pattern_typicality\n"
            "1_1071,1,0,0\n"
        ),
        "trips.txt": (
            "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id,"
            "wheelchair_accessible,route_pattern_id\n"
            "1,weekday,trip-1,Station Honore-Beaugrand,0,1_1071,1,1_1071\n"
        ),
        "shapes.txt": (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,route_pattern_id\n"
            "1_1071,45.446466,-73.603118,10001,1_1071\n"
            "1_1071,45.451158,-73.593242,10002,1_1071\n"
        ),
        "stops.txt": (
            "stop_id,stop_code,stop_name,stop_lat,stop_lon,stop_url,"
            "location_type,parent_station,wheelchair_boarding\n"
            "43,10118,Station Angrignon,45.446466,-73.603118,"
            "https://www.stm.info/fr/infos/reseaux/metro/angrignon,0,STATION_M118,1\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence,pickup_type\n"
            "trip-1,08:00:00,08:00:00,43,1,0\n"
        ),
        "calendar_dates.txt": "service_id,date,exception_type\nweekday,20260524,1\n",
        "translations.txt": (
            "table_name,field_name,language,record_id,translation\n"
            "routes,route_desc,en,1,Day lines only\n"
        ),
    }

    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)


def _build_archive(zip_path: Path) -> BronzeStaticArchive:
    return BronzeStaticArchive(
        provider_id="stm",
        storage_backend="local",
        feed_endpoint_id=1,
        source_ingestion_run_id=10,
        source_ingestion_object_id=20,
        storage_path="stm/static_schedule/sample.zip",
        archive_full_path=str(zip_path),
        source_url="https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip",
        checksum_sha256="abc123" * 10 + "abcd",
        byte_size=zip_path.stat().st_size,
        source_completed_at_utc=datetime(2026, 3, 24, 12, 0, 0, tzinfo=UTC),
    )


def test_discover_gtfs_members_normalizes_nested_paths(tmp_path: Path) -> None:
    zip_path = tmp_path / "gtfs.zip"
    _write_gtfs_zip(zip_path)

    member_map = discover_gtfs_members(zip_path)

    assert member_map["routes.txt"] == "feed/routes.txt"
    assert member_map["stop_times.txt"] == "feed/stop_times.txt"
    assert member_map["calendar_dates.txt"] == "feed/calendar_dates.txt"


def test_validate_required_static_members_requires_core_and_service_files() -> None:
    with pytest.raises(ValueError, match="Missing required GTFS members: routes.txt"):
        validate_required_static_members(
            {
                "trips.txt": "trips.txt",
                "stops.txt": "stops.txt",
                "stop_times.txt": "stop_times.txt",
                "calendar.txt": "calendar.txt",
            }
        )

    with pytest.raises(ValueError, match="At least one of calendar.txt or calendar_dates.txt"):
        validate_required_static_members(
            {
                "routes.txt": "routes.txt",
                "trips.txt": "trips.txt",
                "stops.txt": "stops.txt",
                "stop_times.txt": "stop_times.txt",
            }
        )


def test_load_static_zip_to_silver_can_require_beta_schema_contract(tmp_path: Path) -> None:
    zip_path = tmp_path / "current-gtfs.zip"
    _write_gtfs_zip(zip_path)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    with pytest.raises(ValueError, match="Missing beta GTFS contract members"):
        load_static_zip_to_silver(
            connection,
            archive=archive,
            bronze_storage=bronze_storage,
            require_beta_static_contract=True,
        )


def test_iter_gtfs_rows_parses_csv_rows_from_zip(tmp_path: Path) -> None:
    zip_path = tmp_path / "gtfs.zip"
    _write_gtfs_zip(zip_path)

    with ZipFile(zip_path) as zip_file:
        rows = list(
            _iter_gtfs_rows(
                zip_file,
                member_name="feed/routes.txt",
                required_columns={"route_id", "route_type"},
            )
        )

    assert rows == [
        {
            "route_id": "route-1",
            "route_type": "3",
            "route_short_name": "10",
            "route_long_name": "Green Line",
        }
    ]


def test_register_dataset_version_updates_current_then_inserts_new_row(tmp_path: Path) -> None:
    zip_path = tmp_path / "gtfs.zip"
    _write_gtfs_zip(zip_path)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    loaded_at_utc = datetime(2026, 3, 24, 13, 0, 0, tzinfo=UTC)

    dataset_version_id, version_loaded_at_utc = register_dataset_version(
        connection,
        archive=archive,
        loaded_at_utc=loaded_at_utc,
    )

    assert dataset_version_id == 700
    assert version_loaded_at_utc == loaded_at_utc
    assert "UPDATE core.dataset_versions" in connection.calls[0][0]
    assert "INSERT INTO core.dataset_versions" in connection.calls[1][0]
    insert_params = connection.calls[1][1]
    assert insert_params["source_version"] == archive.storage_path
    assert insert_params["content_hash"] == archive.checksum_sha256


def test_load_static_zip_to_silver_records_row_counts(tmp_path: Path) -> None:
    zip_path = tmp_path / "gtfs.zip"
    _write_gtfs_zip(zip_path)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
    )

    assert result.dataset_version_id == 700
    assert result.row_counts == {
        "routes": 1,
        "stops": 1,
        "trips": 1,
        "stop_times": 2,
        "calendar": 1,
        "calendar_dates": 1,
    }
    assert "INSERT INTO silver.routes" in connection.calls[2][0]
    assert "INSERT INTO silver.stops" in connection.calls[3][0]
    assert "INSERT INTO silver.trips" in connection.calls[4][0]
    assert "INSERT INTO silver.stop_times" in connection.calls[5][0]
    assert "INSERT INTO silver.calendar" in connection.calls[6][0]
    assert "INSERT INTO silver.calendar_dates" in connection.calls[7][0]


def test_load_static_zip_to_silver_loads_beta_first_static_members(tmp_path: Path) -> None:
    zip_path = tmp_path / "beta-gtfs.zip"
    _write_beta_gtfs_zip(zip_path)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
        require_beta_static_contract=True,
    )

    assert result.row_counts["agency"] == 1
    assert result.row_counts["feed_info"] == 1
    assert result.row_counts["directions"] == 1
    assert result.row_counts["route_patterns"] == 1
    assert result.row_counts["shapes"] == 2
    assert result.row_counts["translations"] == 1

    sql_calls = [call[0] for call in connection.calls]
    assert any("INSERT INTO silver.agency" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.feed_info" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.directions" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.route_patterns" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.shapes" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.translations" in sql for sql in sql_calls)

    route_params = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO silver.routes" in sql
    )
    assert route_params[0]["route_desc_detail"] == "Lignes de jour seulement"

    trip_params = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO silver.trips" in sql
    )
    assert trip_params[0]["route_pattern_id"] == "1_1071"


def test_load_static_zip_to_silver_allows_missing_calendar_txt(tmp_path: Path) -> None:
    zip_path = tmp_path / "gtfs.zip"
    _write_gtfs_zip(zip_path, include_calendar=False, include_calendar_dates=True)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
    )

    assert result.row_counts["calendar"] == 0
    assert result.row_counts["calendar_dates"] == 1


def test_load_latest_static_to_silver_reads_s3_backed_archive(
    tmp_path: Path,
    monkeypatch,
) -> None:
    zip_path = tmp_path / "gtfs.zip"
    _write_beta_gtfs_zip(zip_path)
    fake_storage = FakeBronzeStorage(zip_path.read_bytes())
    lookup_row = {
        "provider_id": "stm",
        "storage_backend": "s3",
        "feed_endpoint_id": 1,
        "source_ingestion_run_id": 10,
        "source_ingestion_object_id": 20,
        "storage_path": "stm/static_schedule/ingested_at_utc=2026-03-25/sample.zip",
        "source_url": "https://example.com/static.zip",
        "checksum_sha256": "f" * 64,
        "byte_size": zip_path.stat().st_size,
        "source_completed_at_utc": datetime(2026, 3, 25, 0, 0, 0, tzinfo=UTC),
    }
    settings = Settings(
        _env_file=None,
        DATABASE_URL="postgresql://user:pass@example.com/transit",
        BRONZE_S3_ENDPOINT="https://example.r2.cloudflarestorage.com",
        BRONZE_S3_BUCKET="bronze-bucket",
        BRONZE_S3_ACCESS_KEY="access",
        BRONZE_S3_SECRET_KEY="secret",
        BRONZE_S3_REGION="auto",
    )
    registry = ProviderRegistry.from_project_root(
        project_root=Path(__file__).resolve().parents[1],
        settings=settings,
    )
    engine = FakeEngine(LookupConnection(lookup_row), RecordingConnection())

    monkeypatch.setattr(
        static_silver_module,
        "get_bronze_storage",
        lambda settings, project_root, storage_backend: fake_storage,
    )

    result = load_latest_static_to_silver(
        "stm",
        settings=settings,
        registry=registry,
        engine=engine,
    )

    assert result.dataset_version_id == 700
    assert result.archive_full_path == (
        "s3://bronze-bucket/stm/static_schedule/ingested_at_utc=2026-03-25/sample.zip"
    )
    assert result.row_counts == {
        "agency": 1,
        "routes": 1,
        "directions": 1,
        "route_patterns": 1,
        "stops": 1,
        "trips": 1,
        "stop_times": 1,
        "feed_info": 1,
        "shapes": 2,
        "calendar": 0,
        "calendar_dates": 1,
        "translations": 1,
    }
    assert fake_storage.read_calls == [lookup_row["storage_path"]]
