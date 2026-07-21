from __future__ import annotations

from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
from sqlalchemy.dialects import postgresql

import transit_ops.silver.static_gtfs as static_silver_module
from transit_ops.providers.registry import ProviderRegistry
from transit_ops.settings import Settings
from transit_ops.silver.static_gtfs import (
    GTFS_EXTRA_ROW_INSERT,
    GTFS_SOURCE_MEMBER_INSERT,
    BronzeStaticArchive,
    _build_agency_record,
    _build_feed_info_record,
    _build_stop_record,
    _build_stop_time_record,
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


class RecordingCopy:
    def __init__(self, rows: list[tuple[object, ...]]) -> None:
        self.rows = rows

    def __enter__(self) -> RecordingCopy:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False

    def write_row(self, row) -> None:  # noqa: ANN001
        self.rows.append(tuple(row))


class RecordingCursor:
    def __init__(self, copy_calls: list[dict[str, object]]) -> None:
        self.copy_calls = copy_calls

    def __enter__(self) -> RecordingCursor:
        return self

    def __exit__(self, exc_type, exc, tb) -> bool:  # noqa: ANN001
        return False

    def copy(self, statement) -> RecordingCopy:  # noqa: ANN001
        sql_text = statement.as_string() if hasattr(statement, "as_string") else str(statement)
        rows: list[tuple[object, ...]] = []
        self.copy_calls.append({"sql": sql_text, "rows": rows})
        return RecordingCopy(rows)


class RecordingDriverConnection:
    def __init__(self, copy_calls: list[dict[str, object]]) -> None:
        self.copy_calls = copy_calls

    def cursor(self) -> RecordingCursor:
        return RecordingCursor(self.copy_calls)


class RecordingConnectionFacade:
    def __init__(self, copy_calls: list[dict[str, object]]) -> None:
        self.driver_connection = RecordingDriverConnection(copy_calls)


class RecordingConnection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, object]] = []
        self.copy_calls: list[dict[str, object]] = []
        self.connection = RecordingConnectionFacade(self.copy_calls)

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "RETURNING dataset_version_id" in sql_text:
            return FakeResult(700)
        if "SELECT dataset_version_id" in sql_text:
            return FakeResult(rows=[(700,)])
        return FakeResult()


def _copy_rows_for(
    connection: RecordingConnection,
    table_name: str,
) -> list[tuple[object, ...]]:
    return next(
        call["rows"] for call in connection.copy_calls if f'"silver"."{table_name}"' in call["sql"]
    )


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


def _write_beta_gtfs_zip(
    zip_path: Path,
    *,
    include_notes: bool = False,
    include_trip_notes: bool = False,
) -> None:
    trip_header = (
        "route_id,service_id,trip_id,trip_headsign,direction_id,shape_id,"
        "wheelchair_accessible,route_pattern_id"
    )
    trip_row = "1,weekday,trip-1,Station Honore-Beaugrand,0,1_1071,1,1_1071"
    if include_trip_notes:
        trip_header = f"{trip_header},note_fr,note_en"
        trip_row = f"{trip_row},Direction est,Eastbound"

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
        "trips.txt": f"{trip_header}\n{trip_row}\n",
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
    if include_notes:
        members["feed/notes.txt"] = (
            "note_id,note_fr,note_en\n"
            "n1,Service modifie,Modified service\n"
            "n2,Arret temporaire,Temporary stop\n"
        )

    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)


