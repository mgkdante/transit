from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from transit_ops.providers.declaration import SITE_LOCALES, DeclarationError, load_declaration


@pytest.fixture
def payload():
    return yaml.safe_load(
        (Path(__file__).parent / "fixtures/providers/fixture_city.yaml").read_text(encoding="utf-8")
    )


def load(tmp_path, payload, filename="fixture_city.yaml"):
    path = tmp_path / filename
    path.write_text(yaml.safe_dump(payload), encoding="utf-8")
    return load_declaration(path)


def refuses(tmp_path, payload, key):
    with pytest.raises(DeclarationError) as error:
        load(tmp_path, payload)
    assert "fixture_city.yaml" in str(error.value)
    assert key in str(error.value)
    return str(error.value)


@pytest.mark.parametrize(
    "key",
    [
        "timezone",
        "default_locale",
        "feed_languages",
        "labels",
        "stage",
        "licence",
        "attribution",
        "schedule",
    ],
)
def test_missing_required_key_fails_with_named_key(tmp_path, payload, key):
    if key == "schedule":
        payload["feeds"] = payload["feeds"][1:]
    else:
        del payload[key]
    assert "There is no default" in refuses(tmp_path, payload, key)


@pytest.mark.parametrize("path", [(), ("licence",), ("feeds", 0), ("overrides",)])
def test_unknown_key_is_rejected(tmp_path, payload, path):
    payload["overrides"] = {}
    target = payload
    for key in path:
        target = target[key]
    target["unexpected"] = True
    refuses(tmp_path, payload, "unexpected")


def test_id_must_match_file_name(tmp_path, payload):
    payload["id"] = "another_city"
    refuses(tmp_path, payload, "id")


def test_secret_value_in_auth_is_rejected(tmp_path, payload):
    payload["feeds"][1]["auth"]["secret_env"] = "inline value, not a variable name 42"
    message = refuses(tmp_path, payload, "feeds[1].auth.secret_env")
    assert "must name an environment variable; never write a key here" in message
    assert "inline value, not a variable name 42" not in message


def test_public_stage_requires_accepted_licence_basemap_and_reading_population(tmp_path, payload):
    payload.update(stage="public", overrides={"bounds": [-100, 49, -96, 51]})
    message = refuses(tmp_path, payload, "licence.review")
    assert "map" in message and "reading_population" in message
    payload["licence"]["review"] = "accepted"
    refuses(tmp_path, payload, "map")
    payload["map"] = {
        "basemap_url": "/map/city.pmtiles",
        "basemap_bounds": [-100, 49, -96, 51],
        "posters_url": "/map/posters.json",
    }
    refuses(tmp_path, payload, "reading_population")
    payload["reading_population"] = "scheduled_window"
    assert load(tmp_path, payload).stage == "public"


def test_capturing_stage_requires_bounds(tmp_path, payload):
    payload["stage"] = "capturing"
    refuses(tmp_path, payload, "overrides.bounds")


def test_capturing_stage_allows_a_missing_reading_population(tmp_path, payload):
    payload.update(stage="capturing", overrides={"bounds": [-100, 49, -96, 51]})
    assert load(tmp_path, payload).reading_population is None
    payload["reading_population"] = "unknown"
    refuses(tmp_path, payload, "reading_population")


def test_unknown_format_names_known_adapters(tmp_path, payload):
    payload["feeds"][0]["format"] = "unknown"
    message = refuses(tmp_path, payload, "format")
    assert "known: gtfs, gtfs-rt, stm-etatservice-json, stm-gis-zip" in message
    assert "unknown" not in message


def test_feed_language_outside_site_locales_is_accepted(tmp_path, payload):
    payload["feed_languages"] = ["es"]
    assert load(tmp_path, payload).feed_languages == ["es"]


def test_schedule_only_declaration_is_valid(tmp_path, payload):
    payload["feeds"] = payload["feeds"][:1]
    declaration = load(tmp_path, payload)
    assert declaration.feeds[0].format is None
    assert declaration.feeds[0].every_seconds is None
    assert declaration.live_source_lag_seconds is None


def test_fixture_city_declaration_is_valid(tmp_path, payload):
    declaration = load(tmp_path, payload)
    assert declaration.name == "Exampleville Transit"
    with pytest.raises(ValidationError):
        declaration.name = "Changed"


def test_declaration_must_be_2(tmp_path, payload):
    payload["declaration"] = 1
    assert "declaration must be 2" in refuses(tmp_path, payload, "declaration")


@pytest.mark.parametrize("case", ["mismatch", "geometry", "duplicate"])
def test_format_must_serve_its_family(tmp_path, payload, case):
    if case == "mismatch":
        payload["feeds"][0]["format"] = "gtfs-rt"
    elif case == "geometry":
        payload["feeds"][1]["family"] = "geometry"
    else:
        payload["feeds"].append(payload["feeds"][1])
    refuses(tmp_path, payload, "format" if case != "duplicate" else "feeds")


