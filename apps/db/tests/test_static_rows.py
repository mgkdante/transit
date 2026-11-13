from io import BytesIO
from zipfile import ZipFile

import pytest

from transit_ops.silver import static_gtfs as loader
from transit_ops.silver.static_rows import RowRejection, iter_member_rows, required_members


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