def _minimal_compliant_members() -> dict[str, str]:
    """The members of a fully GTFS-compliant single-agency feed that exercises the
    loader relaxations: agency.txt with no agency_id column, feed_info.txt with no
    date range / version, and a generic-node stop (location_type 3) with no
    stop_name. Mirrors the minimal shape a small third-party provider may ship."""
    return {
        "agency.txt": (
            "agency_name,agency_url,agency_timezone\n"
            "Societe de transport de Sherbrooke,https://www.sts.qc.ca,America/Toronto\n"
        ),
        "feed_info.txt": (
            "feed_publisher_name,feed_publisher_url,feed_lang\n"
            "STS,https://www.sts.qc.ca,fr\n"
        ),
        "routes.txt": (
            "route_id,route_type,route_short_name,route_long_name\n"
            "1,3,1,Centre-ville\n"
        ),
        "trips.txt": (
            "route_id,service_id,trip_id,trip_headsign\n"
            "1,weekday,trip-1,Centre-ville\n"
        ),
        "stops.txt": (
            "stop_id,stop_name,stop_lat,stop_lon,location_type\n"
            "stop-1,Terminus,45.4000,-71.9000,0\n"
            "node-1,,45.4010,-71.9010,3\n"
        ),
        "stop_times.txt": (
            "trip_id,arrival_time,departure_time,stop_id,stop_sequence\n"
            "trip-1,08:00:00,08:00:00,stop-1,1\n"
            "trip-1,08:10:00,08:10:00,stop-1,2\n"
        ),
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,"
            "start_date,end_date\n"
            "weekday,1,1,1,1,1,0,0,20260324,20260630\n"
        ),
    }


def _write_members_zip(zip_path: Path, members: dict[str, str]) -> None:
    with ZipFile(zip_path, "w", compression=ZIP_DEFLATED) as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)


def _write_minimal_compliant_gtfs_zip(zip_path: Path) -> None:
    _write_members_zip(zip_path, _minimal_compliant_members())


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


def test_stop_time_record_validates_gtfs_service_time_without_losing_source_text() -> None:
    record = _build_stop_time_record(
        {
            "trip_id": "trip-1",
            "arrival_time": "25:35:00",
            "departure_time": "25:40:00",
            "stop_id": "stop-1",
            "stop_sequence": "12",
        },
        provider_id="stm",
        dataset_version_id=700,
    )

    assert record["arrival_time"] == "25:35:00"
    assert record["departure_time"] == "25:40:00"

    with pytest.raises(ValueError, match="stop_times.arrival_time"):
        _build_stop_time_record(
            {
                "trip_id": "trip-1",
                "arrival_time": "24:99:00",
                "departure_time": "25:40:00",
                "stop_id": "stop-1",
                "stop_sequence": "12",
            },
            provider_id="stm",
            dataset_version_id=700,
        )


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
    sql_calls = [sql for sql, _ in connection.calls]
    assert any("INSERT INTO silver.routes" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.calendar" in sql for sql in sql_calls)
    assert any("INSERT INTO silver.calendar_dates" in sql for sql in sql_calls)
    assert not any("INSERT INTO silver.stops" in sql for sql in sql_calls)
    assert not any("INSERT INTO silver.trips" in sql for sql in sql_calls)
    assert not any("INSERT INTO silver.stop_times" in sql for sql in sql_calls)
    assert [call["sql"].split(" (", 1)[0] for call in connection.copy_calls] == [
        'COPY "silver"."stops"',
        'COPY "silver"."trips"',
        'COPY "silver"."stop_times"',
    ]


def test_static_bulk_copy_uses_one_stream_for_more_than_one_insert_chunk(
    tmp_path: Path,
) -> None:
    members = _minimal_compliant_members()
    members["stops.txt"] = "stop_id,stop_name\n" + "".join(
        f"stop-{index},Stop {index}\n" for index in range(static_silver_module.CHUNK_SIZE + 1)
    )
    zip_path = tmp_path / "large-stops.zip"
    _write_members_zip(zip_path, members)
    connection = RecordingConnection()

    result = load_static_zip_to_silver(
        connection,
        archive=_build_archive(zip_path),
        bronze_storage=LocalBronzeStorageForTests(zip_path.read_bytes()),
    )

    assert result.row_counts["stops"] == static_silver_module.CHUNK_SIZE + 1
    assert len(_copy_rows_for(connection, "stops")) == static_silver_module.CHUNK_SIZE + 1
    assert not any("INSERT INTO silver.stops" in sql for sql, _ in connection.calls)


def test_static_bulk_copy_skips_empty_and_missing_members(tmp_path: Path) -> None:
    members = {
        "routes.txt": "route_id,route_type\n",
        "trips.txt": "route_id,service_id,trip_id\n",
        "stops.txt": "stop_id\n",
        "stop_times.txt": "trip_id,stop_id,stop_sequence\n",
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,"
            "start_date,end_date\n"
            "weekday,1,1,1,1,1,0,0,20260324,20260630\n"
        ),
        "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\n",
        "translations.txt": "table_name,field_name,language,record_id,translation\n",
    }
    zip_path = tmp_path / "empty-bulk-members.zip"
    _write_members_zip(zip_path, members)
    connection = RecordingConnection()

    result = load_static_zip_to_silver(
        connection,
        archive=_build_archive(zip_path),
        bronze_storage=LocalBronzeStorageForTests(zip_path.read_bytes()),
    )

    assert result.row_counts == {
        "routes": 0,
        "stops": 0,
        "trips": 0,
        "stop_times": 0,
        "calendar": 1,
        "calendar_dates": 0,
    }
    assert connection.copy_calls == []


