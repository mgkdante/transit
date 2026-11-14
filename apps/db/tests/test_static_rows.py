import subprocess
import sys
from io import BytesIO
from pathlib import Path
from zipfile import ZipFile

import pytest
from test_static_silver import (
    LocalBronzeStorageForTests,
    RecordingConnection,
    _build_archive,
    _minimal_compliant_members,
    _write_members_zip,
)

from transit_ops.silver import static_gtfs as loader
from transit_ops.silver.static_rows import (
    FREQUENCIES_MEMBER,
    RowRejection,
    iter_member_rows,
    required_members,
)


def _archive(members: dict[str, str]) -> ZipFile:
    buffer = BytesIO()
    with ZipFile(buffer, "w") as archive:
        for name, content in members.items():
            archive.writestr(name, content)
    return ZipFile(buffer)


@pytest.mark.parametrize(
    ("member", "content", "builder"),
    [
        ("routes.txt", "route_id,route_type\n R1 ,3\n", loader._build_route_record),
        (
            "stop_times.txt",
            "trip_id,stop_id,stop_sequence,arrival_time\n T1 , S1 ,1,25:00:00\n",
            loader._build_stop_time_record,
        ),
    ],
)
def test_rows_come_from_the_loaders_builders(member, content, builder) -> None:
    with _archive({f"nested/{member.upper()}": content}) as archive:
        normalized = next(
            loader._iter_gtfs_rows(
                archive,
                member_name=f"nested/{member.upper()}",
                required_columns=loader.REQUIRED_COLUMNS_BY_MEMBER[member],
            )
        )
        assert list(
            iter_member_rows(archive, member, provider_id="test", dataset_version_id=42)
        ) == [builder(normalized, provider_id="test", dataset_version_id=42)]


def test_rejection_keeps_its_row_and_reason_and_does_not_stop_the_member() -> None:
    with _archive(
        {"stop_times.txt": "trip_id,stop_id,stop_sequence\nT1,S1,1\nT1,S2,2\nT1,,3\nT1,S4,4\n"}
    ) as archive:
        rows = list(iter_member_rows(archive, "stop_times.txt", provider_id="test"))
    assert rows[2] == RowRejection(3, "stop_times.txt requires non-empty column 'stop_id'.")
    records = [row for row in rows if isinstance(row, dict)]
    assert [row["stop_sequence"] for row in records] == [1, 2, 4]
    assert all(row["dataset_version_id"] is None for row in records)


def test_missing_header_column_raises_the_loaders_error() -> None:
    with _archive({"routes.txt": "route_id\nR1\n"}) as archive:
        with pytest.raises(ValueError) as expected:
            list(
                loader._iter_gtfs_rows(
                    archive,
                    member_name="routes.txt",
                    required_columns=loader.REQUIRED_COLUMNS_BY_MEMBER["routes.txt"],
                )
            )
        with pytest.raises(ValueError) as actual:
            list(iter_member_rows(archive, "routes.txt", provider_id="test"))
    assert str(actual.value) == str(expected.value)


def test_absent_frequency_member_yields_nothing_and_other_unknowns_refuse() -> None:
    with _archive({}) as archive:
        assert list(iter_member_rows(archive, "frequencies.txt", provider_id="test")) == []
        with pytest.raises(ValueError, match="Unknown GTFS member 'unrelated.txt'"):
            list(iter_member_rows(archive, "unrelated.txt", provider_id="test"))


@pytest.mark.parametrize("strict", [True, False])
def test_required_members_raises_the_loaders_error(strict: bool) -> None:
    with _archive({}) as archive:
        with pytest.raises(ValueError) as expected:
            loader.validate_required_static_members({}, strict_gtfs=strict)
        with pytest.raises(ValueError) as actual:
            required_members(archive, strict_gtfs=strict)
    assert str(actual.value) == str(expected.value)
    members = dict.fromkeys(loader.REQUIRED_STATIC_MEMBERS, "")
    with _archive(members) as archive:
        required_members(archive, strict_gtfs=False)
        with pytest.raises(ValueError, match="At least one of calendar.txt"):
            required_members(archive)


def test_absent_member_yields_nothing_and_unknown_member_is_refused() -> None:
    with _archive({}) as archive:
        assert list(iter_member_rows(archive, "routes.txt", provider_id="test")) == []
        with pytest.raises(ValueError) as error:
            list(iter_member_rows(archive, "unknown.txt", provider_id="test"))
    assert "unknown.txt" in str(error.value)
    assert all(member in str(error.value) for member in loader.REQUIRED_COLUMNS_BY_MEMBER)


