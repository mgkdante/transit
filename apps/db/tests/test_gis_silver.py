from __future__ import annotations

import json
import struct
from datetime import UTC, datetime
from pathlib import Path
from zipfile import ZipFile

import pytest
import shapefile

from transit_ops.silver.gis import (
    PARSER_VERSION,
    BronzeGisArchive,
    find_latest_gis_bronze_archive,
    load_gis_zip_to_silver,
)

WGS84_PRJ = (
    'GEOGCS["WGS 84",DATUM["WGS_1984",SPHEROID["WGS 84",6378137,298.257223563]],'
    'PRIMEM["Greenwich",0],UNIT["degree",0.0174532925199433],'
    'AUTHORITY["EPSG","4326"]]'
)
STM_MTM_8_PRJ = (
    'PROJCS["NAD_1983_MTM_8",'
    'GEOGCS["GCS_North_American_1983",'
    'DATUM["D_North_American_1983",SPHEROID["GRS_1980",6378137.0,298.257222101]],'
    'PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],'
    'PROJECTION["Transverse_Mercator"],'
    'PARAMETER["False_Easting",304800.0],'
    'PARAMETER["False_Northing",0.0],'
    'PARAMETER["Central_Meridian",-73.5],'
    'PARAMETER["Scale_Factor",0.9999],'
    'PARAMETER["Latitude_Of_Origin",0.0],'
    'UNIT["Meter",1.0]]'
)


class FakeResult:
    def __init__(
        self,
        *,
        scalar_value: object | None = None,
        mapping_value: dict[str, object] | None = None,
        mapping_rows: list[dict[str, object]] | None = None,
    ) -> None:
        self.scalar_value = scalar_value
        self.mapping_value = mapping_value
        self.mapping_rows = mapping_rows or []

    def scalar_one_or_none(self) -> object | None:
        return self.scalar_value

    def mappings(self) -> FakeResult:
        return self

    def one_or_none(self) -> dict[str, object] | None:
        return self.mapping_value

    def __iter__(self):  # noqa: ANN201
        return iter(self.mapping_rows)


class RecordingConnection:
    def __init__(
        self,
        *,
        archive_row: dict[str, object] | None = None,
        loaded_gis_row: dict[str, object] | None = None,
        static_dataset_version_id: int | None = 700,
    ) -> None:
        self.archive_row = archive_row
        self.loaded_gis_row = loaded_gis_row
        self.static_dataset_version_id = static_dataset_version_id
        self.calls: list[tuple[str, object]] = []

    def execute(self, statement, params=None):  # noqa: ANN001
        sql_text = str(statement)
        self.calls.append((sql_text, params))
        if "FROM core.dataset_versions AS dv" in sql_text:
            return FakeResult(mapping_value=self.archive_row)
        if "FROM silver.gis_datasets" in sql_text:
            loaded = self.loaded_gis_row
            if loaded is not None and loaded["dataset_version_id"] != params["dataset_version_id"]:
                loaded = None
            return FakeResult(mapping_value=loaded)
        if "dataset_kind = 'static_schedule'" in sql_text:
            return FakeResult(scalar_value=self.static_dataset_version_id)
        if "FROM silver.stops" in sql_text:
            return FakeResult(
                mapping_rows=[
                    {"stop_id": "1001", "stop_code": "1001"},
                    {"stop_id": "1002", "stop_code": "A1002"},
                ]
            )
        if "FROM silver.routes" in sql_text:
            return FakeResult(mapping_rows=[{"route_id": "10"}])
        if "FROM silver.shapes" in sql_text:
            return FakeResult(mapping_rows=[{"shape_id": "shape-10"}])
        return FakeResult()


class FakeStorage:
    def __init__(self, payload: bytes) -> None:
        self.payload = payload
        self.exists_calls: list[str] = []
        self.read_calls: list[str] = []

    def exists(self, storage_path: str) -> bool:
        self.exists_calls.append(storage_path)
        return True

    def read_bytes(self, storage_path: str) -> bytes:
        self.read_calls.append(storage_path)
        return self.payload

    def describe_location(self, storage_path: str) -> str:
        return f"s3://bronze-bucket/{storage_path}"


def _wkb_geometry_type(wkb: bytes) -> int:
    assert wkb[0] == 1
    return struct.unpack("<I", wkb[1:5])[0]