def test_build_agency_record_synthesizes_agency_id_when_absent() -> None:
    record = _build_agency_record(
        {
            "agency_name": "Societe de transport de l'Outaouais",
            "agency_url": "https://www.sto.ca",
            "agency_timezone": "America/Toronto",
        },
        provider_id="sto",
        dataset_version_id=700,
    )

    # GTFS allows omitting agency_id on a single-agency feed; the loader
    # synthesizes a stable surrogate so silver.agency (agency_id NOT NULL) loads.
    assert record["agency_id"] == "sto"
    assert record["agency_name"] == "Societe de transport de l'Outaouais"


def test_build_agency_record_keeps_explicit_agency_id() -> None:
    record = _build_agency_record(
        {
            "agency_id": "STM",
            "agency_name": "Societe de transport de Montreal",
            "agency_url": "https://www.stm.info",
            "agency_timezone": "America/Montreal",
        },
        provider_id="stm",
        dataset_version_id=700,
    )

    assert record["agency_id"] == "STM"


def test_build_feed_info_record_allows_missing_dates_and_version() -> None:
    record = _build_feed_info_record(
        {
            "feed_publisher_name": "OC Transpo",
            "feed_publisher_url": "https://www.octranspo.com",
            "feed_lang": "en",
        },
        provider_id="octranspo",
        dataset_version_id=700,
    )

    assert record["feed_start_date"] is None
    assert record["feed_end_date"] is None
    assert record["feed_version"] is None
    assert record["feed_publisher_name"] == "OC Transpo"


def test_build_stop_record_allows_missing_name_for_node_and_boarding_area() -> None:
    for location_type in ("3", "4"):
        record = _build_stop_record(
            {"stop_id": "node-1", "location_type": location_type},
            provider_id="sts",
            dataset_version_id=700,
        )
        assert record["stop_name"] is None
        assert record["location_type"] == int(location_type)


def test_build_stop_record_requires_name_for_stop_station_entrance() -> None:
    for location_type in ("", "0", "1", "2"):
        row: dict[str, str] = {"stop_id": "stop-1"}
        if location_type:
            row["location_type"] = location_type
        with pytest.raises(ValueError, match="stop_name"):
            _build_stop_record(row, provider_id="sts", dataset_version_id=700)


def test_load_static_zip_to_silver_welcomes_minimal_compliant_feed(
    tmp_path: Path,
) -> None:
    zip_path = tmp_path / "minimal-gtfs.zip"
    _write_minimal_compliant_gtfs_zip(zip_path)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
    )

    # A single-agency feed with no agency_id, no feed_info dates/version, and a
    # nameless generic-node stop loads end-to-end without raising.
    assert result.row_counts["agency"] == 1
    assert result.row_counts["feed_info"] == 1
    assert result.row_counts["routes"] == 1
    assert result.row_counts["stops"] == 2
    assert result.conformance_warnings == []


def test_strict_gtfs_hard_fails_on_non_spine_member_missing_required_column(
    tmp_path: Path,
) -> None:
    members = _minimal_compliant_members()
    # agency.txt missing the required agency_timezone column.
    members["agency.txt"] = "agency_name,agency_url\nSTS,https://www.sts.qc.ca\n"
    zip_path = tmp_path / "broken-agency.zip"
    _write_members_zip(zip_path, members)
    archive = _build_archive(zip_path)
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    with pytest.raises(ValueError, match="agency.txt is missing required columns"):
        load_static_zip_to_silver(
            RecordingConnection(),
            archive=archive,
            bronze_storage=bronze_storage,
            strict_gtfs=True,
        )