def test_site_locales_are_en_and_fr():
    assert SITE_LOCALES == ("en", "fr")


@pytest.mark.parametrize(
    "key,value",
    [
        ("timezone", "invalid/zone"),
        ("feed_languages", ["en", "en"]),
        ("feed_languages", ["EN"]),
        ("currency", "cad"),
        ("website", "http://example.org"),
        ("live_source_lag_seconds", -1),
        ("live_source_lag_seconds", True),
        ("labels", {"en": {"city": "City", "operator": "CT"}}),
        ("overrides", {"bounds": [-100, 51, -96, 49]}),
        ("overrides", {"max_vehicle_speed_kmh": float("inf")}),
        ("overrides", {"strict_gtfs": "yes"}),
    ],
)
def test_invalid_declaration_fields_are_rejected(tmp_path, payload, key, value):
    payload[key] = value
    refuses(tmp_path, payload, key)


def test_gap_requires_selectors_and_both_short_labels(tmp_path, payload):
    gap = {"gap_id": "rail", "labels": {"en": {"short": "No live data"}}}
    payload["lines_without_live_data"] = [gap]
    message = refuses(tmp_path, payload, "route_ids")
    assert "labels.fr" in message
    gap.update(
        route_types=[1, 1],
        labels={"en": {"short": "No live data"}, "fr": {"short": "Aucune donnée"}},
    )
    refuses(tmp_path, payload, "route_types")
    gap["route_types"] = [1]
    assert load(tmp_path, payload).lines_without_live_data[0].gap_id == "rail"


@pytest.mark.parametrize("key", ["url_env", "secret_env", "signature", "locale"])
def test_input_values_are_not_echoed(tmp_path, payload, key):
    secret = "inline value, not a variable name 42"
    feed = payload["feeds"][1]
    if key == "locale":
        payload["labels"][secret] = {"city": "City", "operator": "CT"}
    elif key == "url_env":
        feed[key] = secret
    elif key == "signature":
        feed["auth"][key] = {
            "query": "signature",
            "secret_env": secret,
            "scheme": "sha256_utc_minute",
        }
    else:
        feed["auth"][key] = secret
    assert secret not in refuses(tmp_path, payload, "labels" if key == "locale" else "feeds")


@pytest.mark.parametrize("contents", ["[broken", "- a list", "!!binary aGVsbG8="])
def test_invalid_yaml_is_refused(tmp_path, contents):
    path = tmp_path / "fixture_city.yaml"
    path.write_text(contents, encoding="utf-8")
    with pytest.raises(DeclarationError, match="fixture_city.yaml"):
        load_declaration(path)


def load_set(tmp_path, payload, env=None):
    from transit_ops.providers import load_providers

    load(tmp_path, payload, payload["id"] + ".yaml")
    return load_providers(config_dir=tmp_path, env={} if env is None else env)


def test_load_returns_every_declaration_or_raises(tmp_path, payload):
    from transit_ops.providers import Providers, load_providers

    load_set(tmp_path, payload)
    payload["id"] = "another_city"
    providers = load_set(tmp_path, payload)
    assert isinstance(providers, Providers)
    assert tuple(providers) == ("another_city", "fixture_city")
    (tmp_path / "broken.yaml").write_text("declaration: 1", encoding="utf-8")
    with pytest.raises(DeclarationError, match="broken.yaml"):
        load_providers(config_dir=tmp_path, env={})
    with pytest.raises(DeclarationError, match="missing"):
        load_providers(config_dir=tmp_path / "missing", env={})


def test_endpoint_key_follows_family_and_format(tmp_path, payload):
    payload["feeds"].insert(1, {"family": "geometry", "format": "stm-gis-zip",
                                 "url": "https://example.org/geometry.zip"})
    provider = load_set(tmp_path, payload)["fixture_city"]
    assert tuple(f.endpoint_key for f in provider.feeds) == (
        "static_schedule", "gis_static", "trip_updates", "vehicle_positions", "service_alerts"
    )
    assert provider.families == tuple(f.family for f in provider.feeds)
    assert provider.feed("geometry") == provider.feeds[1]
    assert provider.feed("absent") is None
    payload["feeds"][-1]["format"] = "stm-etatservice-json"
    assert load_set(tmp_path, payload)["fixture_city"].feed("alerts").endpoint_key == "i3_alerts"


def test_absent_cadence_and_format_take_the_stated_values(tmp_path, payload):
    payload["feeds"].append({"family": "geometry", "format": "stm-gis-zip",
                             "url": "https://example.org/geometry.zip"})
    feeds = load_set(tmp_path, payload)["fixture_city"].feeds
    assert tuple(f.every_seconds for f in feeds) == (86400, 30, 30, 300, 86400)
    assert tuple(f.format for f in feeds) == (
        "gtfs", "gtfs-rt", "gtfs-rt", "gtfs-rt", "stm-gis-zip"
    )
    assert all(f.phase_seconds is None for f in feeds)
    payload["feeds"][0].update(every_seconds=600, phase_seconds=0, format="gtfs")
    feed = load_set(tmp_path, payload)["fixture_city"].feed("schedule")
    assert (feed.every_seconds, feed.phase_seconds, feed.format) == (600, 0, "gtfs")