def _insert_params(connection: RecordingConnection, sql_fragment: str) -> object:
    for sql_text, params in connection.calls:
        if sql_fragment in sql_text:
            return params
    raise AssertionError(f"No SQL call contained {sql_fragment!r}.")


def _zip_shapefile(base_path: Path, zip_path: Path) -> bytes:
    with ZipFile(zip_path, "w") as zip_file:
        for suffix in (".shp", ".shx", ".dbf", ".prj"):
            member_path = base_path.with_suffix(suffix)
            zip_file.write(member_path, arcname=f"{base_path.name}{suffix}")
    return zip_path.read_bytes()


def _write_stop_shapefile(base_path: Path) -> None:
    writer = shapefile.Writer(str(base_path), shapeType=shapefile.POINT)
    writer.field("stop_id", "C")
    writer.field("stop_code", "C")
    writer.field("stop_name", "C")
    writer.field("shelter", "C")
    writer.point(-73.567, 45.501)
    writer.record("1001", "1001", "Station A", "yes")
    writer.close()
    base_path.with_suffix(".prj").write_text(WGS84_PRJ, encoding="utf-8")


def _write_line_shapefile(base_path: Path, *, prj_text: str = WGS84_PRJ) -> None:
    writer = shapefile.Writer(str(base_path), shapeType=shapefile.POLYLINE)
    writer.field("route_id", "C")
    writer.field("route_name", "C")
    writer.field("shape_id", "C")
    writer.line([[[-73.56, 45.50], [-73.57, 45.51]]])
    writer.record("10", "Line 10", "shape-10")
    writer.close()
    base_path.with_suffix(".prj").write_text(prj_text, encoding="utf-8")


def _write_duplicate_route_line_shapefile(base_path: Path) -> None:
    writer = shapefile.Writer(str(base_path), shapeType=shapefile.POLYLINE)
    writer.field("route_id", "C")
    writer.field("route_name", "C")
    writer.line([[[-73.56, 45.50], [-73.57, 45.51]]])
    writer.record("10", "Line 10 east")
    writer.line([[[-73.58, 45.52], [-73.59, 45.53]]])
    writer.record("10", "Line 10 west")
    writer.close()
    base_path.with_suffix(".prj").write_text(WGS84_PRJ, encoding="utf-8")


def _build_mixed_gis_zip(tmp_path: Path) -> bytes:
    stop_base = tmp_path / "stops"
    line_base = tmp_path / "lines"
    _write_stop_shapefile(stop_base)
    _write_line_shapefile(line_base)
    zip_path = tmp_path / "stm_sig.zip"
    with ZipFile(zip_path, "w") as zip_file:
        for base_path in (stop_base, line_base):
            for suffix in (".shp", ".shx", ".dbf", ".prj"):
                member_path = base_path.with_suffix(suffix)
                zip_file.write(member_path, arcname=f"{base_path.name}{suffix}")
    return zip_path.read_bytes()


def _build_duplicate_route_line_zip(tmp_path: Path) -> bytes:
    line_base = tmp_path / "duplicate_lines"
    _write_duplicate_route_line_shapefile(line_base)
    return _zip_shapefile(line_base, tmp_path / "duplicate_lines.zip")


def _archive(byte_size: int) -> BronzeGisArchive:
    return BronzeGisArchive(
        provider_id="stm",
        dataset_version_id=88,
        feed_endpoint_id=4,
        source_ingestion_run_id=101,
        source_ingestion_object_id=202,
        storage_backend="s3",
        storage_path="stm/gis_static/stm_sig.zip",
        archive_full_path="s3://bronze-bucket/stm/gis_static/stm_sig.zip",
        source_url="https://example.com/stm_sig.zip",
        checksum_sha256="a" * 64,
        byte_size=byte_size,
        source_completed_at_utc=datetime(2026, 5, 25, 11, 2, tzinfo=UTC),
    )


