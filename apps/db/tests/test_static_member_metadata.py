"""Completed typed reads preserve raw provenance without rereading each member."""

import hashlib
from collections import Counter
from io import BytesIO
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZIP_STORED, ZipFile

import pytest
from sqlalchemy import text
from test_static_pipeline_recovery_real_db import subject as subject
from test_static_silver import (
    FakeBronzeStorage,
    RecordingConnection,
    _build_archive,
    _minimal_compliant_members,
    _write_members_zip,
)

from transit_ops.silver.static_gtfs import (
    _iter_gtfs_rows,
    load_latest_static_to_silver,
    load_static_zip_to_silver,
)


def _metadata(connection):
    return {
        row["source_file_name"]: row
        for sql, rows in connection.calls
        if "INSERT INTO silver.gtfs_source_members" in sql
        for row in rows
    }


@pytest.mark.parametrize("compression", [ZIP_STORED, ZIP_DEFLATED])
def test_completed_reads_preserve_raw_bom_newlines_and_unknown_member_provenance(
    tmp_path, monkeypatch, compression
):
    members = {name: value.encode() for name, value in _minimal_compliant_members().items()}
    members["stops.txt"] = (
        "\ufeffstop_id,stop_name,stop_lat,stop_lon,location_type\r\n\r\n"
        'stop-1,"Terminus, façade\r\nquai",45.4,-71.9,0\r\n\r\n'
        "node-1,,45.401,-71.901,3\r\n\r\n"
    ).encode()
    members["feed/notes.txt"] = '\ufeffnote_id,note\r\nn1,"Détour,\r\nquai"\r\nn2,Fin\r\n'.encode()
    path = tmp_path / "raw-members.zip"
    with ZipFile(path, "w", compression=compression) as archive:
        for name, value in members.items():
            archive.writestr(name, value)
    opens = Counter()
    open_member = ZipFile.open

    def counted_open(archive, member, *args, **kwargs):
        opens[member] += 1
        return open_member(archive, member, *args, **kwargs)

    monkeypatch.setattr(ZipFile, "open", counted_open)
    connection = RecordingConnection()
    result = load_static_zip_to_silver(
        connection,
        archive=_build_archive(path),
        bronze_storage=FakeBronzeStorage(path.read_bytes()),
    )
    metadata = _metadata(connection)
    for member_path, raw in members.items():
        row = metadata[Path(member_path).name]
        assert row["checksum_sha256"] == hashlib.sha256(raw).hexdigest()
        assert row["byte_size"] == len(raw)
        assert row["member_path"] == member_path
    assert metadata["stops.txt"]["row_count"] == 2
    assert metadata["stops.txt"]["manifest_json"]["columns"] == [
        "stop_id",
        "stop_name",
        "stop_lat",
        "stop_lon",
        "location_type",
    ]
    assert metadata["notes.txt"]["row_count"] == 2
    assert metadata["notes.txt"]["manifest_json"]["columns"] == ["note_id", "note"]
    assert result.extra_row_counts == {"notes.txt": 2}
    assert opens["stops.txt"] <= 2  # Header and typed pass; inventory reuses completed facts.
    assert opens["feed/notes.txt"] <= 3


@pytest.mark.parametrize("header_only", [False, True])
def test_skipped_or_empty_optional_member_keeps_its_raw_metadata(tmp_path, header_only):
    members = _minimal_compliant_members()
    members["feed_info.txt"] = (
        "feed_publisher_name,feed_publisher_url,feed_lang\n"
        if header_only
        else "publisher\nlegacy\n"
    )
    path = tmp_path / "optional.zip"
    _write_members_zip(path, members)
    connection = RecordingConnection()
    result = load_static_zip_to_silver(
        connection,
        archive=_build_archive(path),
        bronze_storage=FakeBronzeStorage(path.read_bytes()),
        strict_gtfs=False,
    )
    row = _metadata(connection)["feed_info.txt"]
    assert row["row_count"] == (0 if header_only else 1)
    assert row["checksum_sha256"] == hashlib.sha256(members["feed_info.txt"].encode()).hexdigest()
    assert "feed_info" not in result.row_counts
    assert bool(result.conformance_warnings) is not header_only


@pytest.mark.parametrize("failed", [False, True])
def test_interrupted_iteration_does_not_record_a_complete_member(tmp_path, failed):
    raw = b"stop_id\r\nS1\r\nS2\r\n"
    path = tmp_path / "interrupted.zip"
    with ZipFile(path, "w") as archive:
        archive.writestr("stops.txt", raw)
    metadata = {}
    with ZipFile(path) as archive:
        rows = _iter_gtfs_rows(
            archive, member_name="stops.txt", required_columns={"stop_id"}, member_metadata=metadata
        )
        assert next(rows) == {"stop_id": "S1"}
        if failed:
            with pytest.raises(RuntimeError, match="consumer failed"):
                rows.throw(RuntimeError("consumer failed"))
        else:
            rows.close()
        assert metadata == {}
        assert list(
            _iter_gtfs_rows(
                archive,
                member_name="stops.txt",
                required_columns={"stop_id"},
                member_metadata=metadata,
            )
        ) == [{"stop_id": "S1"}, {"stop_id": "S2"}]
    assert metadata["stops.txt"].row_count == 2
    assert metadata["stops.txt"].checksum_sha256 == hashlib.sha256(raw).hexdigest()


def test_member_provenance_and_multiline_copy_values_roundtrip_on_postgres(subject):
    with ZipFile(BytesIO(subject.payload)) as original:
        members = {name: original.read(name) for name in original.namelist()}
    members["stops.txt"] = (
        '\ufeffstop_id,stop_name,stop_lat,stop_lon\r\nS,"Station, façade\r\nquai",45.5,-73.5\r\n'
    ).encode()
    members["notes.txt"] = '\ufeffnote_id,note\r\nn1,"Détour,\r\nquai"\r\nn2,Fin\r\n'.encode()
    payload = BytesIO()
    with ZipFile(payload, "w", compression=ZIP_DEFLATED) as archive:
        for name, raw in members.items():
            archive.writestr(name, raw)
    subject.payload = payload.getvalue()
    try:
        subject.ingest()
        result = load_latest_static_to_silver(
            subject.provider_id,
            settings=subject.settings,
            registry=subject.registry,
            engine=subject.engine,
        )
        with subject.engine.connect() as connection:
            metadata = {
                row["source_file_name"]: row
                for row in connection.execute(
                    text("SELECT * FROM silver.gtfs_source_members WHERE provider_id=:p"),
                    {"p": subject.provider_id},
                ).mappings()
            }
            for name, raw in members.items():
                assert metadata[name]["checksum_sha256"] == hashlib.sha256(raw).hexdigest()
                assert metadata[name]["byte_size"] == len(raw)
            assert metadata["stops.txt"]["row_count"] == 1
            assert metadata["notes.txt"]["row_count"] == 2
            assert (
                connection.execute(
                    text("SELECT stop_name FROM silver.stops WHERE provider_id=:p"),
                    {"p": subject.provider_id},
                ).scalar_one()
                == "Station, façade\r\nquai"
            )
        assert result.extra_row_counts == {"notes.txt": 2}
    finally:
        with subject.engine.begin() as connection:
            connection.execute(
                text("DELETE FROM silver.gtfs_extra_rows WHERE provider_id=:p"),
                {"p": subject.provider_id},
            )
