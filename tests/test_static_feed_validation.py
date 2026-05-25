from __future__ import annotations

import csv
import hashlib
from pathlib import Path
from zipfile import ZipFile

import pytest

import transit_ops.validation.static_feeds as static_feed_validation
from transit_ops.ingestion.common import DownloadedArtifact
from transit_ops.validation.static_feeds import validate_static_feeds


class FakeFeed:
    def __init__(self, source_url: str | None) -> None:
        self.source_url = source_url

    def resolved_source_url(self, settings=None) -> str | None:  # noqa: ANN001
        return self.source_url


class FakeProvider:
    def __init__(self, feeds: dict[str, FakeFeed]) -> None:
        self.feeds = feeds


class FakeRegistry:
    def __init__(self, provider: FakeProvider) -> None:
        self.provider = provider

    def get_provider(self, provider_id: str) -> FakeProvider:
        assert provider_id == "stm"
        return self.provider


def _write_gtfs_zip(
    path: Path, *, include_stop_times: bool = True, route_id: str = "1"
) -> None:
    members = {
        "routes.txt": f"route_id,route_type\n{route_id},1\n",
        "trips.txt": f"route_id,service_id,trip_id\n{route_id},wk,t1\n",
        "stops.txt": "stop_id,stop_name\ns1,Station 1\n",
        "calendar_dates.txt": "service_id,date,exception_type\nwk,20260524,1\n",
    }
    if include_stop_times:
        members["stop_times.txt"] = "trip_id,stop_id,stop_sequence\nt1,s1,1\n"

    with ZipFile(path, "w") as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)


def _write_beta_contract_gtfs_zip(path: Path) -> None:
    members = {
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
            "route_id,route_type,route_desc,route_desc_detail\n"
            "1,1,Metro,\n"
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
            "1,wk,t1,Station Honore-Beaugrand,0,1_1071,1,1_1071\n"
        ),
        "shapes.txt": (
            "shape_id,shape_pt_lat,shape_pt_lon,shape_pt_sequence,route_pattern_id\n"
            "1_1071,45.446466,-73.603118,10001,1_1071\n"
        ),
        "stops.txt": "stop_id,stop_name\ns1,Station 1\n",
        "stop_times.txt": "trip_id,stop_id,stop_sequence\nt1,s1,1\n",
        "calendar_dates.txt": "service_id,date,exception_type\nwk,20260524,1\n",
        "translations.txt": "table_name,field_name,language,record_id,translation\n",
    }

    with ZipFile(path, "w") as zip_file:
        for member_name, content in members.items():
            zip_file.writestr(member_name, content)


def _artifact(path: Path, source_url: str) -> DownloadedArtifact:
    return DownloadedArtifact(
        temp_path=path,
        byte_size=path.stat().st_size,
        checksum_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        http_status_code=200,
        source_url=source_url,
    )