def _loaded_gis_row(
    *,
    gis_dataset_version_id: int = 88,
    static_dataset_version_id: object = 700,
    parser_version: str = PARSER_VERSION,
    match_count: int = 2,
    include_pair_receipt: bool = True,
) -> dict[str, object]:
    manifest: dict[str, object] = {
        "archive_full_path": "s3://bronze-bucket/stm/gis_static/stm_sig.zip",
        "shapefile_count": 2,
        "stop_feature_count": 1,
        "line_feature_count": 1,
        "match_count": match_count,
    }
    if include_pair_receipt:
        manifest["static_dataset_version_id"] = static_dataset_version_id
    return {
        "dataset_version_id": gis_dataset_version_id,
        "parser_version": parser_version,
        "manifest_json": manifest,
    }


def _gis_mutations(connection: RecordingConnection) -> list[str]:
    return [
        sql
        for sql, _ in connection.calls
        if "DELETE FROM silver.gis_" in sql or "INSERT INTO silver.gis_" in sql
    ]


def test_load_gis_zip_to_silver_skips_completed_pair_before_payload_read() -> None:
    archive = _archive(123)
    connection = RecordingConnection(loaded_gis_row=_loaded_gis_row())
    storage = FakeStorage(b"not-a-zip")

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
        static_dataset_version_id=700,
    )

    assert storage.exists_calls == [archive.storage_path]
    assert storage.read_calls == []
    assert _gis_mutations(connection) == []
    assert result.row_counts == {
        "gis_datasets": 1,
        "gis_stop_features": 1,
        "gis_line_features": 1,
        "gis_gtfs_matches": 2,
    }
    assert result.load_performed is False
    assert result.skipped_reason == "gis_static_pair_unchanged"


def test_load_gis_zip_to_silver_reloads_same_gis_for_changed_static_version(
    tmp_path: Path,
) -> None:
    payload = _build_mixed_gis_zip(tmp_path)
    archive = _archive(len(payload))
    connection = RecordingConnection(
        loaded_gis_row=_loaded_gis_row(static_dataset_version_id=699),
    )
    storage = FakeStorage(payload)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
        static_dataset_version_id=700,
    )

    assert result.load_performed is True
    assert storage.read_calls == [archive.storage_path]
    assert _gis_mutations(connection)
    manifest = _insert_params(connection, "INSERT INTO silver.gis_datasets")["manifest_json"]
    assert manifest["static_dataset_version_id"] == 700
    assert manifest["match_count"] == 2


def test_load_gis_zip_to_silver_reloads_changed_gis_dataset(tmp_path: Path) -> None:
    payload = _build_mixed_gis_zip(tmp_path)
    archive = _archive(len(payload))
    connection = RecordingConnection(
        loaded_gis_row=_loaded_gis_row(gis_dataset_version_id=87),
    )
    storage = FakeStorage(payload)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
        static_dataset_version_id=700,
    )

    assert result.load_performed is True
    assert storage.read_calls == [archive.storage_path]
    assert _gis_mutations(connection)


@pytest.mark.parametrize(
    "loaded_gis_row",
    [
        pytest.param(
            _loaded_gis_row(include_pair_receipt=False),
            id="legacy-receipt",
        ),
        pytest.param(
            _loaded_gis_row(parser_version="transit_ops.silver.gis.v0"),
            id="parser-version-changed",
        ),
    ],
)
def test_load_gis_zip_to_silver_reloads_invalid_receipt(
    tmp_path: Path,
    loaded_gis_row: dict[str, object],
) -> None:
    payload = _build_mixed_gis_zip(tmp_path)
    archive = _archive(len(payload))
    connection = RecordingConnection(loaded_gis_row=loaded_gis_row)
    storage = FakeStorage(payload)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
        static_dataset_version_id=700,
    )

    assert result.load_performed is True
    assert storage.read_calls == [archive.storage_path]
    assert _gis_mutations(connection)


@pytest.mark.parametrize(
    ("receipt_static_dataset_version_id", "resolved_static_dataset_version_id"),
    [
        pytest.param(700.0, 700, id="float-does-not-match-int"),
        pytest.param(True, 1, id="bool-does-not-match-int"),
    ],
)
def test_load_gis_zip_to_silver_reloads_non_integer_static_receipt(
    tmp_path: Path,
    receipt_static_dataset_version_id: object,
    resolved_static_dataset_version_id: int,
) -> None:
    payload = _build_mixed_gis_zip(tmp_path)
    archive = _archive(len(payload))
    connection = RecordingConnection(
        loaded_gis_row=_loaded_gis_row(
            static_dataset_version_id=receipt_static_dataset_version_id,
        ),
    )
    storage = FakeStorage(payload)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
        static_dataset_version_id=resolved_static_dataset_version_id,
    )

    assert result.load_performed is True
    assert storage.read_calls == [archive.storage_path]
    assert _gis_mutations(connection)


