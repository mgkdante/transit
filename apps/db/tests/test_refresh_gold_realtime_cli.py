from __future__ import annotations

import json
from contextlib import nullcontext
from datetime import UTC, datetime
from types import SimpleNamespace

import pytest
from typer.testing import CliRunner

import transit_ops.cli as cli
from transit_ops.gold.marts import GoldRealtimeRefreshResult
from transit_ops.settings import Settings
from transit_ops.silver import realtime_gtfs as silver
from transit_ops.silver.realtime_gtfs import RealtimeSilverLoadResult

NOW = datetime(2026, 9, 5, 12, 0, tzinfo=UTC)
runner = CliRunner()


def receipt(snapshot_id=71, endpoint="trip_updates"):
    return RealtimeSilverLoadResult(
        provider_id="stm",
        endpoint_key=endpoint,
        realtime_snapshot_id=snapshot_id,
        source_ingestion_run_id=31,
        source_ingestion_object_id=41,
        storage_path=f"stm/{endpoint}/{snapshot_id}.pb",
        archive_full_path="/unused/archive",
        content_hash="a" * 64,
        feed_timestamp_utc=NOW,
        captured_at_utc=NOW,
        row_counts={
            "rt_feed_snapshots": 1,
            "rt_entities": 1,
            "rt_trip_updates" if endpoint == "trip_updates" else "rt_vehicle_positions": 1,
        },
    )


@pytest.fixture
def configured(monkeypatch):
    settings = Settings(_env_file=None)
    registry = SimpleNamespace(
        get_provider=lambda provider_id: SimpleNamespace(
            provider=SimpleNamespace(provider_id=provider_id, timezone="America/Toronto"),
            feeds={
                "trip_updates": SimpleNamespace(is_enabled=True),
                "vehicle_positions": SimpleNamespace(is_enabled=True),
                "i3_alerts": SimpleNamespace(is_enabled=True),
            },
        )
    )
    monkeypatch.setattr(cli, "get_settings", lambda: settings)
    monkeypatch.setattr(cli, "_provider_registry", lambda settings: registry)
    return settings, registry


@pytest.mark.parametrize("bootstrap", [False, True])
@pytest.mark.parametrize("available", ["both", "one", "none"])
def test_refresh_command_passes_verified_inputs_after_initialization(
    monkeypatch, configured, bootstrap, available
):
    snapshots = [receipt(), receipt(72, "vehicle_positions")]
    snapshots = snapshots if available == "both" else snapshots[:1] if available == "one" else []
    calls = []

    def initialize(provider_id, endpoint_keys, **kwargs):
        calls.append("initialize")
        assert endpoint_keys == ("trip_updates", "vehicle_positions")

    def load(provider_id, endpoint_keys, **kwargs):
        assert calls == ["initialize"]
        calls.append("load")
        return snapshots

    def refresh(
        provider_id, *, snapshots: list[RealtimeSilverLoadResult], bootstrap_from_archive, **kwargs
    ):
        assert calls == ["initialize", "load"]
        calls.append("gold")
        assert bootstrap_from_archive is bootstrap
        assert all(item is expected for item, expected in zip(snapshots, selected, strict=True))
        return GoldRealtimeRefreshResult(
            provider_id,
            "America/Toronto",
            None,
            None,
            None,
            NOW,
            {},
            projected_snapshot_ids=tuple(item.realtime_snapshot_id for item in snapshots),
        )

    selected = snapshots
    monkeypatch.setattr(cli, "initialize_realtime_serving", initialize)
    monkeypatch.setattr(cli, "load_latest_realtime_snapshots_to_silver", load, raising=False)
    monkeypatch.setattr(cli, "refresh_gold_realtime", refresh)
    command = ["refresh-gold-realtime", "stm"] + (["--bootstrap-from-archive"] if bootstrap else [])
    result = runner.invoke(cli.app, command)
    assert result.exit_code == 0, result.output
    assert calls == ["initialize", "load", "gold"]
    payload = json.loads(result.stdout)
    assert payload["projected_snapshot_ids"] == [item.realtime_snapshot_id for item in selected]
    assert payload["status"] == ("refreshed" if selected else "no-archived-snapshots")


def test_refresh_command_omits_disabled_and_non_rt_lanes(monkeypatch, configured):
    registry = configured[1]
    manifest = registry.get_provider("stm")
    manifest.feeds["vehicle_positions"].is_enabled = False
    registry.get_provider = lambda provider: manifest
    seen = []
    monkeypatch.setattr(
        cli,
        "initialize_realtime_serving",
        lambda provider, endpoints, **kwargs: seen.append(endpoints),
    )
    monkeypatch.setattr(
        cli,
        "load_latest_realtime_snapshots_to_silver",
        lambda provider, endpoints, **kwargs: seen.append(endpoints) or [],
        raising=False,
    )
    monkeypatch.setattr(
        cli,
        "refresh_gold_realtime",
        lambda provider, **kwargs: GoldRealtimeRefreshResult(
            provider, "America/Toronto", None, None, None, NOW, {}
        ),
    )
    result = runner.invoke(cli.app, ["refresh-gold-realtime", "stm"])
    assert result.exit_code == 0, result.output
    assert seen == [("trip_updates",), ("trip_updates",)]


