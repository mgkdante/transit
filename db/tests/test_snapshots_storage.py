from __future__ import annotations

import pytest
from transit_ops.snapshots.storage import SnapshotStorage, CACHE_CONTROL
from transit_ops.snapshots.contract import VehiclesFile


class FakeS3Client:
    def __init__(self): self.objects = {}
    def put_object(self, **kw): self.objects[kw["Key"]] = kw


def test_put_json_sets_headers():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    store.put_json("live/vehicles.json", VehiclesFile(generated_utc="t", vehicles=[]), tier="live")
    obj = c.objects["v1/stm/live/vehicles.json"]
    assert obj["Bucket"] == "transit-snapshots"
    assert obj["ContentType"] == "application/json"
    assert obj["CacheControl"] == CACHE_CONTROL["live"]
    assert b'"vehicles"' in obj["Body"]


def test_put_json_returns_full_key():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    key = store.put_json("live/vehicles.json", VehiclesFile(generated_utc="t", vehicles=[]), tier="live")
    assert key == "v1/stm/live/vehicles.json"


def test_cache_control_values():
    assert CACHE_CONTROL["live"] == "public, max-age=30"
    assert CACHE_CONTROL["static"] == "public, max-age=604800"
    assert CACHE_CONTROL["historic"] == "public, max-age=86400"


def test_put_json_static_tier():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    store.put_json("static/stops.json", {"stops": []}, tier="static")
    obj = c.objects["v1/stm/static/stops.json"]
    assert obj["CacheControl"] == CACHE_CONTROL["static"]


def test_put_json_dict_payload():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="transit-snapshots", base_prefix="v1/stm")
    store.put_json("live/network.json", {"vehicles_in_service": 42}, tier="live")
    obj = c.objects["v1/stm/live/network.json"]
    assert b"vehicles_in_service" in obj["Body"]
    assert b"42" in obj["Body"]


def test_base_prefix_strips_slashes():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="bucket", base_prefix="/v1/stm/")
    store.put_json("live/vehicles.json", {}, tier="live")
    assert "v1/stm/live/vehicles.json" in c.objects


def test_local_backend_writes_file(tmp_path):
    from transit_ops.snapshots.storage import build_snapshot_storage
    from transit_ops.settings import Settings

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="local",
        SNAPSHOT_LOCAL_ROOT=str(tmp_path),
    )
    store = build_snapshot_storage(s, provider_id="stm")
    store.put_json("live/network.json", {"vehicles_in_service": 1}, tier="live")
    assert (tmp_path / "v1/stm/live/network.json").exists()


def test_local_backend_file_content(tmp_path):
    from transit_ops.snapshots.storage import build_snapshot_storage
    from transit_ops.settings import Settings

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="local",
        SNAPSHOT_LOCAL_ROOT=str(tmp_path),
    )
    store = build_snapshot_storage(s, provider_id="stm")
    store.put_json("live/network.json", {"vehicles_in_service": 7}, tier="live")
    content = (tmp_path / "v1/stm/live/network.json").read_bytes()
    assert b"vehicles_in_service" in content
    assert b"7" in content


def test_local_backend_missing_root_raises():
    from transit_ops.snapshots.storage import build_snapshot_storage
    from transit_ops.settings import Settings

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="local",
        SNAPSHOT_LOCAL_ROOT=None,
    )
    with pytest.raises(ValueError, match="SNAPSHOT_LOCAL_ROOT"):
        build_snapshot_storage(s, provider_id="stm")


def test_s3_backend_missing_bucket_raises():
    from transit_ops.snapshots.storage import build_snapshot_storage
    from transit_ops.settings import Settings

    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET=None,
    )
    with pytest.raises(ValueError, match="SNAPSHOT_R2_BUCKET"):
        build_snapshot_storage(s, provider_id="stm")


def test_s3_backend_uses_injected_client():
    from transit_ops.snapshots.storage import build_snapshot_storage
    from transit_ops.settings import Settings

    c = FakeS3Client()
    s = Settings(
        DATABASE_URL="postgresql://u:p@example.com/transit",
        SNAPSHOT_STORAGE_BACKEND="s3",
        SNAPSHOT_R2_BUCKET="transit-snapshots",
    )
    store = build_snapshot_storage(s, provider_id="stm", client=c)
    store.put_json("live/vehicles.json", {"vehicles": []}, tier="live")
    assert "v1/stm/live/vehicles.json" in c.objects