def test_load_gis_zip_to_silver_skips_completed_pair_with_zero_matches() -> None:
    archive = _archive(123)
    connection = RecordingConnection(
        loaded_gis_row=_loaded_gis_row(match_count=0),
    )
    storage = FakeStorage(b"not-a-zip")

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
        static_dataset_version_id=700,
    )

    assert storage.read_calls == []
    assert result.match_count == 0
    assert result.row_counts["gis_gtfs_matches"] == 0
    assert result.load_performed is False


def test_load_gis_zip_to_silver_treats_no_static_dataset_as_explicit_pair(
    tmp_path: Path,
) -> None:
    archive = _archive(123)
    no_static_receipt = _loaded_gis_row(static_dataset_version_id=None, match_count=0)
    unchanged_connection = RecordingConnection(
        loaded_gis_row=no_static_receipt,
        static_dataset_version_id=None,
    )
    unchanged_storage = FakeStorage(b"not-a-zip")

    skipped = load_gis_zip_to_silver(
        unchanged_connection,
        archive=archive,
        bronze_storage=unchanged_storage,
    )

    assert skipped.static_dataset_version_id is None
    assert skipped.load_performed is False
    assert unchanged_storage.read_calls == []

    payload = _build_mixed_gis_zip(tmp_path)
    changed_connection = RecordingConnection(
        loaded_gis_row=no_static_receipt,
        static_dataset_version_id=700,
    )
    changed_storage = FakeStorage(payload)

    reloaded = load_gis_zip_to_silver(
        changed_connection,
        archive=_archive(len(payload)),
        bronze_storage=changed_storage,
    )

    assert reloaded.static_dataset_version_id == 700
    assert reloaded.load_performed is True
    assert changed_storage.read_calls == [archive.storage_path]


def test_load_gis_zip_to_silver_stages_stops_lines_wkb_crs_and_matches(
    tmp_path: Path,
) -> None:
    payload = _build_mixed_gis_zip(tmp_path)
    archive = _archive(len(payload))
    connection = RecordingConnection(static_dataset_version_id=700)
    storage = FakeStorage(payload)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=storage,
    )

    assert result.dataset_version_id == 88
    assert result.static_dataset_version_id == 700
    assert result.load_performed is True
    assert result.skipped_reason is None
    assert result.row_counts == {
        "gis_datasets": 1,
        "gis_stop_features": 1,
        "gis_line_features": 1,
        "gis_gtfs_matches": 2,
    }
    assert storage.read_calls == [archive.storage_path]

    dataset_params = _insert_params(connection, "INSERT INTO silver.gis_datasets")
    assert dataset_params["dataset_version_id"] == 88
    assert dataset_params["source_crs_epsg"] == 4326
    assert dataset_params["manifest_json"]["shapefile_count"] == 2
    assert dataset_params["manifest_json"]["static_dataset_version_id"] == 700
    assert dataset_params["manifest_json"]["match_count"] == 2

    stop_rows = _insert_params(connection, "INSERT INTO silver.gis_stop_features")
    assert len(stop_rows) == 1
    assert stop_rows[0]["stop_id"] == "1001"
    assert stop_rows[0]["stop_code"] == "1001"
    assert stop_rows[0]["source_geometry_type"] == "Point"
    assert _wkb_geometry_type(stop_rows[0]["source_geometry_wkb"]) == 1
    assert stop_rows[0]["source_attributes_json"]["shelter"] == "yes"
    assert stop_rows[0]["source_crs_epsg"] == 4326

    line_rows = _insert_params(connection, "INSERT INTO silver.gis_line_features")
    assert len(line_rows) == 1
    assert line_rows[0]["route_id"] == "10"
    assert line_rows[0]["shape_id"] == "shape-10"
    assert line_rows[0]["source_geometry_type"] == "LineString"
    assert _wkb_geometry_type(line_rows[0]["source_geometry_wkb"]) == 2

    match_rows = _insert_params(connection, "INSERT INTO silver.gis_gtfs_matches")
    assert {
        (row["feature_kind"], row["source_feature_id"], row["gtfs_id"], row["match_key"])
        for row in match_rows
    } == {
        ("stop", "1001", "1001", "stop_id"),
        ("line", "shape-10", "shape-10", "shape_id"),
    }
    json.dumps(result.display_dict())