def test_tolerant_gtfs_downgrades_non_spine_member_to_conformance_warning(
    tmp_path: Path,
) -> None:
    members = _minimal_compliant_members()
    members["agency.txt"] = "agency_name,agency_url\nSTS,https://www.sts.qc.ca\n"
    zip_path = tmp_path / "tolerant-agency.zip"
    _write_members_zip(zip_path, members)
    archive = _build_archive(zip_path)
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        RecordingConnection(),
        archive=archive,
        bronze_storage=bronze_storage,
        strict_gtfs=False,
    )

    # The rest of the feed loads; the broken member is skipped and surfaced.
    assert result.row_counts["routes"] == 1
    assert "agency" not in result.row_counts  # skipped, recorded zero
    assert {
        "member": "agency.txt",
        "kind": "missing_required_column",
        "detail": "agency_timezone",
    } in result.conformance_warnings


def test_tolerant_gtfs_still_hard_fails_on_spine_member_missing_column(
    tmp_path: Path,
) -> None:
    members = _minimal_compliant_members()
    # routes.txt missing the spine route_type column -- always fatal.
    members["routes.txt"] = "route_id,route_short_name,route_long_name\n1,1,Centre-ville\n"
    zip_path = tmp_path / "broken-routes.zip"
    _write_members_zip(zip_path, members)
    archive = _build_archive(zip_path)
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    with pytest.raises(ValueError, match="routes.txt is missing required columns"):
        load_static_zip_to_silver(
            RecordingConnection(),
            archive=archive,
            bronze_storage=bronze_storage,
            strict_gtfs=False,
        )


def test_unknown_member_recorded_as_conformance_warning(tmp_path: Path) -> None:
    members = _minimal_compliant_members()
    members["pathways.txt"] = (
        "pathway_id,from_stop_id,to_stop_id,pathway_mode,is_bidirectional\n"
        "p1,stop-1,node-1,1,0\n"
    )
    zip_path = tmp_path / "extra-member.zip"
    _write_members_zip(zip_path, members)
    archive = _build_archive(zip_path)
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        RecordingConnection(),
        archive=archive,
        bronze_storage=bronze_storage,
    )

    assert "pathways.txt" in result.unsupported_members
    assert any(
        item["member"] == "pathways.txt" and item["kind"] == "unknown_member"
        for item in result.conformance_warnings
    )


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
    assert not any("INSERT INTO silver.shapes" in sql for sql in sql_calls)
    assert not any("INSERT INTO silver.translations" in sql for sql in sql_calls)
    assert [call["sql"].split(" (", 1)[0] for call in connection.copy_calls] == [
        'COPY "silver"."stops"',
        'COPY "silver"."trips"',
        'COPY "silver"."stop_times"',
        'COPY "silver"."shapes"',
        'COPY "silver"."translations"',
    ]

    route_params = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO silver.routes" in sql
    )
    assert route_params[0]["route_desc_detail"] == "Lignes de jour seulement"

    trip_rows = _copy_rows_for(connection, "trips")
    assert trip_rows[0][10] == "1_1071"


