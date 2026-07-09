from __future__ import annotations

import io
import json

import pytest
from botocore.exceptions import ClientError
from transit_ops.snapshots.storage import (
    CACHE_CONTROL,
    HashGatedStorage,
    SnapshotStorage,
    state_fingerprint,
)
from transit_ops.snapshots.contract import VehiclesFile


class FakeS3Client:
    def __init__(self): self.objects = {}
    def put_object(self, **kw): self.objects[kw["Key"]] = kw

    def get_object(self, **kw):
        key = kw["Key"]
        if key not in self.objects:
            raise ClientError(
                {"Error": {"Code": "NoSuchKey", "Message": "missing"}}, "GetObject"
            )
        return {"Body": io.BytesIO(self.objects[key]["Body"])}


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
    assert CACHE_CONTROL["static"] == "public, max-age=86400, stale-while-revalidate=86400"
    assert CACHE_CONTROL["historic"] == "public, max-age=3600, stale-while-revalidate=86400"
    assert CACHE_CONTROL["internal"] == "private, no-store"


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


# ---------------------------------------------------------------------------
# T1 — storage primitives: full_key / get_json / put_bytes / put_json delegation
# ---------------------------------------------------------------------------


def test_full_key_joins_prefix():
    store = SnapshotStorage(FakeS3Client(), bucket="b", base_prefix="/v1/stm/")
    assert store.full_key("static/routes_index.json") == "v1/stm/static/routes_index.json"


def test_get_json_returns_none_on_missing_key():
    store = SnapshotStorage(FakeS3Client(), bucket="b", base_prefix="v1/stm")
    assert store.get_json("_meta/publish_state_static.json") is None


def test_get_json_roundtrips_stored_object():
    c = FakeS3Client()
    store = SnapshotStorage(c, bucket="b", base_prefix="v1/stm")
    store.put_bytes("_meta/state.json", json.dumps({"a": 1}).encode(), tier="internal")
    assert store.get_json("_meta/state.json") == {"a": 1}
    # internal tier carries the no-store header
    assert c.objects["v1/stm/_meta/state.json"]["CacheControl"] == CACHE_CONTROL["internal"]


def test_get_json_reraises_non_404_client_error():
    class BoomClient(FakeS3Client):
        def get_object(self, **kw):
            raise ClientError(
                {"Error": {"Code": "AccessDenied", "Message": "nope"}}, "GetObject"
            )

    store = SnapshotStorage(BoomClient(), bucket="b", base_prefix="v1/stm")
    with pytest.raises(ClientError):
        store.get_json("_meta/state.json")


def test_local_get_json_missing_returns_none(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    assert store.get_json("_meta/state.json") is None


def test_local_get_json_roundtrips(tmp_path):
    from transit_ops.snapshots.storage import LocalSnapshotStorage

    store = LocalSnapshotStorage(str(tmp_path), "v1/stm")
    store.put_bytes("_meta/state.json", json.dumps({"b": 2}).encode(), tier="internal")
    assert store.get_json("_meta/state.json") == {"b": 2}


def test_put_json_delegates_to_put_bytes():
    calls = []

    class RecordingStore(SnapshotStorage):
        def put_bytes(self, rel_key, body, *, tier):
            calls.append((rel_key, body, tier))
            return self.full_key(rel_key)

    store = RecordingStore(FakeS3Client(), bucket="b", base_prefix="v1/stm")
    store.put_json("live/network.json", {"x": 1}, tier="live")
    assert len(calls) == 1
    rel_key, body, tier = calls[0]
    assert rel_key == "live/network.json"
    assert tier == "live"
    assert b'"x":1' in body


# ---------------------------------------------------------------------------
# T2 — HashGatedStorage skip/write/fingerprint/merge semantics
# ---------------------------------------------------------------------------


class StatefulFakeStore:
    """In-memory stand-in for an inner snapshot storage with hash-state support."""

    def __init__(self):
        self.store: dict[str, bytes] = {}
        self.put_bytes_calls: list[str] = []

    def full_key(self, rel_key):
        return f"v1/stm/{rel_key}"

    def put_bytes(self, rel_key, body, *, tier):
        self.put_bytes_calls.append(rel_key)
        self.store[rel_key] = body
        return self.full_key(rel_key)

    def get_json(self, rel_key):
        raw = self.store.get(rel_key)
        return json.loads(raw) if raw is not None else None


def test_hash_gated_skips_unchanged_put():
    inner = StatefulFakeStore()
    fp = state_fingerprint("static")
    # First run writes and flushes state.
    g1 = HashGatedStorage(inner, state_rel_key="_meta/publish_state_static.json", fingerprint=fp)
    g1.load()
    g1.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g1.flush_state()
    inner.put_bytes_calls.clear()

    # Second run with identical payload skips the put entirely.
    g2 = HashGatedStorage(inner, state_rel_key="_meta/publish_state_static.json", fingerprint=fp)
    g2.load()
    key = g2.put_json("static/routes_index.json", {"routes": []}, tier="static")
    assert "static/routes_index.json" not in inner.put_bytes_calls
    assert g2.skipped == ["static/routes_index.json"]
    assert g2.written == []
    assert key == "v1/stm/static/routes_index.json"


def test_hash_gated_writes_changed_put():
    inner = StatefulFakeStore()
    fp = state_fingerprint("static")
    g1 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=fp)
    g1.load()
    g1.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g1.flush_state()
    inner.put_bytes_calls.clear()

    g2 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=fp)
    g2.load()
    g2.put_json("static/routes_index.json", {"routes": ["165"]}, tier="static")
    assert "static/routes_index.json" in inner.put_bytes_calls
    assert g2.written == ["static/routes_index.json"]
    assert g2.skipped == []