def test_url_env_wins_only_when_set(tmp_path, payload, monkeypatch):
    from transit_ops.providers import load_providers

    payload["feeds"][1]["url_env"] = "FIXTURE_CITY_TU_URL"
    override = "https://override.example/tu.pb"
    monkeypatch.setenv("FIXTURE_CITY_TU_URL", override)
    assert load_set(tmp_path, payload, {"FIXTURE_CITY_TU_URL": override})[
        "fixture_city"].feed("trip_updates").url == override
    for env in ({}, {"FIXTURE_CITY_TU_URL": ""}):
        assert load_set(tmp_path, payload, env)["fixture_city"].feed("trip_updates").url == (
            payload["feeds"][1]["url"])
    providers = load_providers(config_dir=tmp_path)
    monkeypatch.setenv("FIXTURE_CITY_TU_URL", "https://changed.example/tu.pb")
    assert providers["fixture_city"].feed("trip_updates").url == override
    del payload["feeds"][1]["url"]
    assert load_set(tmp_path, payload)["fixture_city"].feed("trip_updates").url is None


def test_secret_value_is_never_held(tmp_path, payload):
    from collections.abc import Mapping
    from dataclasses import fields, is_dataclass

    from pydantic import BaseModel

    def walk(value):
        assert value != "s3cr3t-value"
        if isinstance(value, Mapping):
            for key, item in value.items():
                walk(key)
                walk(item)
        elif is_dataclass(value) or isinstance(value, BaseModel):
            names = (
                (f.name for f in fields(value)) if is_dataclass(value)
                else type(value).model_fields
            )
            for name in names:
                walk(getattr(value, name))
        elif isinstance(value, (tuple, list)):
            for item in value:
                walk(item)

    providers = load_set(tmp_path, payload, {"FIXTURE_CITY_API_KEY": "s3cr3t-value"})
    walk(providers)
    assert providers["fixture_city"].feed("trip_updates").auth.secret_env == "FIXTURE_CITY_API_KEY"


def test_absent_optional_blocks_are_none_or_empty_and_lag_is_zero(tmp_path, payload):
    provider = load_set(tmp_path, payload)["fixture_city"]
    assert provider.lines_without_live_data == ()
    assert provider.live_source_lag_seconds == 0
    for name in ("map", "overrides", "reading_population", "website", "currency",
                 "disclaimer", "alert_links"):
        assert getattr(provider, name) is None
    assert provider.feed_languages == ("en",)
    assert provider.labels["fr"].operator == "EVT"
    assert provider.licence.review == "pending"


def test_attribution_takes_the_default_locale_for_a_missing_locale(tmp_path, payload):
    provider = load_set(tmp_path, payload)["fixture_city"]
    assert dict(provider.attribution) == {
        locale: payload["attribution"]["en"] for locale in SITE_LOCALES
    }
    payload.update(default_locale="fr", attribution={"fr": "Crédit"})
    assert load_set(tmp_path, payload)["fixture_city"].attribution["en"] == "Crédit"


def test_at_stage_keeps_only_the_named_stages(tmp_path, payload):
    load_set(tmp_path, payload)
    payload.update(id="another_city", stage="capturing", overrides={"bounds": [-100, 49, -96, 51]})
    providers = load_set(tmp_path, payload)
    assert tuple(providers.at_stage("capturing")) == ("another_city",)
    assert providers.at_stage("capturing")["another_city"].reading_population is None
    assert tuple(providers.at_stage("candidate", "capturing")) == tuple(providers)
    assert not providers.at_stage()
    assert providers.at_stage("candidate") is not providers
    with pytest.raises(ValueError):
        providers.at_stage("unknown")


def test_providers_cannot_be_changed(tmp_path, payload):
    from dataclasses import FrozenInstanceError

    providers = load_set(tmp_path, payload)
    with pytest.raises(TypeError):
        providers["fixture_city"] = providers["fixture_city"]
    with pytest.raises(TypeError):
        del providers["fixture_city"]
    with pytest.raises(FrozenInstanceError):
        providers["fixture_city"].name = "Changed"
    with pytest.raises(FrozenInstanceError):
        providers["fixture_city"].feeds[0].url = "https://changed.example/"
    with pytest.raises(TypeError):
        providers["fixture_city"].attribution["en"] = "Changed"


def test_interface_is_exported_from_the_package():
    from transit_ops import providers

    for name in ("load_providers", "Providers", "Provider", "Feed", "DeclarationError",
                 "SITE_LOCALES", "ProviderRegistry", "load_provider_manifest"):
        assert getattr(providers, name) is not None
        assert name in providers.__all__