def test_static_bulk_copy_preserves_typed_values_nulls_and_source_text(
    tmp_path: Path,
) -> None:
    members = _minimal_compliant_members()
    members["trips.txt"] = (
        "route_id,service_id,trip_id,trip_headsign,direction_id,note_fr\n"
        "1,weekday,trip-1,Métro centre,1,Direction est\\ouest\n"
    )
    members["stops.txt"] = (
        "stop_id,stop_name,stop_desc,stop_lat,stop_lon,location_type\n"
        'stop-1,"Métro, Central","Ligne une\nLigne deux",45.5001,,0\n'
    )
    members["stop_times.txt"] = (
        "trip_id,arrival_time,departure_time,stop_id,stop_sequence,shape_dist_traveled\n"
        "trip-1,25:35:00,25:40:00,stop-1,12,123.5\n"
    )
    members["shapes.txt"] = (
        "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,route_pattern_id\nshape-1,45.5,,7,\n"
    )
    members["translations.txt"] = (
        "table_name,field_name,language,record_id,translation\n"
        'stops,stop_name,en,stop-1,"Metro, Central\nLine two \\ accessible"\n'
    )
    zip_path = tmp_path / "typed-copy.zip"
    _write_members_zip(zip_path, members)
    connection = RecordingConnection()

    result = load_static_zip_to_silver(
        connection,
        archive=_build_archive(zip_path),
        bronze_storage=LocalBronzeStorageForTests(zip_path.read_bytes()),
    )

    assert result.row_counts["stops"] == 1
    stop = _copy_rows_for(connection, "stops")[0]
    assert stop == (
        700,
        "stm",
        "stop-1",
        None,
        "Métro, Central",
        "Ligne une\nLigne deux",
        45.5001,
        None,
        None,
        None,
        0,
        None,
        None,
        None,
        None,
    )
    trip = _copy_rows_for(connection, "trips")[0]
    assert trip[5] == "Métro centre"
    assert trip[7] == 1
    assert trip[11] == "Direction est\\ouest"
    stop_time = _copy_rows_for(connection, "stop_times")[0]
    assert stop_time[3:7] == (12, "stop-1", "25:35:00", "25:40:00")
    assert stop_time[12] == 123.5
    assert _copy_rows_for(connection, "shapes")[0][3:] == (7, 45.5, None, None)
    assert _copy_rows_for(connection, "translations")[0] == (
        700,
        "stm",
        1,
        "stops",
        "stop_name",
        "en",
        "stop-1",
        "Metro, Central\nLine two \\ accessible",
    )


def test_load_static_zip_to_silver_records_all_txt_members_and_extra_rows(
    tmp_path: Path,
) -> None:
    zip_path = tmp_path / "beta-gtfs.zip"
    _write_beta_gtfs_zip(zip_path, include_notes=True)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
        require_beta_static_contract=True,
    )

    inventory_params = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO silver.gtfs_source_members" in sql
    )
    assert len(inventory_params) == 12
    inventory_by_file = {
        params["source_file_name"]: params
        for params in inventory_params
    }
    assert set(inventory_by_file) == {
        "agency.txt",
        "calendar_dates.txt",
        "directions.txt",
        "feed_info.txt",
        "notes.txt",
        "route_patterns.txt",
        "routes.txt",
        "shapes.txt",
        "stop_times.txt",
        "stops.txt",
        "translations.txt",
        "trips.txt",
    }
    assert inventory_by_file["notes.txt"]["member_path"] == "feed/notes.txt"
    assert inventory_by_file["notes.txt"]["row_count"] == 2
    assert inventory_by_file["notes.txt"]["byte_size"] > 0
    assert inventory_by_file["notes.txt"]["checksum_sha256"]
    assert inventory_by_file["notes.txt"]["manifest_json"]["columns"] == [
        "note_id",
        "note_fr",
        "note_en",
    ]
    assert inventory_by_file["notes.txt"]["first_seen_at_utc"] == result.loaded_at_utc
    assert inventory_by_file["notes.txt"]["last_seen_at_utc"] == result.loaded_at_utc

    extra_params = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO silver.gtfs_extra_rows" in sql
    )
    assert extra_params == [
        {
            "dataset_version_id": 700,
            "provider_id": "stm",
            "source_file_name": "notes.txt",
            "source_row_number": 1,
            "row_json": {
                "note_id": "n1",
                "note_fr": "Service modifie",
                "note_en": "Modified service",
            },
        },
        {
            "dataset_version_id": 700,
            "provider_id": "stm",
            "source_file_name": "notes.txt",
            "source_row_number": 2,
            "row_json": {
                "note_id": "n2",
                "note_fr": "Arret temporaire",
                "note_en": "Temporary stop",
            },
        },
    ]
    assert result.member_count == 12
    assert result.unsupported_members == ["notes.txt"]
    assert result.extra_row_counts == {"notes.txt": 2}
    assert result.typed_row_counts == result.row_counts


