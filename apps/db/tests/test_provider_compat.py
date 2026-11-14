from pathlib import Path

import pytest
import yaml

from transit_ops.providers.compat import manifest_from_declaration
from transit_ops.providers.declaration import DeclarationError, load_declaration
from transit_ops.providers.registry import load_provider_manifest
from transit_ops.settings import Settings

FIXTURES = Path(__file__).parent / "fixtures" / "providers"


def declaration(tmp_path, **changes):
    payload = yaml.safe_load((FIXTURES / "fixture_city.yaml").read_text(encoding="utf-8"))
    payload.update(changes)
    path = tmp_path / "fixture_city.yaml"
    path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    return load_declaration(path)


def test_fixture_declaration_builds_an_equal_manifest(tmp_path):
    actual = manifest_from_declaration(declaration(tmp_path))
    expected = load_provider_manifest(FIXTURES / "fixture_city_legacy.yaml")
    settings = Settings(_env_file=None)
    assert actual == expected
    assert actual.model_dump(mode="json") == expected.model_dump(mode="json")
    assert actual.to_provider_seed().as_params() == expected.to_provider_seed().as_params()
    assert [s.as_params() for s in actual.to_feed_endpoint_seeds(settings)] == [
        s.as_params() for s in expected.to_feed_endpoint_seeds(settings)
    ]
    assert actual.to_display_dict(settings) == expected.to_display_dict(settings)


@pytest.mark.parametrize(
    "stage,flags",
    [("candidate", (False, False)), ("capturing", (True, False)), ("public", (True, True))],
)
def test_stage_controls_active_and_public_flags(tmp_path, stage, flags):
    source = declaration(
        tmp_path,
        stage=stage,
        **yaml.safe_load("""
overrides: {bounds: [-81, 41, -72, 49]}
licence: {name: Open, terms_url: 'https://example.org/licence', review: accepted}
map: {basemap_url: map.json, posters_url: posters.json, basemap_bounds: [-82, 40, -71, 50]}
"""),
        reading_population="vehicle_evidence" if stage == "public" else None,
    )
    result = manifest_from_declaration(source)
    assert (result.provider.is_active, result.public.enabled) == flags
    assert result.provider.reading_population == source.reading_population


@pytest.mark.parametrize(
    "family,fmt,key,source_format,cadence,accessor",
    [
        ("schedule", None, "static_schedule", "gtfs_schedule_zip", 86400, "static_feed"),
        ("geometry", "stm-gis-zip", "gis_static", "stm_gis_zip", 86400, "gis_feed"),
        ("trip_updates", None, "trip_updates", "gtfs_rt_trip_updates", 30, "realtime_feed"),
        (
            "vehicle_positions",
            None,
            "vehicle_positions",
            "gtfs_rt_vehicle_positions",
            30,
            "realtime_feed",
        ),
        ("alerts", None, "service_alerts", "gtfs_rt_service_alerts", 300, "service_alerts_feed"),
        ("alerts", "stm-etatservice-json", "i3_alerts", "api_i3_json", 300, "i3_alerts_feed"),
    ],
)
def test_all_feed_formats_keep_endpoint_identity(
    tmp_path, family, fmt, key, source_format, cadence, accessor
):
    feeds = [
        {"family": f, "url": "https://example.org/feed"}
        for f in ["schedule", "geometry", "trip_updates", "vehicle_positions", "alerts"]
    ]
    feeds[1]["format"] = "stm-gis-zip"
    target = next(f for f in feeds if f["family"] == family)
    if fmt:
        target["format"] = fmt
    result = manifest_from_declaration(declaration(tmp_path, feeds=feeds[::-1]))
    feed = result.feeds[key]
    assert (feed.endpoint_key, feed.feed_kind) == (key, key)
    assert (feed.source_format, feed.refresh_interval_seconds) == (source_format, cadence)
    assert feed.is_enabled
    method = getattr(result, accessor)
    assert (method(key) if accessor == "realtime_feed" else method()) is feed
    alert = "i3_alerts" if fmt == "stm-etatservice-json" else "service_alerts"
    order = ["static_schedule", "gis_static", "trip_updates", "vehicle_positions", alert]
    assert list(result.feeds) == order[::-1]
    assert [
        s.endpoint_key for s in result.to_feed_endpoint_seeds(Settings(_env_file=None))
    ] == order


@pytest.mark.parametrize("url", [None, "https://example.org/fallback"])
def test_url_override_is_retained_not_resolved(tmp_path, monkeypatch, url):
    monkeypatch.delenv("COMPAT_URL", raising=False)
    source = declaration(
        tmp_path, feeds=[{"family": "schedule", "url": url, "url_env": "COMPAT_URL"}]
    )
    feed = manifest_from_declaration(source).static_feed()
    assert feed.source_url_env_var == "COMPAT_URL"
    settings = Settings(_env_file=None)
    for value, expected in [
        (None, url),
        ("", url),
        ("https://example.org/override", "https://example.org/override"),
    ]:
        if value is None:
            monkeypatch.delenv("COMPAT_URL", raising=False)
        else:
            monkeypatch.setenv("COMPAT_URL", value)
        assert feed.resolved_source_url(settings) == expected


