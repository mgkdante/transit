import hashlib
import json
import os
import shutil
import time
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

import pytest
import revision_2_seed as seed
from revision_2_allowlist import (
    FILE_RULES,
    clock_rewrite,
    compare_with_baseline,
    revision_2_projection,
)
from snapshot_storage_fixtures import MemorySnapshotStore
from sqlalchemy import Engine, text

from transit_ops import settings as settings_module
from transit_ops.settings import Settings
from transit_ops.snapshots import historic_tier, publish
from transit_ops.snapshots.builders.historic import (
    line_history,
    network_history,
    network_trend,
    provenance,
    stop_history,
)


def test_a_listed_new_file_family_is_accepted_and_an_unlisted_one_fails():
    baseline = {"live/trips.json": b'{"trips":{}}'}
    allowed = {"status/capabilities.json": b'{"methodology_version":"capabilities-1"}'}
    assert compare_with_baseline(baseline, baseline | allowed) == []
    for extra in (
        {"status/capabilities.json": b'{"methodology_version":"wrong"}'},
        {"status/capabilities.json": b"{}"},
        {"status/other.json": b"{}"},
    ):
        assert len(compare_with_baseline(baseline, baseline | extra)) == 1
    assert compare_with_baseline(baseline, {}) == ["live/trips.json: missing baseline file"]
    assert compare_with_baseline(baseline, {"live/trips.json": b"{}"})


@pytest.mark.parametrize(
    "key,base,added",
    [
        (
            "static/routes_index.json",
            {"routes": [{"id": "x"}]},
            {"routes": [{"id": "x", "live_data": None, "r3": {"count": 4}}]},
        ),
        ("static/stops_index.json", {"stops": [{"id": "x"}]}, {"stops": [{"id": "x", "r3": {}}]}),
        ("static/stops/x.json", {"id": "x"}, {"id": "x", "wheelchair_boarding": None}),
        ("static/routes/x.json", {"id": "x"}, {"id": "x", "r3": {}}),
        (
            "live/trips.json",
            {"trips": {"x": {"stops": []}}},
            {
                "trips": {
                    "x": {
                        "stops": [],
                        "r3": {},
                        "headsign": None,
                        "direction_id": 0,
                        "first_departure": "25:00:00",
                        "first_departure_seconds": 90000,
                    }
                }
            },
        ),
        ("live/vehicles.json", {"vehicles": [{"id": "x"}]}, {"vehicles": [{"id": "x", "r3": {}}]}),
        ("live/network.json", {"value": None}, {"value": None, "r3": {}}),
        ("live/alerts.json", {"alerts": [{"id": "x"}]}, {"alerts": [{"id": "x", "r3": {}}]}),
        (
            "manifest.json",
            {"files": {"historic": {"ttl_s": 10}}},
            {
                "files": {
                    "historic": {
                        "ttl_s": 10,
                        "data_through": None,
                        "published_utc": "now",
                        "next_publish_utc": "later",
                    }
                }
            },
        ),
        ("historic/receipts/day.json", {"value": [2, 1]}, {"value": [2, 1]}),
        ("provenance.json", {"value": None}, {"value": None}),
        ("providers.json", {"providers": []}, {"providers": []}),
    ],
)
def test_projection_removes_exactly_the_allowlisted_additions(key, base, added):
    original = deepcopy(added)
    projected = revision_2_projection(key, added)
    assert projected == base
    assert added == original
    assert projected is not added


def test_projection_keeps_an_unlisted_flat_field():
    payload = {"headsign": "root", "trips": {"x": {"foo": 7, "headsign": "entry"}}}
    assert revision_2_projection("live/trips.json", payload) == {
        "headsign": "root",
        "trips": {"x": {"foo": 7}},
    }


@pytest.mark.parametrize(
    "key",
    [
        "historic/day.json",
        "providers.json",
        "unknown.json",
        "static/stops/x.json",
        "live/trips.json",
    ],
)
def test_projection_refuses_r3_where_the_table_does_not_allow_it(key):
    with pytest.raises(AssertionError, match=rf"{key}.*nested.r3"):
        revision_2_projection(key, {"nested": {"r3": {}}})


def test_every_file_rule_names_a_published_family():
    # Manifest paths and publish.py's static entity paths, plus the catalog writer.
    from transit_ops.snapshots.contract import ManifestHistoricFiles, ManifestStaticFiles

    known = {
        "manifest.json",
        "providers.json",
        "live/trips.json",
        "live/vehicles.json",
        "live/network.json",
        "live/alerts.json",
        "static/routes/{id}.json",
        "static/stops/{id}.json",
        "historic/**",
    }
    for model in (ManifestHistoricFiles, ManifestStaticFiles):
        known.update(
            field.default
            for field in model.model_fields.values()
            if isinstance(field.default, str) and field.default.endswith(".json")
        )
    assert all(rule.pattern in known for rule in FILE_RULES)


# Real database: two seeded providers published at this commit (revision_2_seed).
BASELINE = Path(__file__).parent / "fixtures" / "revision_2_baseline"
WRITE_BASELINE = "TRANSIT_WRITE_REVISION_2_BASELINE"
LANES = ("static", "historic", "live")


@dataclass
class Published:
    engine: Engine
    settings: Settings
    t0: datetime
    results: dict[str, dict[str, publish.PublishResult]]
    files: dict[str, dict[str, bytes]]
    lane_of: dict[str, str]