def test_load_gis_zip_to_silver_infers_stm_mtm8_epsg_from_prj_without_authority(
    tmp_path: Path,
) -> None:
    line_base = tmp_path / "stm_lignes_sig"
    _write_line_shapefile(line_base, prj_text=STM_MTM_8_PRJ)
    payload = _zip_shapefile(line_base, tmp_path / "stm_sig.zip")
    archive = _archive(len(payload))
    connection = RecordingConnection(static_dataset_version_id=700)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=FakeStorage(payload),
    )

    assert result.row_counts["gis_line_features"] == 1
    dataset_params = _insert_params(connection, "INSERT INTO silver.gis_datasets")
    assert dataset_params["source_crs_name"] == "NAD_1983_MTM_8"
    assert dataset_params["source_crs_epsg"] == 32188

    line_rows = _insert_params(connection, "INSERT INTO silver.gis_line_features")
    assert line_rows[0]["source_crs_name"] == "NAD_1983_MTM_8"
    assert line_rows[0]["source_crs_epsg"] == 32188
    assert line_rows[0]["source_crs_wkt"] == STM_MTM_8_PRJ


def test_load_gis_zip_to_silver_makes_duplicate_business_keys_unique(
    tmp_path: Path,
) -> None:
    payload = _build_duplicate_route_line_zip(tmp_path)
    archive = _archive(len(payload))
    connection = RecordingConnection(static_dataset_version_id=700)

    result = load_gis_zip_to_silver(
        connection,
        archive=archive,
        bronze_storage=FakeStorage(payload),
    )

    line_rows = _insert_params(connection, "INSERT INTO silver.gis_line_features")
    source_feature_ids = [row["source_feature_id"] for row in line_rows]
    assert len(source_feature_ids) == 2
    assert len(set(source_feature_ids)) == 2
    assert result.row_counts["gis_line_features"] == 2

    match_rows = _insert_params(connection, "INSERT INTO silver.gis_gtfs_matches")
    assert len(match_rows) == 2
    assert {row["match_key"] for row in match_rows} == {"route_id"}
    assert {row["gtfs_id"] for row in match_rows} == {"10"}
    assert len({row["source_feature_id"] for row in match_rows}) == 2


def test_load_gis_zip_to_silver_rejects_zip_without_shapefiles(tmp_path: Path) -> None:
    zip_path = tmp_path / "empty.zip"
    with ZipFile(zip_path, "w") as zip_file:
        zip_file.writestr("README.txt", "not a shapefile")
    archive = _archive(zip_path.stat().st_size)

    with pytest.raises(ValueError, match="No shapefile"):
        load_gis_zip_to_silver(
            RecordingConnection(),
            archive=archive,
            bronze_storage=FakeStorage(zip_path.read_bytes()),
        )


def test_find_latest_gis_bronze_archive_uses_current_gis_dataset_version() -> None:
    archive_row = {
        "provider_id": "stm",
        "dataset_version_id": 88,
        "feed_endpoint_id": 4,
        "source_ingestion_run_id": 101,
        "source_ingestion_object_id": 202,
        "storage_backend": "s3",
        "storage_path": "stm/gis_static/stm_sig.zip",
        "source_url": "https://example.com/stm_sig.zip",
        "checksum_sha256": "b" * 64,
        "byte_size": 123,
        "source_completed_at_utc": datetime(2026, 5, 25, 11, 2, tzinfo=UTC),
    }
    connection = RecordingConnection(archive_row=archive_row)

    archive = find_latest_gis_bronze_archive(
        connection,
        provider_id="stm",
        endpoint_key="gis_static",
        bronze_storage=FakeStorage(b""),
    )

    assert archive.dataset_version_id == 88
    assert archive.archive_full_path == "s3://bronze-bucket/stm/gis_static/stm_sig.zip"
    assert any("dataset_kind = 'gis_static'" in sql for sql, _ in connection.calls)
