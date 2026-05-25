from __future__ import annotations

import re
import struct
from collections.abc import Iterable, Iterator, Mapping
from dataclasses import asdict, dataclass, replace
from io import BytesIO
from itertools import islice
from pathlib import Path
from zipfile import ZipFile

import shapefile
from sqlalchemy import bindparam, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.engine import Connection, Engine

from transit_ops.db.connection import make_engine
from transit_ops.ingestion.common import project_root
from transit_ops.ingestion.gis import build_gis_ingestion_config
from transit_ops.ingestion.storage import get_bronze_storage
from transit_ops.providers import ProviderRegistry
from transit_ops.settings import Settings, get_settings

CHUNK_SIZE = 5_000
PARSER_VERSION = "transit_ops.silver.gis.v1"
POINT_SHAPE_TYPES = {
    shapefile.POINT,
    shapefile.POINTM,
    shapefile.POINTZ,
}
LINE_SHAPE_TYPES = {
    shapefile.POLYLINE,
    shapefile.POLYLINEM,
    shapefile.POLYLINEZ,
}

GIS_DATASET_INSERT = text(
    """
    INSERT INTO silver.gis_datasets (
        dataset_version_id,
        provider_id,
        source_url,
        storage_backend,
        storage_path,
        checksum_sha256,
        byte_size,
        source_crs_name,
        source_crs_epsg,
        source_crs_wkt,
        parser_version,
        manifest_json
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :source_url,
        :storage_backend,
        :storage_path,
        :checksum_sha256,
        :byte_size,
        :source_crs_name,
        :source_crs_epsg,
        :source_crs_wkt,
        :parser_version,
        :manifest_json
    )
    """
).bindparams(bindparam("manifest_json", type_=postgresql.JSONB))

GIS_STOP_FEATURE_INSERT = text(
    """
    INSERT INTO silver.gis_stop_features (
        dataset_version_id,
        provider_id,
        source_feature_id,
        stop_code,
        stop_id,
        stop_name,
        stop_url,
        wheelchair,
        route_id,
        loc_type,
        shelter,
        service_id,
        source_attributes_json,
        source_geometry_wkb,
        source_geometry_type,
        source_crs_name,
        source_crs_epsg,
        source_crs_wkt
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :source_feature_id,
        :stop_code,
        :stop_id,
        :stop_name,
        :stop_url,
        :wheelchair,
        :route_id,
        :loc_type,
        :shelter,
        :service_id,
        :source_attributes_json,
        :source_geometry_wkb,
        :source_geometry_type,
        :source_crs_name,
        :source_crs_epsg,
        :source_crs_wkt
    )
    """
).bindparams(bindparam("source_attributes_json", type_=postgresql.JSONB))

GIS_LINE_FEATURE_INSERT = text(
    """
    INSERT INTO silver.gis_line_features (
        dataset_version_id,
        provider_id,
        source_feature_id,
        route_id,
        route_name,
        headsign,
        shape_id,
        ct,
        service_id,
        source_attributes_json,
        source_geometry_wkb,
        source_geometry_type,
        source_crs_name,
        source_crs_epsg,
        source_crs_wkt
    )
    VALUES (
        :dataset_version_id,
        :provider_id,
        :source_feature_id,
        :route_id,
        :route_name,
        :headsign,
        :shape_id,
        :ct,
        :service_id,
        :source_attributes_json,
        :source_geometry_wkb,
        :source_geometry_type,
        :source_crs_name,
        :source_crs_epsg,
        :source_crs_wkt
    )
    """
).bindparams(bindparam("source_attributes_json", type_=postgresql.JSONB))

GIS_GTFS_MATCH_INSERT = text(
    """
    INSERT INTO silver.gis_gtfs_matches (
        gis_dataset_version_id,
        static_dataset_version_id,
        provider_id,
        feature_kind,
        source_feature_id,
        gtfs_id,
        match_key,
        match_status,
        match_notes
    )
    VALUES (
        :gis_dataset_version_id,
        :static_dataset_version_id,
        :provider_id,
        :feature_kind,
        :source_feature_id,
        :gtfs_id,
        :match_key,
        :match_status,
        :match_notes
    )
    """
)