def test_hash_gated_missing_state_writes_everything():
    inner = StatefulFakeStore()  # no state object
    g = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=state_fingerprint("static"))
    g.load()
    g.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g.put_json("static/stops_index.json", {"stops": []}, tier="static")
    assert g.written == ["static/routes_index.json", "static/stops_index.json"]
    assert g.skipped == []


def test_hash_gated_fingerprint_mismatch_forces_full_rewrite():
    inner = StatefulFakeStore()
    # Pre-seed state with a stale fingerprint string but a matching content hash.
    g1 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint="v1|cc:OLD-HEADER")
    g1.load()
    g1.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g1.flush_state()
    inner.put_bytes_calls.clear()

    # New fingerprint -> prior hashes ignored -> full rewrite even though bytes match.
    g2 = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=state_fingerprint("static"))
    g2.load()
    g2.put_json("static/routes_index.json", {"routes": []}, tier="static")
    assert "static/routes_index.json" in inner.put_bytes_calls
    assert g2.written == ["static/routes_index.json"]


def test_hash_gated_flush_state_merges_prior_unproduced_keys():
    inner = StatefulFakeStore()
    fp = state_fingerprint("historic")
    g1 = HashGatedStorage(inner, state_rel_key="_meta/h.json", fingerprint=fp)
    g1.load()
    g1.put_json("historic/receipts/2026-06-01.json", {"date": "2026-06-01"}, tier="historic")
    g1.flush_state()

    # Run 2 produces a DIFFERENT key (the old receipt fell out of the window).
    g2 = HashGatedStorage(inner, state_rel_key="_meta/h.json", fingerprint=fp)
    g2.load()
    g2.put_json("historic/receipts/2026-06-02.json", {"date": "2026-06-02"}, tier="historic")
    g2.flush_state()

    state = inner.get_json("_meta/h.json")
    # Both the unproduced old key and the new key survive in the merged map.
    assert "historic/receipts/2026-06-01.json" in state["hashes"]
    assert "historic/receipts/2026-06-02.json" in state["hashes"]


def test_hash_gated_state_written_with_internal_cache_control():
    class TierRecordingStore(StatefulFakeStore):
        def __init__(self):
            super().__init__()
            self.tiers: dict[str, str] = {}

        def put_bytes(self, rel_key, body, *, tier):
            self.tiers[rel_key] = tier
            return super().put_bytes(rel_key, body, tier=tier)

    inner = TierRecordingStore()
    g = HashGatedStorage(inner, state_rel_key="_meta/s.json", fingerprint=state_fingerprint("static"))
    g.load()
    g.put_json("static/routes_index.json", {"routes": []}, tier="static")
    g.flush_state()
    assert inner.tiers["_meta/s.json"] == "internal"
    assert inner.tiers["static/routes_index.json"] == "static"