@pytest.mark.parametrize("stage", ["initialize", "load"])
def test_refresh_command_stops_before_gold_on_input_failure(monkeypatch, configured, stage):
    calls = []

    def initialize(*args, **kwargs):
        calls.append("initialize")
        if stage == "initialize":
            raise ValueError("invalid serving state")

    def load(*args, **kwargs):
        calls.append("load")
        raise FileNotFoundError("verified archive is missing")

    monkeypatch.setattr(cli, "initialize_realtime_serving", initialize)
    monkeypatch.setattr(cli, "load_latest_realtime_snapshots_to_silver", load, raising=False)
    monkeypatch.setattr(
        cli, "refresh_gold_realtime", lambda *args, **kwargs: pytest.fail("no Gold without inputs")
    )
    result = runner.invoke(cli.app, ["refresh-gold-realtime", "stm"])
    assert result.exit_code != 0
    assert calls == (["initialize"] if stage == "initialize" else ["initialize", "load"])


def test_capture_only_command_does_not_initialize_gold(monkeypatch, configured):
    monkeypatch.setattr(
        cli,
        "initialize_realtime_serving",
        lambda *args, **kwargs: pytest.fail(
            "capture-only ingestion must not require Gold serving state"
        ),
    )
    monkeypatch.setattr(
        cli,
        "capture_realtime_feed",
        lambda *args, **kwargs: SimpleNamespace(display_dict=lambda: {"realtime_snapshot_id": 71}),
    )
    result = runner.invoke(cli.app, ["capture-realtime", "stm", "trip_updates"])
    assert result.exit_code == 0, result.output
    assert json.loads(result.stdout)["realtime_snapshot_id"] == 71


@pytest.mark.parametrize("fail_second", [False, True])
def test_archive_helper_freezes_all_ids_before_loading_and_reuses_scope(monkeypatch, fail_second):
    selection = [71, 72]
    calls = []
    scopes = []
    receipts = {71: receipt(), 72: receipt(72, "vehicle_positions")}

    class Scope:
        def __init__(self, *args, **kwargs):
            self.closed = False
            scopes.append(self)

        def resolve(self, backend):
            return self

        def close(self):
            self.closed = True

    class Connection:
        def execute(self, statement, params):
            calls.append("select")
            assert params == {
                "provider_id": "stm",
                "endpoint_keys": ("trip_updates", "vehicle_positions"),
            }
            return SimpleNamespace(
                mappings=lambda: SimpleNamespace(
                    all=lambda: [
                        {"endpoint_key": "trip_updates", "realtime_snapshot_id": selection[0]},
                        {"endpoint_key": "vehicle_positions", "realtime_snapshot_id": selection[1]},
                    ]
                )
            )

    engine = SimpleNamespace(connect=lambda: nullcontext(Connection()))

    def load(provider_id, endpoint_key, *, snapshot_id, bronze_storage_resolver, **kwargs):
        calls.append(snapshot_id)
        assert bronze_storage_resolver.__self__ is scopes[0]
        selection[1] = 99
        if fail_second and snapshot_id == 72:
            raise ValueError("second archive invalid")
        return receipts[snapshot_id]

    monkeypatch.setattr(silver, "BronzeStorageScope", Scope)
    monkeypatch.setattr(silver, "_load_realtime_to_silver", load)

    def apply():
        return silver.load_latest_realtime_snapshots_to_silver(
            "stm",
            ("trip_updates", "vehicle_positions"),
            settings=Settings(_env_file=None),
            registry=object(),
            engine=engine,
        )

    if fail_second:
        with pytest.raises(ValueError, match="second archive invalid"):
            apply()
    else:
        result = apply()
        assert result == list(receipts.values())
        assert result[0] is receipts[71]
    assert calls == ["select", 71, 72]
    assert len(scopes) == 1 and scopes[0].closed


def test_archive_helper_has_no_database_or_storage_work_without_rt_endpoints(monkeypatch):
    monkeypatch.setattr(
        silver,
        "BronzeStorageScope",
        lambda *args, **kwargs: pytest.fail("no storage needed without endpoints"),
    )
    assert (
        silver.load_latest_realtime_snapshots_to_silver(
            "stm",
            (),
            settings=Settings(_env_file=None),
            registry=object(),
            engine=object(),
        )
        == []
    )


def test_archive_helper_omits_lanes_without_archives_without_opening_storage(monkeypatch):
    calls = []

    class Connection:
        def execute(self, statement, params):
            calls.append(params)
            return SimpleNamespace(mappings=lambda: SimpleNamespace(all=lambda: []))

    monkeypatch.setattr(
        silver,
        "BronzeStorageScope",
        lambda *args, **kwargs: pytest.fail("no storage needed without archives"),
    )
    result = silver.load_latest_realtime_snapshots_to_silver(
        "stm",
        ("trip_updates", "vehicle_positions"),
        settings=Settings(_env_file=None),
        registry=object(),
        engine=SimpleNamespace(connect=lambda: nullcontext(Connection())),
    )
    assert result == []
    assert len(calls) == 1


def test_archive_helper_refuses_non_rt_lanes_before_access():
    with pytest.raises(ValueError, match="supports trip_updates and vehicle_positions"):
        silver.load_latest_realtime_snapshots_to_silver(
            "stm",
            ("service_alerts",),
            settings=object(),
            registry=object(),
            engine=object(),
        )


def test_refresh_help_explains_strict_bootstrap_and_partial_silver_recovery():
    result = runner.invoke(cli.app, ["refresh-gold-realtime", "--help"])
    assert result.exit_code == 0
    help_text = " ".join(result.stdout.replace("│", " ").split())
    assert "newest successful capture" in help_text
    assert "only when its archive verifies" in help_text
    assert "older bootstrap" in help_text
    assert "replay-realtime-silver --silver-only" in help_text