@dataclass(frozen=True)
class BronzeGisArchive:
    provider_id: str
    dataset_version_id: int
    feed_endpoint_id: int
    source_ingestion_run_id: int | None
    source_ingestion_object_id: int | None
    storage_backend: str
    storage_path: str
    archive_full_path: str
    source_url: str | None
    checksum_sha256: str
    byte_size: int | None
    source_completed_at_utc: object | None


@dataclass(frozen=True)
class GisSilverLoadResult:
    provider_id: str
    dataset_version_id: int
    static_dataset_version_id: int | None
    source_ingestion_run_id: int | None
    source_ingestion_object_id: int | None
    storage_path: str
    archive_full_path: str
    content_hash: str
    row_counts: dict[str, int]
    shapefile_count: int
    stop_feature_count: int
    line_feature_count: int
    match_count: int

    def display_dict(self) -> dict[str, object]:
        return asdict(self)


@dataclass(frozen=True)
class _CrsInfo:
    name: str | None
    epsg: int | None
    wkt: str | None


@dataclass(frozen=True)
class _ParsedFeature:
    layer_name: str
    source_feature_id: str
    attributes: dict[str, object | None]
    geometry_wkb: bytes
    geometry_type: str
    crs: _CrsInfo


@dataclass(frozen=True)
class _ParsedGisZip:
    shapefile_count: int
    stop_features: list[_ParsedFeature]
    line_features: list[_ParsedFeature]
    crs: _CrsInfo


def _project_root() -> Path:
    return project_root()


def _blank_to_none(value: object | None) -> str | None:
    if value is None:
        return None
    text_value = str(value).strip()
    return text_value or None


def _json_value(value: object) -> object | None:
    if value is None:
        return None
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if hasattr(value, "isoformat"):
        return value.isoformat()
    return value