def test_agency_id_is_synthesized_from_the_provider_id_as_the_loader_does() -> None:
    row = {"agency_name": "Agency", "agency_url": "https://example.test", "agency_timezone": "UTC"}
    content = ",".join(row) + "\n" + ",".join(row.values()) + "\n"
    with _archive({"agency.txt": content}) as archive:
        records = list(
            iter_member_rows(archive, "agency.txt", provider_id="test", dataset_version_id=42)
        )
    assert records == [loader._build_agency_record(row, provider_id="test", dataset_version_id=42)]
    assert records[0]["agency_id"] == "test"


def test_frequency_rows_decode_nested_uppercase_bom_and_preserve_service_times() -> None:
    with _archive(
        {
            "nested/FREQUENCIES.TXT": "\ufefftrip_id,start_time,end_time,headway_secs,exact_times\n"
            " T1 , 25:00:00 , 26:30:00 , 600 , 1 \n"
        }
    ) as archive:
        assert list(
            iter_member_rows(archive, "frequencies.txt", provider_id="test", dataset_version_id=42)
        ) == [
            {
                "provider_id": "test",
                "dataset_version_id": 42,
                "trip_id": "T1",
                "start_time": "25:00:00",
                "end_time": "26:30:00",
                "headway_secs": 600,
                "exact_times": 1,
            }
        ]


@pytest.mark.parametrize("exact", [None, "", "0", "1"])
def test_frequency_exact_times_preserves_absence_and_explicit_values(exact) -> None:
    header = "trip_id,start_time,end_time,headway_secs"
    values = "T1,25:00:00,26:00:00,1"
    if exact is not None:
        header += ",exact_times"
        values += "," + exact
    with _archive({FREQUENCIES_MEMBER: header + "\n" + values + "\n"}) as archive:
        assert list(iter_member_rows(archive, FREQUENCIES_MEMBER, provider_id="test")) == [
            {
                "provider_id": "test",
                "dataset_version_id": None,
                "trip_id": "T1",
                "start_time": "25:00:00",
                "end_time": "26:00:00",
                "headway_secs": 1,
                "exact_times": None if exact in (None, "") else int(exact),
            }
        ]


@pytest.mark.parametrize(
    ("values", "reason"),
    [
        (",25:00:00,26:00:00,600,", "frequencies.txt requires non-empty column 'trip_id'."),
        ("T1,,26:00:00,600,", "frequencies.txt requires non-empty column 'start_time'."),
        ("T1,25:00:00,,600,", "frequencies.txt requires non-empty column 'end_time'."),
        ("T1,25:00:00,26:00:00,,", "frequencies.txt requires non-empty column 'headway_secs'."),
        ("T1,25:00:00,26:00:00,0,", "frequencies.headway_secs must be positive."),
        ("T1,25:00:00,26:00:00,-1,", "frequencies.headway_secs must be positive."),
        ("T1,25:00:00,26:00:00,1.5,", "invalid literal for int() with base 10: '1.5'"),
        ("T1,25:00:00,26:00:00,no,", "invalid literal for int() with base 10: 'no'"),
        ("T1,bad,26:00:00,600,", "frequencies.start_time must be in HH:MM:SS format."),
        ("T1,25:00:00,26:60:00,600,", "frequencies.end_time has an invalid HH:MM:SS value."),
        ("T1,26:00:00,25:00:00,600,", "frequencies.end_time must be after start_time."),
        ("T1,25:00:00,25:00:00,600,", "frequencies.end_time must be after start_time."),
        ("T1,25:00:00,26:00:00,600,2", "frequencies.exact_times must be 0 or 1."),
        ("T1,25:00:00,26:00:00,600,no", "frequencies.exact_times must be 0 or 1."),
        ("T1,25:00:00,26:00:00,600,0_0", "frequencies.exact_times must be 0 or 1."),
        ("T1,25:00:00,26:00:00,600,01", "frequencies.exact_times must be 0 or 1."),
        ("T1,25:00:00,26:00:00,600,+1", "frequencies.exact_times must be 0 or 1."),
        ("T1,25:00:00,26:00:00,600,-0", "frequencies.exact_times must be 0 or 1."),
    ],
)
def test_frequency_rejections_allow_the_next_row(values, reason) -> None:
    content = "trip_id,start_time,end_time,headway_secs,exact_times\n" + values
    content += "\nT2,27:00:00,28:00:00,300,0\n"
    with _archive({FREQUENCIES_MEMBER: content}) as archive:
        assert list(iter_member_rows(archive, FREQUENCIES_MEMBER, provider_id="test")) == [
            RowRejection(1, reason),
            {
                "provider_id": "test",
                "dataset_version_id": None,
                "trip_id": "T2",
                "start_time": "27:00:00",
                "end_time": "28:00:00",
                "headway_secs": 300,
                "exact_times": 0,
            },
        ]


