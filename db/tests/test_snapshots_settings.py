from transit_ops.settings import Settings


def test_snapshot_settings_load(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_R2_BUCKET", "transit-snapshots")
    monkeypatch.setenv("SNAPSHOT_PUBLIC_BASE_URL", "https://data.example.com")
    s = Settings(DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.SNAPSHOT_R2_BUCKET == "transit-snapshots"
    assert s.SNAPSHOT_STORAGE_BACKEND == "s3"  # default
    assert s.display_dict()["SNAPSHOT_R2_BUCKET"] == "transit-snapshots"