def _publish(engine, settings, provider_id: str, tier: str):
    if tier == "live":  # Each live publication starts from the same state.
        with engine.begin() as conn:
            conn.execute(
                text(
                    "DELETE FROM core.snapshot_publish_state WHERE provider_id=:p AND tier='live'"
                ),
                {"p": provider_id},
            )
    store = MemorySnapshotStore()
    result = publish.publish_snapshot(
        provider_id, tier=tier, settings=settings, engine=engine, storage=store
    )
    # _meta holds the hash gate's own state, which is not served.
    return result, {k: v for k, v in store.objects.items() if not k.startswith("_meta/")}


def _canonical(key: str, body: bytes, t0: datetime | None) -> bytes:
    value = clock_rewrite(key, revision_2_projection(key, json.loads(body)), t0)
    return (json.dumps(value, ensure_ascii=False, indent=1) + "\n").encode()


def _pin(monkeypatch, clock: datetime) -> None:
    for module in (publish, historic_tier):
        monkeypatch.setattr(module, "utc_now", lambda: clock)


@pytest.fixture(scope="module")
def published(real_db_engine, tmp_path_factory):
    engine, root = real_db_engine, tmp_path_factory.mktemp("bronze")
    settings = seed.settings_for(root)
    seed.delete_rows(engine)
    run = Published(engine, settings, seed.HISTORY_CLOCK, {}, {}, {})
    with pytest.MonkeyPatch.context() as monkeypatch:
        # These builders read the process settings, not the ones passed to publish.
        for module in (line_history, network_history, network_trend, provenance, stop_history):
            monkeypatch.setattr(module, "get_settings", lambda: settings)
        monkeypatch.setattr(settings_module, "get_settings", lambda: settings)
        try:
            seed.seed_history(engine, settings, root)
            _pin(monkeypatch, seed.HISTORY_CLOCK)
            for tier in LANES:
                if tier == "live":
                    with engine.connect() as conn:
                        run.t0 = conn.execute(text("SELECT date_trunc('second', now())")).scalar()
                    seed.seed_live(engine, settings, root, run.t0)
                    _pin(monkeypatch, run.t0)
                for label, provider_id in seed.PROVIDERS.items():
                    result, files = _publish(engine, settings, provider_id, tier)
                    run.results.setdefault(label, {})[tier] = result
                    assert not files.keys() & run.files.setdefault(label, {}).keys()
                    run.files[label] |= files
                    run.lane_of |= dict.fromkeys(files, tier)
            yield run
        finally:
            seed.delete_rows(engine)
            assert seed.remaining_rows(engine) == {}


def _projected(run: Published, label: str) -> dict[str, bytes]:
    return {
        key: _canonical(key, body, run.t0 if run.lane_of[key] == "live" else None)
        for key, body in run.files[label].items()
    }


def _first_difference(old, new, path="$"):
    if isinstance(old, dict) and isinstance(new, dict):
        if old.keys() == new.keys() and list(old) != list(new):
            return f"{path} (key order)"
        for key in dict.fromkeys([*old, *new]):
            if key not in old or key not in new:
                return f"{path}.{key}"
            if found := _first_difference(old[key], new[key], f"{path}.{key}"):
                return found
        return None
    if isinstance(old, list) and isinstance(new, list):
        for index, (a, b) in enumerate(zip(old, new, strict=False)):
            if found := _first_difference(a, b, f"{path}[{index}]"):
                return found
        return None if len(old) == len(new) else f"{path}[{min(len(old), len(new))}]"
    return None if old == new else path


def _write_baseline(label: str, files: dict[str, bytes]) -> None:
    shutil.rmtree(BASELINE / label, ignore_errors=True)
    for key, body in files.items():
        target = BASELINE / label / key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(body)
    digests = {key: hashlib.sha256(files[key]).hexdigest() for key in sorted(files)}
    # Beside the folder: a MANIFEST.json inside it would collide with the published
    # manifest.json on case-insensitive file systems.
    (BASELINE / f"{label}.MANIFEST.json").write_bytes(
        json.dumps(digests, indent=1).encode() + b"\n"
    )


def _read_baseline(label: str) -> dict[str, bytes]:
    digests = json.loads((BASELINE / f"{label}.MANIFEST.json").read_bytes())
    files = {key: (BASELINE / label / key).read_bytes() for key in digests}
    assert {k: hashlib.sha256(v).hexdigest() for k, v in files.items()} == digests
    return files


def test_publish_succeeds_at_this_commit(published):
    for label, lanes in published.results.items():
        assert set(lanes) == set(LANES)
        for tier, result in lanes.items():
            report = result.gate_report
            assert report is not None and report["errors"] == 0, (label, tier, report)
        assert published.files[label]
        assert not [key for key in published.files[label] if "r3" in key.split("/")]


def test_revision_2_projection_is_unchanged(published):
    if os.environ.get(WRITE_BASELINE) == "1":
        for label in seed.PROVIDERS:
            _write_baseline(label, _projected(published, label))
        pytest.fail(f"baseline written; run again without {WRITE_BASELINE}")
    problems = []
    for label in seed.PROVIDERS:
        baseline, current = _read_baseline(label), _projected(published, label)
        for message in compare_with_baseline(baseline, current):
            key = message.split(": ", 1)[0]
            if key in baseline and key in current:
                old, new = json.loads(baseline[key]), json.loads(current[key])
                message += f" at {_first_difference(old, new)}"
            problems.append(f"{label}/{message}")
    assert problems == []


def test_live_bytes_are_stable_across_two_runs(published):
    time.sleep(3)
    for label, provider_id in seed.PROVIDERS.items():
        _result, files = _publish(published.engine, published.settings, provider_id, "live")
        first = {k: v for k, v in _projected(published, label).items() if k in files}
        second = {key: _canonical(key, body, published.t0) for key, body in files.items()}
        assert first.keys() == second.keys()
        assert [key for key in first if first[key] != second[key]] == []