def test_static_abundance_jsonb_insert_statements_bind_json_payloads() -> None:
    assert isinstance(
        GTFS_SOURCE_MEMBER_INSERT._bindparams["manifest_json"].type,
        postgresql.JSONB,
    )
    assert isinstance(
        GTFS_EXTRA_ROW_INSERT._bindparams["row_json"].type,
        postgresql.JSONB,
    )


def test_static_silver_result_display_dict_exposes_inventory_counts(
    tmp_path: Path,
) -> None:
    zip_path = tmp_path / "beta-gtfs.zip"
    _write_beta_gtfs_zip(zip_path, include_notes=True)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    result = load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
        require_beta_static_contract=True,
    )

    payload = result.display_dict()

    assert payload["dataset_version_id"] == 700
    assert payload["member_count"] == 12
    assert payload["unsupported_members"] == ["notes.txt"]
    assert payload["typed_row_counts"] == result.row_counts
    assert payload["extra_row_counts"] == {"notes.txt": 2}
    assert payload["row_counts"] == result.row_counts


def test_load_static_zip_to_silver_preserves_sparse_trip_notes(tmp_path: Path) -> None:
    zip_path = tmp_path / "beta-gtfs.zip"
    _write_beta_gtfs_zip(zip_path, include_trip_notes=True)
    archive = _build_archive(zip_path)
    connection = RecordingConnection()
    bronze_storage = LocalBronzeStorageForTests(zip_path.read_bytes())

    load_static_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=bronze_storage,
        require_beta_static_contract=True,
    )

    trip_rows = _copy_rows_for(connection, "trips")
    assert trip_rows[0][11] == "Direction est"
    assert trip_rows[0][12] == "Eastbound"


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
    # The post-load ANALYZE batch runs in the same begin() connection after the
    # seed: one statement per bulk-seeded silver table, seed statements first.
    analyze_calls = [sql for sql, _ in engine.begin_connection.calls if sql.startswith("ANALYZE ")]
    assert analyze_calls == [
        f"ANALYZE {table}" for table in static_silver_module._POST_LOAD_ANALYZE_TABLES
    ]
    tail = [sql for sql, _ in engine.begin_connection.calls][-len(analyze_calls):]
    assert tail == analyze_calls, "the ANALYZE batch must be the final statements after the seed"


def test_load_latest_static_to_silver_accepts_live_current_static_without_beta_members(
    tmp_path: Path,
    monkeypatch,
) -> None:
    zip_path = tmp_path / "current-gtfs.zip"
    _write_gtfs_zip(zip_path, include_calendar=False, include_calendar_dates=True)
    fake_storage = FakeBronzeStorage(zip_path.read_bytes())
    lookup_row = {
        "provider_id": "stm",
        "storage_backend": "s3",
        "feed_endpoint_id": 1,
        "source_ingestion_run_id": 10,
        "source_ingestion_object_id": 20,
        "storage_path": "stm/static_schedule/ingested_at_utc=2026-05-25/current.zip",
        "source_url": "https://www.stm.info/sites/default/files/gtfs/gtfs_stm.zip",
        "checksum_sha256": "f" * 64,
        "byte_size": zip_path.stat().st_size,
        "source_completed_at_utc": datetime(2026, 5, 25, 0, 0, 0, tzinfo=UTC),
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

    assert result.row_counts["routes"] == 1
    assert result.row_counts["trips"] == 1
    assert result.row_counts["stop_times"] == 2
    assert "directions" not in result.row_counts
    assert "route_patterns" not in result.row_counts
    assert fake_storage.read_calls == [lookup_row["storage_path"]]


def test_load_latest_static_to_silver_does_not_prune_inside_the_load_transaction() -> None:
    """Pruning must not run inside the silver-load transaction.

    With STATIC_DATASET_RETENTION_COUNT=1 an in-load prune FK-fails against gold
    dims (which still reference the previous version) and rolls back the entire
    load on every content change — the prod wedge. Worker-cycle pruning
    (prune_silver_storage) owns all static cleanup now (slice-9.1.1j).
    """
    import inspect

    source = inspect.getsource(load_latest_static_to_silver)
    assert "prune_static_silver_datasets" not in source