def _normalize_attr_name(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", name.lower())


def _attr(
    attributes: Mapping[str, object | None],
    *candidates: str,
) -> str | None:
    normalized = {_normalize_attr_name(key): value for key, value in attributes.items()}
    for candidate in candidates:
        value = normalized.get(_normalize_attr_name(candidate))
        if value is not None:
            return _blank_to_none(value)
    return None


def _first_present(
    attributes: Mapping[str, object | None],
    *candidates: str,
) -> str | None:
    return _attr(attributes, *candidates)


def _stop_id(attributes: Mapping[str, object | None]) -> str | None:
    return _first_present(
        attributes,
        "stop_id",
        "stopid",
        "id_stop",
        "idarret",
        "arret_id",
        "id_arret",
        "code",
    )


def _stop_code(attributes: Mapping[str, object | None]) -> str | None:
    return _first_present(attributes, "stop_code", "stopcode", "code", "no_arret", "stop_no")


def _route_id(attributes: Mapping[str, object | None]) -> str | None:
    return _first_present(attributes, "route_id", "routeid", "ligne", "line", "route", "route_no")


def _shape_id(attributes: Mapping[str, object | None]) -> str | None:
    return _first_present(attributes, "shape_id", "shapeid", "route_pattern_id", "pattern_id")


def _pack_wkb_point(x: float, y: float) -> bytes:
    return b"\x01" + struct.pack("<I", 1) + struct.pack("<dd", x, y)


def _pack_wkb_linestring(points: list[tuple[float, float]]) -> bytes:
    payload = b"\x01" + struct.pack("<I", 2) + struct.pack("<I", len(points))
    return payload + b"".join(struct.pack("<dd", x, y) for x, y in points)


def _pack_wkb_multilinestring(parts: list[list[tuple[float, float]]]) -> bytes:
    payload = b"\x01" + struct.pack("<I", 5) + struct.pack("<I", len(parts))
    return payload + b"".join(_pack_wkb_linestring(part) for part in parts)


def _shape_to_wkb(shape) -> tuple[bytes, str] | None:  # noqa: ANN001
    points = [(float(point[0]), float(point[1])) for point in shape.points]
    if shape.shapeType in POINT_SHAPE_TYPES:
        if not points:
            return None
        return _pack_wkb_point(*points[0]), "Point"
    if shape.shapeType in LINE_SHAPE_TYPES:
        if len(points) < 2:
            return None
        part_starts = list(shape.parts) or [0]
        part_bounds = [*part_starts, len(points)]
        parts = [
            points[start:end]
            for start, end in zip(part_bounds, part_bounds[1:], strict=False)
            if len(points[start:end]) >= 2
        ]
        if not parts:
            return None
        if len(parts) == 1:
            return _pack_wkb_linestring(parts[0]), "LineString"
        return _pack_wkb_multilinestring(parts), "MultiLineString"
    return None


def _parse_crs(prj_text: str | None) -> _CrsInfo:
    if not prj_text:
        return _CrsInfo(name=None, epsg=None, wkt=None)
    epsg_match = re.search(r'AUTHORITY\["EPSG"\s*,\s*"(\d+)"\]', prj_text, re.IGNORECASE)
    if epsg_match is None:
        epsg_match = re.search(r"EPSG[:\", ]+(\d+)", prj_text, re.IGNORECASE)
    name_match = re.search(r'(?:PROJCS|GEOGCS)\["([^"]+)"', prj_text, re.IGNORECASE)
    name = name_match.group(1) if name_match else None
    epsg = int(epsg_match.group(1)) if epsg_match else _infer_epsg_from_prj(prj_text, name)
    return _CrsInfo(
        name=name,
        epsg=epsg,
        wkt=prj_text,
    )


def _infer_epsg_from_prj(prj_text: str, name: str | None) -> int | None:
    normalized_name = re.sub(r"[^a-z0-9]+", "", (name or "").lower())
    if normalized_name != "nad1983mtm8":
        return None
    if "D_North_American_1983" not in prj_text and "North_American_Datum_1983" not in prj_text:
        return None
    parameter_expectations = {
        "False_Easting": 304800.0,
        "False_Northing": 0.0,
        "Central_Meridian": -73.5,
        "Scale_Factor": 0.9999,
        "Latitude_Of_Origin": 0.0,
    }
    for parameter_name, expected_value in parameter_expectations.items():
        actual_value = _prj_parameter_float(prj_text, parameter_name)
        if actual_value is None or abs(actual_value - expected_value) > 0.000001:
            return None
    return 32188


def _prj_parameter_float(prj_text: str, parameter_name: str) -> float | None:
    match = re.search(
        rf'PARAMETER\["{re.escape(parameter_name)}"\s*,\s*(-?\d+(?:\.\d+)?)\]',
        prj_text,
        re.IGNORECASE,
    )
    return float(match.group(1)) if match else None


def _shapefile_member_groups(zip_file: ZipFile) -> dict[str, dict[str, str]]:
    groups: dict[str, dict[str, str]] = {}
    for info in zip_file.infolist():
        if info.is_dir():
            continue
        path = Path(info.filename)
        suffix = path.suffix.lower()
        if suffix not in {".shp", ".shx", ".dbf", ".prj"}:
            continue
        base_name = str(path.with_suffix(""))
        groups.setdefault(base_name, {})[suffix] = info.filename
    return groups


def _read_crs(zip_file: ZipFile, members: Mapping[str, str]) -> _CrsInfo:
    prj_member = members.get(".prj")
    if prj_member is None:
        return _parse_crs(None)
    return _parse_crs(zip_file.read(prj_member).decode("utf-8", errors="replace"))


def _record_attributes(field_names: list[str], record) -> dict[str, object | None]:  # noqa: ANN001
    return {
        field_name: _json_value(value)
        for field_name, value in zip(field_names, list(record), strict=False)
    }


def _source_feature_id(
    *,
    layer_name: str,
    feature_index: int,
    attributes: Mapping[str, object | None],
    geometry_type: str,
) -> str:
    if geometry_type == "Point":
        candidate = _stop_id(attributes) or _stop_code(attributes)
    else:
        candidate = _shape_id(attributes) or _route_id(attributes)
    return candidate or f"{layer_name}:{feature_index}"


def _dedupe_source_feature_ids(features: list[_ParsedFeature]) -> list[_ParsedFeature]:
    used: set[str] = set()
    occurrences: dict[str, int] = {}
    deduped: list[_ParsedFeature] = []
    for feature in features:
        base_id = feature.source_feature_id
        occurrence = occurrences.get(base_id, 0)
        candidate = base_id if occurrence == 0 else f"{base_id}:{occurrence}"
        while candidate in used:
            occurrence += 1
            candidate = f"{base_id}:{occurrence}"
        occurrences[base_id] = occurrence + 1
        used.add(candidate)
        deduped.append(
            feature
            if candidate == feature.source_feature_id
            else replace(feature, source_feature_id=candidate)
        )
    return deduped


def _iter_shape_features(
    zip_file: ZipFile,
    *,
    base_name: str,
    members: Mapping[str, str],
) -> Iterator[_ParsedFeature]:
    if ".shp" not in members or ".dbf" not in members:
        return
    reader_kwargs = {
        "shp": BytesIO(zip_file.read(members[".shp"])),
        "dbf": BytesIO(zip_file.read(members[".dbf"])),
    }
    if ".shx" in members:
        reader_kwargs["shx"] = BytesIO(zip_file.read(members[".shx"]))
    reader = shapefile.Reader(**reader_kwargs)
    field_names = [field[0] for field in reader.fields[1:]]
    crs = _read_crs(zip_file, members)
    layer_name = Path(base_name).name

    for feature_index, shape_record in enumerate(reader.iterShapeRecords()):
        geometry = _shape_to_wkb(shape_record.shape)
        if geometry is None:
            continue
        geometry_wkb, geometry_type = geometry
        attributes = _record_attributes(field_names, shape_record.record)
        yield _ParsedFeature(
            layer_name=layer_name,
            source_feature_id=_source_feature_id(
                layer_name=layer_name,
                feature_index=feature_index,
                attributes=attributes,
                geometry_type=geometry_type,
            ),
            attributes=attributes,
            geometry_wkb=geometry_wkb,
            geometry_type=geometry_type,
            crs=crs,
        )


def _parse_gis_zip(payload: bytes) -> _ParsedGisZip:
    stop_features: list[_ParsedFeature] = []
    line_features: list[_ParsedFeature] = []
    crs_values: list[_CrsInfo] = []

    with ZipFile(BytesIO(payload)) as zip_file:
        member_groups = _shapefile_member_groups(zip_file)
        if not member_groups:
            raise ValueError("No shapefile members were found in the GIS ZIP.")
        for base_name, members in sorted(member_groups.items()):
            crs_values.append(_read_crs(zip_file, members))
            for feature in _iter_shape_features(zip_file, base_name=base_name, members=members):
                if feature.geometry_type == "Point":
                    stop_features.append(feature)
                elif feature.geometry_type in {"LineString", "MultiLineString"}:
                    line_features.append(feature)

    if not stop_features and not line_features:
        raise ValueError("No supported point or line shapefile features were found in the GIS ZIP.")

    dataset_crs = next(
        (crs for crs in crs_values if crs.name or crs.epsg or crs.wkt),
        _CrsInfo(name=None, epsg=None, wkt=None),
    )
    return _ParsedGisZip(
        shapefile_count=len(member_groups),
        stop_features=_dedupe_source_feature_ids(stop_features),
        line_features=_dedupe_source_feature_ids(line_features),
        crs=dataset_crs,
    )


def _chunked(
    rows: Iterable[dict[str, object]],
    chunk_size: int,
) -> Iterator[list[dict[str, object]]]:
    iterator = iter(rows)
    while chunk := list(islice(iterator, chunk_size)):
        yield chunk


def _execute_batched_insert(
    connection: Connection,
    *,
    statement,
    rows: Iterable[dict[str, object]],
) -> int:
    row_count = 0
    for chunk in _chunked(rows, CHUNK_SIZE):
        connection.execute(statement, chunk)
        row_count += len(chunk)
    return row_count


def _delete_existing_gis_rows(connection: Connection, *, dataset_version_id: int) -> None:
    for statement in (
        "DELETE FROM silver.gis_gtfs_matches WHERE gis_dataset_version_id = :dataset_version_id",
        "DELETE FROM silver.gis_line_features WHERE dataset_version_id = :dataset_version_id",
        "DELETE FROM silver.gis_stop_features WHERE dataset_version_id = :dataset_version_id",
        "DELETE FROM silver.gis_datasets WHERE dataset_version_id = :dataset_version_id",
    ):
        connection.execute(text(statement), {"dataset_version_id": dataset_version_id})


def _insert_gis_dataset(
    connection: Connection,
    *,
    archive: BronzeGisArchive,
    parsed: _ParsedGisZip,
) -> None:
    connection.execute(
        GIS_DATASET_INSERT,
        {
            "dataset_version_id": archive.dataset_version_id,
            "provider_id": archive.provider_id,
            "source_url": archive.source_url,
            "storage_backend": archive.storage_backend,
            "storage_path": archive.storage_path,
            "checksum_sha256": archive.checksum_sha256,
            "byte_size": archive.byte_size,
            "source_crs_name": parsed.crs.name,
            "source_crs_epsg": parsed.crs.epsg,
            "source_crs_wkt": parsed.crs.wkt,
            "parser_version": PARSER_VERSION,
            "manifest_json": {
                "archive_full_path": archive.archive_full_path,
                "shapefile_count": parsed.shapefile_count,
                "stop_feature_count": len(parsed.stop_features),
                "line_feature_count": len(parsed.line_features),
            },
        },
    )


def _stop_feature_row(
    *,
    archive: BronzeGisArchive,
    feature: _ParsedFeature,
) -> dict[str, object]:
    attributes = feature.attributes
    return {
        "dataset_version_id": archive.dataset_version_id,
        "provider_id": archive.provider_id,
        "source_feature_id": feature.source_feature_id,
        "stop_code": _stop_code(attributes),
        "stop_id": _stop_id(attributes),
        "stop_name": _attr(attributes, "stop_name", "stopname", "nom", "name"),
        "stop_url": _attr(attributes, "stop_url", "stopurl", "url"),
        "wheelchair": _attr(attributes, "wheelchair", "wheelchair_boarding", "accessible"),
        "route_id": _route_id(attributes),
        "loc_type": _attr(attributes, "loc_type", "location_type", "type"),
        "shelter": _attr(attributes, "shelter", "abribus", "shelter_type"),
        "service_id": _attr(attributes, "service_id", "serviceid"),
        "source_attributes_json": attributes,
        "source_geometry_wkb": feature.geometry_wkb,
        "source_geometry_type": feature.geometry_type,
        "source_crs_name": feature.crs.name,
        "source_crs_epsg": feature.crs.epsg,
        "source_crs_wkt": feature.crs.wkt,
    }


def _line_feature_row(
    *,
    archive: BronzeGisArchive,
    feature: _ParsedFeature,
) -> dict[str, object]:
    attributes = feature.attributes
    return {
        "dataset_version_id": archive.dataset_version_id,
        "provider_id": archive.provider_id,
        "source_feature_id": feature.source_feature_id,
        "route_id": _route_id(attributes),
        "route_name": _attr(attributes, "route_name", "routename", "nom", "name"),
        "headsign": _attr(attributes, "headsign", "destination", "direction"),
        "shape_id": _shape_id(attributes),
        "ct": _attr(attributes, "ct"),
        "service_id": _attr(attributes, "service_id", "serviceid"),
        "source_attributes_json": attributes,
        "source_geometry_wkb": feature.geometry_wkb,
        "source_geometry_type": feature.geometry_type,
        "source_crs_name": feature.crs.name,
        "source_crs_epsg": feature.crs.epsg,
        "source_crs_wkt": feature.crs.wkt,
    }


def _current_static_dataset_version_id(
    connection: Connection,
    *,
    provider_id: str,
) -> int | None:
    value = connection.execute(
        text(
            """
            SELECT dataset_version_id
            FROM core.dataset_versions
            WHERE provider_id = :provider_id
              AND dataset_kind = 'static_schedule'
              AND is_current = true
            ORDER BY loaded_at_utc DESC
            LIMIT 1
            """
        ),
        {"provider_id": provider_id},
    ).scalar_one_or_none()
    return int(value) if value is not None else None


def _gtfs_stop_maps(
    connection: Connection,
    *,
    provider_id: str,
    static_dataset_version_id: int,
) -> tuple[set[str], dict[str, str]]:
    rows = connection.execute(
        text(
            """
            SELECT stop_id, stop_code
            FROM silver.stops
            WHERE provider_id = :provider_id
              AND dataset_version_id = :static_dataset_version_id
            """
        ),
        {
            "provider_id": provider_id,
            "static_dataset_version_id": static_dataset_version_id,
        },
    ).mappings()
    stop_ids: set[str] = set()
    stop_codes: dict[str, str] = {}
    for row in rows:
        stop_id = _blank_to_none(row["stop_id"])
        stop_code = _blank_to_none(row["stop_code"])
        if stop_id is not None:
            stop_ids.add(stop_id)
        if stop_id is not None and stop_code is not None:
            stop_codes[stop_code] = stop_id
    return stop_ids, stop_codes


def _gtfs_route_ids(
    connection: Connection,
    *,
    provider_id: str,
    static_dataset_version_id: int,
) -> set[str]:
    rows = connection.execute(
        text(
            """
            SELECT route_id
            FROM silver.routes
            WHERE provider_id = :provider_id
              AND dataset_version_id = :static_dataset_version_id
            """
        ),
        {
            "provider_id": provider_id,
            "static_dataset_version_id": static_dataset_version_id,
        },
    ).mappings()
    return {route_id for row in rows if (route_id := _blank_to_none(row["route_id"]))}


def _gtfs_shape_ids(
    connection: Connection,
    *,
    provider_id: str,
    static_dataset_version_id: int,
) -> set[str]:
    rows = connection.execute(
        text(
            """
            SELECT DISTINCT shape_id
            FROM silver.shapes
            WHERE provider_id = :provider_id
              AND dataset_version_id = :static_dataset_version_id
              AND shape_id IS NOT NULL
            """
        ),
        {
            "provider_id": provider_id,
            "static_dataset_version_id": static_dataset_version_id,
        },
    ).mappings()
    return {shape_id for row in rows if (shape_id := _blank_to_none(row["shape_id"]))}


def _build_match_rows(
    connection: Connection,
    *,
    provider_id: str,
    gis_dataset_version_id: int,
    static_dataset_version_id: int | None,
    stop_rows: list[dict[str, object]],
    line_rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    if static_dataset_version_id is None:
        return []

    stop_ids, stop_codes = _gtfs_stop_maps(
        connection,
        provider_id=provider_id,
        static_dataset_version_id=static_dataset_version_id,
    )
    route_ids = _gtfs_route_ids(
        connection,
        provider_id=provider_id,
        static_dataset_version_id=static_dataset_version_id,
    )
    shape_ids = _gtfs_shape_ids(
        connection,
        provider_id=provider_id,
        static_dataset_version_id=static_dataset_version_id,
    )

    rows: list[dict[str, object]] = []
    for stop_row in stop_rows:
        stop_id = _blank_to_none(stop_row["stop_id"])
        stop_code = _blank_to_none(stop_row["stop_code"])
        if stop_id in stop_ids:
            gtfs_id = stop_id
            match_key = "stop_id"
        elif stop_code in stop_codes:
            gtfs_id = stop_codes[stop_code]
            match_key = "stop_code"
        else:
            continue
        rows.append(
            {
                "gis_dataset_version_id": gis_dataset_version_id,
                "static_dataset_version_id": static_dataset_version_id,
                "provider_id": provider_id,
                "feature_kind": "stop",
                "source_feature_id": stop_row["source_feature_id"],
                "gtfs_id": gtfs_id,
                "match_key": match_key,
                "match_status": "matched",
                "match_notes": None,
            }
        )

    for line_row in line_rows:
        shape_id = _blank_to_none(line_row["shape_id"])
        route_id = _blank_to_none(line_row["route_id"])
        if shape_id in shape_ids:
            gtfs_id = shape_id
            match_key = "shape_id"
        elif route_id in route_ids:
            gtfs_id = route_id
            match_key = "route_id"
        else:
            continue
        rows.append(
            {
                "gis_dataset_version_id": gis_dataset_version_id,
                "static_dataset_version_id": static_dataset_version_id,
                "provider_id": provider_id,
                "feature_kind": "line",
                "source_feature_id": line_row["source_feature_id"],
                "gtfs_id": gtfs_id,
                "match_key": match_key,
                "match_status": "matched",
                "match_notes": None,
            }
        )
    return rows


def find_latest_gis_bronze_archive(
    connection: Connection,
    *,
    provider_id: str,
    endpoint_key: str,
    bronze_storage,
) -> BronzeGisArchive:
    archive_row = (
        connection.execute(
            text(
                """
                SELECT
                    dv.provider_id,
                    dv.dataset_version_id,
                    dv.feed_endpoint_id,
                    dv.source_ingestion_run_id,
                    dv.source_ingestion_object_id,
                    dv.storage_backend,
                    dv.storage_path,
                    dv.source_url,
                    dv.checksum_sha256,
                    dv.byte_size,
                    dv.loaded_at_utc AS source_completed_at_utc
                FROM core.dataset_versions AS dv
                INNER JOIN core.feed_endpoints AS fe
                    ON fe.feed_endpoint_id = dv.feed_endpoint_id
                WHERE dv.provider_id = :provider_id
                  AND fe.endpoint_key = :endpoint_key
                  AND dv.dataset_kind = 'gis_static'
                  AND dv.is_current = true
                ORDER BY dv.loaded_at_utc DESC, dv.dataset_version_id DESC
                LIMIT 1
                """
            ),
            {"provider_id": provider_id, "endpoint_key": endpoint_key},
        )
        .mappings()
        .one_or_none()
    )
    if archive_row is None:
        raise ValueError(
            "No current Bronze GIS dataset version was found for this provider. "
            "Run ingest-gis before load-gis-silver."
        )
    storage_path = _blank_to_none(archive_row["storage_path"])
    if storage_path is None:
        raise ValueError("Current GIS dataset version has no Bronze storage_path.")
    return BronzeGisArchive(
        provider_id=str(archive_row["provider_id"]),
        dataset_version_id=int(archive_row["dataset_version_id"]),
        feed_endpoint_id=int(archive_row["feed_endpoint_id"]),
        source_ingestion_run_id=int(archive_row["source_ingestion_run_id"])
        if archive_row["source_ingestion_run_id"] is not None
        else None,
        source_ingestion_object_id=int(archive_row["source_ingestion_object_id"])
        if archive_row["source_ingestion_object_id"] is not None
        else None,
        storage_backend=str(archive_row["storage_backend"]),
        storage_path=storage_path,
        archive_full_path=bronze_storage.describe_location(storage_path),
        source_url=str(archive_row["source_url"]) if archive_row["source_url"] else None,
        checksum_sha256=str(archive_row["checksum_sha256"]),
        byte_size=int(archive_row["byte_size"]) if archive_row["byte_size"] is not None else None,
        source_completed_at_utc=archive_row["source_completed_at_utc"],
    )


def load_gis_zip_to_silver(
    connection: Connection,
    *,
    archive: BronzeGisArchive,
    bronze_storage,
    static_dataset_version_id: int | None = None,
) -> GisSilverLoadResult:
    if not bronze_storage.exists(archive.storage_path):
        archive_location = bronze_storage.describe_location(archive.storage_path)
        raise FileNotFoundError(f"Bronze GIS archive file not found: {archive_location}")

    parsed = _parse_gis_zip(bronze_storage.read_bytes(archive.storage_path))
    static_dataset_version_id = static_dataset_version_id or _current_static_dataset_version_id(
        connection,
        provider_id=archive.provider_id,
    )

    stop_rows = [
        _stop_feature_row(archive=archive, feature=feature)
        for feature in parsed.stop_features
    ]
    line_rows = [
        _line_feature_row(archive=archive, feature=feature)
        for feature in parsed.line_features
    ]
    match_rows = _build_match_rows(
        connection,
        provider_id=archive.provider_id,
        gis_dataset_version_id=archive.dataset_version_id,
        static_dataset_version_id=static_dataset_version_id,
        stop_rows=stop_rows,
        line_rows=line_rows,
    )

    _delete_existing_gis_rows(connection, dataset_version_id=archive.dataset_version_id)
    _insert_gis_dataset(connection, archive=archive, parsed=parsed)
    stop_count = _execute_batched_insert(
        connection,
        statement=GIS_STOP_FEATURE_INSERT,
        rows=stop_rows,
    )
    line_count = _execute_batched_insert(
        connection,
        statement=GIS_LINE_FEATURE_INSERT,
        rows=line_rows,
    )
    match_count = _execute_batched_insert(
        connection,
        statement=GIS_GTFS_MATCH_INSERT,
        rows=match_rows,
    )
    row_counts = {
        "gis_datasets": 1,
        "gis_stop_features": stop_count,
        "gis_line_features": line_count,
        "gis_gtfs_matches": match_count,
    }
    return GisSilverLoadResult(
        provider_id=archive.provider_id,
        dataset_version_id=archive.dataset_version_id,
        static_dataset_version_id=static_dataset_version_id,
        source_ingestion_run_id=archive.source_ingestion_run_id,
        source_ingestion_object_id=archive.source_ingestion_object_id,
        storage_path=archive.storage_path,
        archive_full_path=archive.archive_full_path,
        content_hash=archive.checksum_sha256,
        row_counts=row_counts,
        shapefile_count=parsed.shapefile_count,
        stop_feature_count=stop_count,
        line_feature_count=line_count,
        match_count=match_count,
    )


def load_latest_gis_to_silver(
    provider_id: str,
    *,
    settings: Settings | None = None,
    registry: ProviderRegistry | None = None,
    engine: Engine | None = None,
) -> GisSilverLoadResult:
    settings = settings or get_settings()
    registry = registry or ProviderRegistry.from_project_root(
        project_root=_project_root(),
        settings=settings,
    )
    manifest = registry.get_provider(provider_id)
    config = build_gis_ingestion_config(manifest, settings)
    engine = engine or make_engine(settings)

    with engine.connect() as connection:
        bronze_storage = get_bronze_storage(
            settings,
            project_root=_project_root(),
            storage_backend=config.storage_backend,
        )
        archive = find_latest_gis_bronze_archive(
            connection,
            provider_id=manifest.provider.provider_id,
            endpoint_key=config.endpoint_key,
            bronze_storage=bronze_storage,
        )

    with engine.begin() as connection:
        return load_gis_zip_to_silver(
            connection,
            archive=archive,
            bronze_storage=bronze_storage,
        )
