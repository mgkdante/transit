from __future__ import annotations

import hashlib
import subprocess
import sys
from datetime import UTC, datetime
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

import pytest
import real_db_seed as db_seed
from sqlalchemy import text

from transit_ops.silver.static_gtfs import BronzeStaticArchive, load_static_zip_to_silver
from transit_ops.silver.static_rows import RowRejection, iter_member_rows

PROVIDER = "static_rows_parity"
BASE = 997_340_000

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


def _archive(*, provider_id: str, base: int, payload: bytes) -> BronzeStaticArchive:
    return BronzeStaticArchive(
        provider_id=provider_id,
        storage_backend="local",
        feed_endpoint_id=base + 1,
        source_ingestion_run_id=base + 2,
        source_ingestion_object_id=base + 3,
        storage_path=f"{provider_id}/static_schedule/test.zip",
        archive_full_path=f"{provider_id}/static_schedule/test.zip",
        source_url="https://example.test/static.zip",
        checksum_sha256=hashlib.sha256(payload).hexdigest(),
        byte_size=None,
        source_completed_at_utc=datetime(2026, 7, 21, tzinfo=UTC),
    )


def _seed_lineage(connection, *, provider_id: str, base: int, seed_provider) -> None:  # noqa: ANN001
    seed_provider(
        connection,
        provider_id,
        display_name="Static rows parity test",
        timezone="UTC",
    )
    db_seed.feed_endpoints(
        connection,
        {"endpoint_id": base + 1, "provider_id": provider_id},
        feed_endpoint_id=":endpoint_id",
        provider_id=":provider_id",
        endpoint_key="'static'",
        feed_kind="'static_schedule'",
        source_format="'gtfs_schedule_zip'",
    )
    db_seed.ingestion_runs(
        connection,
        {"run_id": base + 2, "provider_id": provider_id, "endpoint_id": base + 1},
        ingestion_run_id=":run_id",
        provider_id=":provider_id",
        feed_endpoint_id=":endpoint_id",
        run_kind="'static_schedule'",
    )
    db_seed.ingestion_objects(
        connection,
        {
            "object_id": base + 3,
            "run_id": base + 2,
            "provider_id": provider_id,
            "storage_path": f"{provider_id}/static_schedule/test.zip",
            "checksum": "a" * 64,
        },
        ingestion_object_id=":object_id",
        ingestion_run_id=":run_id",
        provider_id=":provider_id",
        object_kind="'gtfs_schedule_zip'",
        storage_backend="'local'",
        storage_path=":storage_path",
        checksum_sha256=":checksum",
    )


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


def _members() -> dict[str, str]:
    templates = {
        "agency.txt": "agency_id,agency_name,agency_url,agency_timezone\nA{i},Agency,https://example.test,UTC\n",
        "feed_info.txt": "feed_publisher_name,feed_publisher_url,feed_lang\nPublisher{i},https://example.test,en\n",
        "routes.txt": "route_id,route_type\nR{i},3\n",
        "stops.txt": "stop_id,stop_name\nS{i},Stop {i}\n",
        "trips.txt": "route_id,service_id,trip_id\nR{i},WK{i},T{i}\n",
        "stop_times.txt": (
            "trip_id,stop_id,stop_sequence,arrival_time,departure_time\n"
            "T{i},S{i},1,25:00:00,25:00:00\n"
        ),
        "calendar.txt": (
            "service_id,monday,tuesday,wednesday,thursday,friday,saturday,sunday,"
            "start_date,end_date\nWK{i},1,1,1,1,1,0,0,20260101,20261231\n"
        ),
        "calendar_dates.txt": "service_id,date,exception_type\nWK{i},20260701,1\n",
        "directions.txt": (
            "route_direction_id,route_id,direction_id,direction,direction_legacy\n"
            "D{i},R{i},0,Outbound,Outbound\n"
        ),
        "route_patterns.txt": (
            "route_pattern_id,route_id,direction_id,route_pattern_typicality\nP{i},R{i},0,1\n"
        ),
        "shapes.txt": "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence\nSH{i},45.5,-73.5,1\n",
        "translations.txt": (
            "table_name,field_name,language,record_id,translation\n"
            "stops,stop_name,fr,S{i},Arret {i}\n"
        ),
    }
    return {
        member: header
        + "\n"
        + "".join(row.format(i=i) for i in ((1,) if member == "feed_info.txt" else (1, 2)))
        for member, content in templates.items()
        for header, row in [content.split("\n", 1)]
    }


def _door_rows(payload: bytes) -> dict[str, list[dict[str, object] | RowRejection]]:
    with ZipFile(BytesIO(payload)) as archive:
        return {
            member.removesuffix(".txt"): list(
                iter_member_rows(archive, member, provider_id=PROVIDER)
            )
            for member in archive.namelist()
        }


def _load(connection, payload: bytes):
    return load_static_zip_to_silver(
        connection,
        archive=_archive(provider_id=PROVIDER, base=BASE, payload=payload),
        bronze_storage=MemoryBronzeStorage(payload),
    )


def test_door_and_loader_agree_on_rows_and_rejections(real_db_engine, seed_provider) -> None:
    _cleanup(real_db_engine, PROVIDER)
    try:
        with real_db_engine.connect() as connection, connection.begin():
            _seed_lineage(connection, provider_id=PROVIDER, base=BASE, seed_provider=seed_provider)
            payload = _zip_bytes(_members())
            result = _load(connection, payload)
            rows = _door_rows(payload)
            assert all(
                not isinstance(row, RowRejection) for values in rows.values() for row in values
            )
            assert result.row_counts == {key: len(values) for key, values in rows.items()}
            members = _members()
            members["stop_times.txt"] = members["stop_times.txt"].replace("T2,S2,", "T2,,")
            broken = _zip_bytes(members)
            with pytest.raises(ValueError) as error, connection.begin_nested():
                _load(connection, broken)
            rejected = {
                key: [row for row in values if isinstance(row, RowRejection)]
                for key, values in _door_rows(broken).items()
            }
            assert rejected.pop("stop_times") == [RowRejection(2, str(error.value))]
            assert all(not values for values in rejected.values())
            connection.rollback()
    finally:
        _cleanup(real_db_engine, PROVIDER)


def test_loader_file_is_not_changed_by_the_door(real_db_engine, seed_provider) -> None:
    subprocess.run(
        [
            sys.executable,
            "-c",
            "import sys; import transit_ops.silver.static_gtfs; "
            "assert 'transit_ops.silver.static_rows' not in sys.modules",
        ],
        check=True,
    )
    _cleanup(real_db_engine, PROVIDER)
    try:
        with real_db_engine.connect() as connection, connection.begin():
            _seed_lineage(connection, provider_id=PROVIDER, base=BASE, seed_provider=seed_provider)
            payload = _zip_bytes(_members())
            with connection.begin_nested() as before:
                counts = _load(connection, payload).row_counts
                before.rollback()
            _door_rows(payload)
            assert _load(connection, payload).row_counts == counts
            connection.rollback()
    finally:
        _cleanup(real_db_engine, PROVIDER)