@pytest.mark.parametrize("missing", ["trip_id", "start_time", "end_time", "headway_secs"])
def test_frequency_missing_header_uses_the_existing_member_error(missing) -> None:
    columns = [
        name for name in ("trip_id", "start_time", "end_time", "headway_secs") if name != missing
    ]
    with _archive({FREQUENCIES_MEMBER: ",".join(columns) + "\n"}) as archive:
        with pytest.raises(ValueError) as expected:
            list(
                loader._iter_gtfs_rows(
                    archive, member_name=FREQUENCIES_MEMBER, required_columns={missing}
                )
            )
        with pytest.raises(ValueError) as actual:
            list(iter_member_rows(archive, FREQUENCIES_MEMBER, provider_id="test"))
    assert str(actual.value) == str(expected.value)


def test_frequency_import_and_parse_preserve_public_loader_contracts() -> None:
    script = """
from copy import deepcopy
from io import BytesIO
from zipfile import ZipFile
from transit_ops.silver import static_gtfs as loader

columns = deepcopy(loader.REQUIRED_COLUMNS_BY_MEMBER)
supported = loader.SUPPORTED_STATIC_MEMBER_KEYS.copy()
from transit_ops.silver.static_rows import FREQUENCIES_MEMBER, iter_member_rows

buffer = BytesIO()
with ZipFile(buffer, "w") as archive:
    archive.writestr(FREQUENCIES_MEMBER,
        "trip_id,start_time,end_time,headway_secs\\nT1,25:00:00,26:00:00,600\\n")
with ZipFile(buffer) as archive:
    assert list(iter_member_rows(archive, FREQUENCIES_MEMBER, provider_id="test")) == [{
        "provider_id": "test", "dataset_version_id": None, "trip_id": "T1",
        "start_time": "25:00:00", "end_time": "26:00:00", "headway_secs": 600,
        "exact_times": None,
    }]
assert loader.REQUIRED_COLUMNS_BY_MEMBER == columns, "shared required columns changed"
assert loader.SUPPORTED_STATIC_MEMBER_KEYS == supported, "shared supported members changed"
"""
    result = subprocess.run([sys.executable, "-I", "-c", script], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_frequency_iterator_leaves_the_loader_on_its_unsupported_member_path(
    tmp_path: Path,
) -> None:
    members = _minimal_compliant_members()
    content = "trip_id,start_time,end_time,headway_secs\ntrip-1,25:00:00,26:00:00,600\n"
    members["nested/FREQUENCIES.TXT"] = content
    zip_path = tmp_path / "schedule.zip"
    _write_members_zip(zip_path, members)
    with ZipFile(zip_path) as archive:
        assert list(iter_member_rows(archive, "frequencies.txt", provider_id="test")) == [
            {
                "provider_id": "test",
                "dataset_version_id": None,
                "trip_id": "trip-1",
                "start_time": "25:00:00",
                "end_time": "26:00:00",
                "headway_secs": 600,
                "exact_times": None,
            }
        ]
    connection = RecordingConnection()
    result = loader.load_static_zip_to_silver(
        connection,
        archive=_build_archive(zip_path),
        bronze_storage=LocalBronzeStorageForTests(zip_path.read_bytes()),
    )
    assert result.unsupported_members == ["frequencies.txt"]
    assert result.extra_row_counts == {"frequencies.txt": 1}
    assert any(
        item["member"] == "frequencies.txt" and item["kind"] == "unknown_member"
        for item in result.conformance_warnings
    )
    inventory = next(
        params
        for sql, params in connection.calls
        if "INSERT INTO silver.gtfs_source_members" in sql
    )
    frequency = next(row for row in inventory if row["source_file_name"] == "frequencies.txt")
    assert frequency["member_path"] == "nested/FREQUENCIES.TXT"
    assert frequency["row_count"] == 1
    assert frequency["byte_size"] == len(content.encode())
    assert frequency["manifest_json"]["columns"] == [
        "trip_id",
        "start_time",
        "end_time",
        "headway_secs",
    ]
    extra = next(
        params for sql, params in connection.calls if "INSERT INTO silver.gtfs_extra_rows" in sql
    )
    assert extra == [
        {
            "dataset_version_id": 700,
            "provider_id": result.provider_id,
            "source_file_name": "frequencies.txt",
            "source_row_number": 1,
            "row_json": {
                "trip_id": "trip-1",
                "start_time": "25:00:00",
                "end_time": "26:00:00",
                "headway_secs": "600",
            },
        }
    ]