def test_validate_static_feeds_reports_active_static_schedule_ok(
    tmp_path: Path,
) -> None:
    active_static_zip = tmp_path / "static.zip"
    _write_gtfs_zip(active_static_zip, route_id="2")
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        assert temp_dir.exists()
        assert source_url == "https://example.test/static.zip"
        return _artifact(active_static_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["provider_id"] == "stm"
    assert "current" not in display
    assert "comparison" not in display
    assert "static_schedule_current_fallback" not in str(display)
    assert "beta" not in display
    assert display["active_static"]["label"] == "active_static"
    assert display["active_static"]["status"] == "ok"
    assert display["active_static"]["endpoint_key"] == "static_schedule"
    assert display["active_static"]["row_counts"]["routes.txt"] == 1
    assert display["active_static"]["row_counts"]["stop_times.txt"] == 1
    assert display["active_static"]["required_members_present"] == [
        "routes.txt",
        "stop_times.txt",
        "stops.txt",
        "trips.txt",
    ]
    assert display["active_static"]["optional_service_members_present"] == [
        "calendar_dates.txt"
    ]


def test_validate_static_feeds_reports_beta_schema_contract_inventory(
    tmp_path: Path,
) -> None:
    future_contract_zip = tmp_path / "future-contract.zip"
    _write_beta_contract_gtfs_zip(future_contract_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        assert source_url == "https://example.test/static.zip"
        return _artifact(future_contract_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["schema_comparison"]["decision_signal"] == "schema_and_source_semantics"
    assert display["schema_comparison"]["row_count_signal"] == "diagnostic_only"
    assert display["schema_comparison"]["members_available"] == [
        "agency.txt",
        "calendar_dates.txt",
        "directions.txt",
        "feed_info.txt",
        "route_patterns.txt",
        "routes.txt",
        "shapes.txt",
        "stop_times.txt",
        "stops.txt",
        "translations.txt",
        "trips.txt",
    ]
    assert display["schema_comparison"]["headers_by_member"]["routes.txt"] == [
        "route_id",
        "route_type",
        "route_desc",
        "route_desc_detail",
    ]
    assert display["schema_comparison"]["headers_by_member"]["trips.txt"] == [
        "route_id",
        "service_id",
        "trip_id",
        "trip_headsign",
        "direction_id",
        "shape_id",
        "wheelchair_accessible",
        "route_pattern_id",
    ]
    assert display["schema_comparison"]["future_contract_members_present"] == [
        "directions.txt",
        "feed_info.txt",
        "route_patterns.txt",
        "routes.txt",
        "shapes.txt",
        "trips.txt",
    ]
    assert display["active_static"]["feed_info_rows"] == [
        {
            "feed_publisher_name": "STM",
            "feed_publisher_url": "https://www.stm.info",
            "feed_lang": "fr",
            "feed_start_date": "20260105",
            "feed_end_date": "20260614",
            "feed_version": "20260505090000_26M",
        }
    ]
    assert display["active_static"]["member_headers"]["route_patterns.txt"] == [
        "route_pattern_id",
        "route_id",
        "direction_id",
        "route_pattern_typicality",
    ]


def test_validate_static_feeds_reports_missing_active_static_as_unavailable() -> None:
    registry = FakeRegistry(FakeProvider({}))

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        raise AssertionError("validator should not download without static_schedule")

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert "current" not in display
    assert "comparison" not in display
    assert "beta" not in display
    assert display["active_static"]["status"] == "unavailable"
    assert display["active_static"]["endpoint_key"] == "static_schedule"
    assert display["active_static"]["error_type"] == "missing_feed"


def test_validate_static_feeds_reports_download_failure_as_unavailable() -> None:
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        assert source_url == "https://example.test/static.zip"
        raise OSError("network unavailable")

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert "current" not in display
    assert "beta" not in display
    assert display["active_static"]["status"] == "unavailable"
    assert display["active_static"]["error_type"] == "download_error"
    assert "network unavailable" in display["active_static"]["message"]


def test_validate_static_feeds_preserves_injected_artifact_paths_outside_temp_dir(
    tmp_path: Path,
) -> None:
    static_zip = tmp_path / "cached-static.zip"
    _write_gtfs_zip(static_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        assert not static_zip.is_relative_to(temp_dir)
        return _artifact(static_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)

    assert result.active_static.status == "ok"
    assert static_zip.exists()


def test_validate_static_feeds_reports_invalid_zip_without_raising(tmp_path: Path) -> None:
    invalid_zip = tmp_path / "not-a-zip.zip"
    invalid_zip.write_text("not a zip", encoding="utf-8")
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        return _artifact(invalid_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert "current" not in display
    assert "beta" not in display
    assert display["active_static"]["status"] == "invalid"
    assert display["active_static"]["error_type"] == "invalid_zip"
    assert "ZIP" in display["active_static"]["message"]


def test_validate_static_feeds_reports_archive_parse_failure_not_download_error(
    monkeypatch, tmp_path: Path
) -> None:
    static_zip = tmp_path / "bad-encoding.zip"
    _write_gtfs_zip(static_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )
    original_count_member_rows = static_feed_validation._count_member_rows

    def fake_count_member_rows(zip_file, member_name, member_key):  # noqa: ANN001
        if Path(zip_file.filename) == static_zip and member_key == "routes.txt":
            raise csv.Error("broken csv")
        return original_count_member_rows(zip_file, member_name, member_key)

    monkeypatch.setattr(
        static_feed_validation,
        "_count_member_rows",
        fake_count_member_rows,
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        return _artifact(static_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["active_static"]["status"] == "invalid"
    assert display["active_static"]["error_type"] == "archive_validation"
    assert display["active_static"]["error_type"] != "download_error"


def test_validate_static_feeds_reports_missing_required_member_as_invalid(
    tmp_path: Path,
) -> None:
    static_zip = tmp_path / "static.zip"
    _write_gtfs_zip(static_zip, include_stop_times=False)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/static.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        return _artifact(static_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["active_static"]["status"] == "invalid"
    assert display["active_static"]["error_type"] == "schema_validation"
    assert "stop_times.txt" in display["active_static"]["message"]


def test_validate_static_feeds_does_not_swallow_unexpected_archive_bug(
    monkeypatch, tmp_path: Path
) -> None:
    beta_zip = tmp_path / "beta.zip"
    _write_gtfs_zip(beta_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/beta.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        return _artifact(beta_zip, source_url)

    def broken_validate_archive(**kwargs):  # noqa: ANN003
        raise RuntimeError("programmer mistake")

    monkeypatch.setattr(static_feed_validation, "_validate_archive", broken_validate_archive)

    with pytest.raises(RuntimeError, match="programmer mistake"):
        validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
