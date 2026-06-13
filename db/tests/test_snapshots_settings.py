from transit_ops.settings import Settings


def test_snapshot_settings_load(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_R2_BUCKET", "transit-snapshots")
    monkeypatch.setenv("SNAPSHOT_PUBLIC_BASE_URL", "https://data.example.com")
    s = Settings(DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.SNAPSHOT_R2_BUCKET == "transit-snapshots"
    assert s.SNAPSHOT_STORAGE_BACKEND == "s3"  # default
    assert s.display_dict()["SNAPSHOT_R2_BUCKET"] == "transit-snapshots"


def test_snapshot_basemap_settings_defaults():
    """Basemap pointer settings default off (manifest.basemap stays null)."""
    s = Settings(DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.SNAPSHOT_BASEMAP_PMTILES_URL is None
    assert s.SNAPSHOT_BASEMAP_STYLE_URL is None
    assert s.SNAPSHOT_BASEMAP_ATTRIBUTION == "© OpenStreetMap contributors, © Protomaps"
    d = s.display_dict()
    assert d["SNAPSHOT_BASEMAP_PMTILES_URL"] is None
    assert d["SNAPSHOT_BASEMAP_STYLE_URL"] is None
    assert d["SNAPSHOT_BASEMAP_ATTRIBUTION"] == "© OpenStreetMap contributors, © Protomaps"


def test_snapshot_basemap_settings_from_env(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_BASEMAP_PMTILES_URL", "https://x/quebec.pmtiles")
    monkeypatch.setenv("SNAPSHOT_BASEMAP_STYLE_URL", "https://x/style.json")
    s = Settings(DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.SNAPSHOT_BASEMAP_PMTILES_URL == "https://x/quebec.pmtiles"
    assert s.SNAPSHOT_BASEMAP_STYLE_URL == "https://x/style.json"


def test_snapshot_publish_concurrency_default():
    """Parallel upload fan-out defaults to 16 (slice-9.1.1r stage 2)."""
    s = Settings(DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.SNAPSHOT_PUBLISH_CONCURRENCY == 16
    assert s.display_dict()["SNAPSHOT_PUBLISH_CONCURRENCY"] == 16


def test_snapshot_publish_concurrency_from_env(monkeypatch):
    monkeypatch.setenv("SNAPSHOT_PUBLISH_CONCURRENCY", "8")
    s = Settings(DATABASE_URL="postgresql://u:p@example.com/transit")
    assert s.SNAPSHOT_PUBLISH_CONCURRENCY == 8