@pytest.mark.parametrize(
    "location,signed",
    [(None, False), ("header", False), ("query", False), ("query", True)],
)
def test_auth_projection_keeps_variable_names(tmp_path, monkeypatch, location, signed):
    monkeypatch.delenv("COMPAT_KEY", raising=False)
    monkeypatch.delenv("COMPAT_SIGNING", raising=False)
    auth = {location: "key-location", "secret_env": "COMPAT_KEY"} if location else None
    if signed:
        auth["signature"] = {
            "query": "sig",
            "secret_env": "COMPAT_SIGNING",
            "scheme": "sha256_utc_minute",
        }
    source = declaration(
        tmp_path, feeds=[{"family": "schedule", "url": "https://example.org/feed", "auth": auth}]
    )
    result = manifest_from_declaration(source).static_feed().auth.model_dump(mode="json")
    assert result == {
        "auth_type": "api_key_signed" if signed else "api_key" if location else "none",
        "credential_env_var": "COMPAT_KEY" if location else None,
        "auth_header_name": "key-location" if location == "header" else None,
        "auth_query_param": "key-location" if location == "query" else None,
        "signing_secret_env_var": "COMPAT_SIGNING" if signed else None,
        "signature_query_param": "sig" if signed else None,
        "signature_scheme": "sha256_utc_minute" if signed else None,
        "notes": None,
    }
    monkeypatch.setenv("COMPAT_KEY", "synthetic-credential")
    assert manifest_from_declaration(source).static_feed().auth.model_dump(mode="json") == result


def test_signed_header_is_refused_without_echoing_values(tmp_path):
    source = declaration(
        tmp_path,
        feeds=yaml.safe_load("""
- {family: schedule, url: 'https://example.org/feed'}
- family: alerts
  url: https://example.org/private-url
  auth:
    header: private-header
    secret_env: PRIVATE_KEY
    signature: {query: private-signature, secret_env: PRIVATE_SIGNING, scheme: sha256_utc_minute}
"""),
    )
    with pytest.raises(DeclarationError) as error:
        manifest_from_declaration(source)
    assert str(error.value) == (
        "fixture_city: feeds[1].auth.signature: signed compatibility auth requires query"
    )


def test_explicit_overrides_and_policy_are_preserved(tmp_path):
    gaps = [
        {"gap_id": "rail", "route_ids": ["Z", "A"], "route_types": [2, 1]},
        {"gap_id": "bus", "route_ids": ["9"], "route_types": []},
    ]
    source = declaration(
        tmp_path,
        **yaml.safe_load("""
live_source_lag_seconds: 0
overrides:
  bounds: [-81, 41, -72, 49]
  fit_bounds: [-80, 42, -73, 48]
  max_bounds: [-82, 40, -71, 50]
  geocode_context: Example region
  max_vehicle_speed_kmh: 99
  strict_gtfs: false
map: {basemap_url: map.json, posters_url: posters.json, basemap_bounds: [-83, 39, -70, 51]}
feeds: [{family: schedule, url: 'https://example.org/feed', every_seconds: 700, phase_seconds: 0}]
"""),
        alert_links={"en": "https://example.org/en", "fr": "https://example.org/fr"},
        lines_without_live_data=[
            {**g, "labels": {"en": {"short": "Rail"}, "fr": {"short": "Train"}}} for g in gaps
        ],
    )
    before = source.model_dump()
    result = manifest_from_declaration(source)
    assert result.provider.bounds.model_dump() == dict(
        min_longitude=-81, min_latitude=41, max_longitude=-72, max_latitude=49
    )
    assert result.public.fit_bounds.bbox() == [-80, 42, -73, 48]
    assert result.public.max_bounds.bbox() == [-82, 40, -71, 50]
    assert result.public.basemap_bounds.bbox() == [-83, 39, -70, 51]
    public, provider, feed = result.public, result.provider, result.static_feed()
    assert (public.basemap_url, public.posters_url) == ("map.json", "posters.json")
    assert public.geocode_context == "Example region"
    assert (provider.max_vehicle_speed_kmh, provider.strict_gtfs) == (99, False)
    assert provider.live_source_lag_seconds == 0
    assert (feed.refresh_interval_seconds, feed.refresh_phase_seconds) == (700, 0)
    assert {k: str(v) for k, v in result.public.alert_links.items()} == {
        "en": "https://example.org/en",
        "fr": "https://example.org/fr",
    }
    assert [g.model_dump() for g in result.realtime.lines_without_live_data] == gaps
    result.realtime.lines_without_live_data[0].route_ids.append("new")
    result.public.labels["en"].city = "Changed"
    result.public.alert_links.clear()
    result.feeds.clear()
    assert source.model_dump() == before


def test_locale_projection_and_absent_values(tmp_path):
    source = declaration(
        tmp_path,
        default_locale="fr",
        feed_languages=["es"],
        labels={
            "en": {"city": "English city", "operator": "EN"},
            "fr": {"city": "Ville", "operator": "FR"},
        },
        attribution={"en": "English credit", "fr": "Credit francais"},
        website="https://example.org/agency",
        currency="CAD",
        feeds=[{"family": "schedule", "url": "https://example.org/feed"}],
    )
    provider = manifest_from_declaration(source).provider
    assert (provider.city, provider.short_name, provider.default_language) == ("Ville", "FR", "fr")
    assert provider.attribution_text == "Credit francais"
    assert str(provider.website_url) == "https://example.org/agency"
    assert provider.default_currency == "CAD"
    result = manifest_from_declaration(
        declaration(tmp_path, feeds=[{"family": "schedule", "url": "https://example.org/feed"}])
    )
    for field in "bounds reading_population website_url default_currency strict_gtfs".split():
        assert getattr(result.provider, field) is None
    assert result.provider.max_vehicle_speed_kmh == 130
    assert result.provider.live_source_lag_seconds == 0
    assert result.static_feed().refresh_phase_seconds is None
    assert result.public.model_dump(exclude={"enabled", "labels"}) == dict(
        fit_bounds=None,
        max_bounds=None,
        basemap_bounds=None,
        geocode_context=None,
        basemap_url=None,
        posters_url=None,
        alert_links={},
    )
    assert result.realtime.lines_without_live_data == []
