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


def _artifact(path: Path, source_url: str) -> DownloadedArtifact:
    return DownloadedArtifact(
        temp_path=path,
        byte_size=path.stat().st_size,
        checksum_sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
        http_status_code=200,
        source_url=source_url,
    )


def test_validate_static_feeds_reports_current_and_beta_ok(tmp_path: Path) -> None:
    current_zip = tmp_path / "current.zip"
    beta_zip = tmp_path / "beta.zip"
    _write_gtfs_zip(current_zip)
    _write_gtfs_zip(beta_zip, route_id="2")
    registry = FakeRegistry(
        FakeProvider(
            {
                "static_schedule": FakeFeed("https://example.test/current.zip"),
                "static_schedule_beta": FakeFeed("https://example.test/beta.zip"),
            }
        )
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        assert temp_dir.exists()
        if source_url.endswith("current.zip"):
            return _artifact(current_zip, source_url)
        return _artifact(beta_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["provider_id"] == "stm"
    assert display["current"]["status"] == "ok"
    assert display["beta"]["status"] == "ok"
    assert display["current"]["row_counts"]["routes.txt"] == 1
    assert display["current"]["row_counts"]["stop_times.txt"] == 1
    assert display["current"]["required_members_present"] == [
        "routes.txt",
        "stop_times.txt",
        "stops.txt",
        "trips.txt",
    ]
    assert display["current"]["optional_service_members_present"] == ["calendar_dates.txt"]
    assert display["comparison"] == {
        "both_available": True,
        "checksums_match": False,
        "byte_sizes_match": True,
    }


def test_validate_static_feeds_reports_missing_beta_url_as_unavailable(
    tmp_path: Path,
) -> None:
    current_zip = tmp_path / "current.zip"
    _write_gtfs_zip(current_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/current.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        return _artifact(current_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["current"]["status"] == "ok"
    assert display["beta"]["status"] == "unavailable"
    assert display["beta"]["endpoint_key"] == "static_schedule_beta"
    assert display["beta"]["error_type"] == "missing_feed"
    assert display["comparison"]["both_available"] is False


def test_validate_static_feeds_reports_download_failure_as_unavailable(
    tmp_path: Path,
) -> None:
    current_zip = tmp_path / "current.zip"
    _write_gtfs_zip(current_zip)
    registry = FakeRegistry(
        FakeProvider(
            {
                "static_schedule": FakeFeed("https://example.test/current.zip"),
                "static_schedule_beta": FakeFeed("https://example.test/beta.zip"),
            }
        )
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        if source_url.endswith("current.zip"):
            return _artifact(current_zip, source_url)
        raise OSError("network unavailable")

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["current"]["status"] == "ok"
    assert display["beta"]["status"] == "unavailable"
    assert display["beta"]["error_type"] == "download_error"
    assert "network unavailable" in display["beta"]["message"]


def test_validate_static_feeds_preserves_injected_artifact_paths_outside_temp_dir(
    tmp_path: Path,
) -> None:
    current_zip = tmp_path / "cached-current.zip"
    _write_gtfs_zip(current_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/current.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        assert not current_zip.is_relative_to(temp_dir)
        return _artifact(current_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)

    assert result.current.status == "ok"
    assert current_zip.exists()


def test_validate_static_feeds_reports_invalid_zip_without_raising(tmp_path: Path) -> None:
    current_zip = tmp_path / "current.zip"
    invalid_zip = tmp_path / "not-a-zip.zip"
    _write_gtfs_zip(current_zip)
    invalid_zip.write_text("not a zip", encoding="utf-8")
    registry = FakeRegistry(
        FakeProvider(
            {
                "static_schedule": FakeFeed("https://example.test/current.zip"),
                "static_schedule_beta": FakeFeed("https://example.test/beta.zip"),
            }
        )
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        if source_url.endswith("current.zip"):
            return _artifact(current_zip, source_url)
        return _artifact(invalid_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["current"]["status"] == "ok"
    assert display["beta"]["status"] == "invalid"
    assert display["beta"]["error_type"] == "invalid_zip"
    assert "ZIP" in display["beta"]["message"]


def test_validate_static_feeds_reports_archive_parse_failure_not_download_error(
    monkeypatch, tmp_path: Path
) -> None:
    current_zip = tmp_path / "current.zip"
    beta_zip = tmp_path / "bad-encoding.zip"
    _write_gtfs_zip(current_zip)
    _write_gtfs_zip(beta_zip)
    registry = FakeRegistry(
        FakeProvider(
            {
                "static_schedule": FakeFeed("https://example.test/current.zip"),
                "static_schedule_beta": FakeFeed("https://example.test/beta.zip"),
            }
        )
    )
    original_count_member_rows = static_feed_validation._count_member_rows

    def fake_count_member_rows(zip_file, member_name, member_key):  # noqa: ANN001
        if Path(zip_file.filename) == beta_zip and member_key == "routes.txt":
            raise csv.Error("broken csv")
        return original_count_member_rows(zip_file, member_name, member_key)

    monkeypatch.setattr(
        static_feed_validation,
        "_count_member_rows",
        fake_count_member_rows,
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        if source_url.endswith("current.zip"):
            return _artifact(current_zip, source_url)
        return _artifact(beta_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["beta"]["status"] == "invalid"
    assert display["beta"]["error_type"] == "archive_validation"
    assert display["beta"]["error_type"] != "download_error"


def test_validate_static_feeds_reports_missing_required_member_as_invalid(
    tmp_path: Path,
) -> None:
    current_zip = tmp_path / "current.zip"
    beta_zip = tmp_path / "beta.zip"
    _write_gtfs_zip(current_zip)
    _write_gtfs_zip(beta_zip, include_stop_times=False)
    registry = FakeRegistry(
        FakeProvider(
            {
                "static_schedule": FakeFeed("https://example.test/current.zip"),
                "static_schedule_beta": FakeFeed("https://example.test/beta.zip"),
            }
        )
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        if source_url.endswith("current.zip"):
            return _artifact(current_zip, source_url)
        return _artifact(beta_zip, source_url)

    result = validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
    display = result.display_dict()

    assert display["beta"]["status"] == "invalid"
    assert display["beta"]["error_type"] == "schema_validation"
    assert "stop_times.txt" in display["beta"]["message"]


def test_validate_static_feeds_does_not_swallow_unexpected_archive_bug(
    monkeypatch, tmp_path: Path
) -> None:
    current_zip = tmp_path / "current.zip"
    _write_gtfs_zip(current_zip)
    registry = FakeRegistry(
        FakeProvider({"static_schedule": FakeFeed("https://example.test/current.zip")})
    )

    def fake_downloader(*, source_url: str, temp_dir: Path) -> DownloadedArtifact:
        return _artifact(current_zip, source_url)

    def broken_validate_archive(**kwargs):  # noqa: ANN003
        raise RuntimeError("programmer mistake")

    monkeypatch.setattr(static_feed_validation, "_validate_archive", broken_validate_archive)

    with pytest.raises(RuntimeError, match="programmer mistake"):
        validate_static_feeds("stm", registry=registry, downloader=fake_downloader)
