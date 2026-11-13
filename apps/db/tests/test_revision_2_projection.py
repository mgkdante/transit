import hashlib
import json
import os
import re
import shutil
import time
from contextlib import ExitStack
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta
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
from transit_ops.gold import rollups
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


def test_clock_rewrite_keeps_absence_and_touches_only_listed_paths():
    t0 = datetime(2026, 11, 13, 12, tzinfo=UTC)
    payload = {"generated_utc": "2026-11-13T12:00:00.5Z", "feed_freshness_s": None}
    payload["note"] = "2026-11-13T12:00:00Z"
    assert clock_rewrite("live/network.json", payload, t0) == {
        "generated_utc": "T0+0.5s",
        "feed_freshness_s": None,
        "note": "2026-11-13T12:00:00Z",
    }
    for wrong in ("5", 3600, -1, True):
        with pytest.raises(AssertionError, match="feed_freshness_s"):
            clock_rewrite("live/network.json", {"feed_freshness_s": wrong}, t0)


# Real database: two seeded providers published at this commit (revision_2_seed).
BASELINE = Path(__file__).parent / "fixtures" / "revision_2_baseline"
WRITE_BASELINE = "TRANSIT_WRITE_REVISION_2_BASELINE"
LANES = ("static", "historic", "live")


@dataclass
class Published:
    engine: Engine
    historic_engine: Engine
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


def test_the_pinned_clock_reaches_only_its_engine(real_db_engine):
    with seed.pinned_engine(real_db_engine, seed.HISTORY_CLOCK) as pinned:
        for _ in range(2):  # Returning to the pool must not roll back the session setting.
            with pinned.connect() as conn:
                assert conn.execute(text("SELECT now()")).scalar_one() == seed.HISTORY_CLOCK
                assert conn.execute(text(
                    "SELECT timezone('America/Toronto', now())::date"
                )).scalar_one() == date(2025, 9, 2)
                assert conn.execute(text("SELECT CURRENT_DATE")).scalar_one() != date(2025, 9, 2)
        with real_db_engine.connect() as conn:
            delta = conn.execute(text("SELECT clock_timestamp() - now()")).scalar_one()
            assert abs(delta) < timedelta(minutes=1)


def test_date_bounded_windows_follow_the_pinned_date(published):
    days = {day.isoformat() for day in seed.DAYS}
    recent = {day for day in days if day >= "2025-06-04"}
    weeks = {(day - timedelta(days=day.weekday())).isoformat() for day in seed.DAYS}
    months = {day.replace(day=1).isoformat() for day in seed.DAYS}
    for files in published.files.values():
        trend = json.loads(files["historic/network_trend.json"])
        for grain, expected in (("series", recent), ("weekly", weeks), ("monthly", months)):
            assert {p["date"] for p in trend[grain] if p["otp_pct"] is not None} == expected
        for key, body in files.items():
            if key in {f"historic/stop_reliability/{stop}.json" for stop in seed.STOPS}:
                assert {p["date"] for p in json.loads(body)["daily"]} == recent
            if key in {f"historic/route_reliability/{route}.json" for route, *_ in seed.ROUTES}:
                occupancy = json.loads(body)["occupancy_by_dow"]
                assert {p["day_of_week_iso"] for p in occupancy} == {
                    date(2025, 8, 3).isoweekday(), date(2025, 8, 19).isoweekday()
                }
                assert all(p["n"] == 2 for p in occupancy)
        receipts = json.loads(files["historic/receipts/index.json"])
        leaves = {
            key.removeprefix("historic/receipts/").removesuffix(".json")
            for key in files
            if re.fullmatch(r"historic/receipts/\d{4}-\d{2}-\d{2}\.json", key)
        }
        assert set(receipts["dates"]) == leaves == days


@pytest.fixture(scope="module")
def published(real_db_engine, tmp_path_factory):
    engine, root = real_db_engine, tmp_path_factory.mktemp("bronze")
    settings = seed.settings_for(root)
    with engine.connect() as conn:
        zone = conn.execute(text("SHOW TimeZone")).scalar_one()
        assert zone in ("UTC", "Etc/UTC"), f"TimeZone must be UTC or Etc/UTC; got {zone}"
    seed.delete_rows(engine)
    with pytest.MonkeyPatch.context() as monkeypatch, ExitStack() as stack:
        # The baseline was generated when the percentile lookback followed retention.
        # Production keeps 13 days because its fact retention is 14 days.
        monkeypatch.setattr(rollups, "PERCENTILE_LOOKBACK_DAYS", seed.RETENTION_DAYS - 1)
        # These builders read the process settings, not the ones passed to publish.
        for module in (line_history, network_history, network_trend, provenance, stop_history):
            monkeypatch.setattr(module, "get_settings", lambda: settings)
        monkeypatch.setattr(settings_module, "get_settings", lambda: settings)
        try:
            seed.seed_history(engine, settings, root)
            historic_engine = stack.enter_context(seed.pinned_engine(engine, seed.HISTORY_CLOCK))
            run = Published(engine, historic_engine, settings, seed.HISTORY_CLOCK, {}, {}, {})
            _pin(monkeypatch, seed.HISTORY_CLOCK)
            for tier in LANES:
                if tier == "live":
                    with engine.connect() as conn:
                        run.t0 = conn.execute(text("SELECT date_trunc('second', now())")).scalar()
                    seed.seed_live(engine, settings, root, run.t0)
                    _pin(monkeypatch, run.t0)
                for label, provider_id in seed.PROVIDERS.items():
                    lane_engine = historic_engine if tier == "historic" else engine
                    result, files = _publish(lane_engine, settings, provider_id, tier)
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
    for label in seed.PROVIDERS:
        window = json.loads(published.files[label]["historic/alert_history.json"])
        end, start = (date.fromisoformat(window[k]) for k in ("window_end", "window_start"))
        assert end.isoformat() == "2025-09-02"
        assert (end - start).days == published.settings.SILVER_I3_CLOSED_RETENTION_DAYS
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
        first = {
            k: v for k, v in _projected(published, label).items() if published.lane_of[k] == "live"
        }
        second = {key: _canonical(key, body, published.t0) for key, body in files.items()}
        assert first.keys() == second.keys()
        assert [key for key in first if first[key] != second[key]] == []


# Published outputs this baseline holds empty by construction: family -> path -> cause.
# A later packet that edits the builder behind an entry is not guarded by this baseline there.
_NETWORK_LEVEL = "a network-level collection names no entity"
_GAP = {
    path: "the builder sets no gap reason (history_common.py:769)"
    for path in ("gaps[*].reason", "metrics[*].gaps[*].reason")
}
_FLOOR = "no entity reaches MIN_N_RATE observations (ranking_kernel.py:28)"
_SPAN = "built a capture day late; no seeded capture day has a successor"
_HOT_TRAY = {
    f"by_grain[*].tray[*].{k}": "the unranked tray sets none (ranking_kernel.py:122)"
    for k in ("rank", "issue_count", "otp_delta_pts", "severity", "wilson_lo", "wilson_hi")
} | {"by_grain[*].entries": _FLOOR}
_OFFENDER_TRAY = {
    f"by_grain[*].tray[*].{k}": "the unranked tray sets none (ranking_kernel.py:323)"
    for k in ("rank", "wilson_lo", "wilson_hi")
} | {"by_grain[*].entries": _FLOOR}
_WINDOWED = "windowed periods are built without date and histogram (_spine.py:284)"
UNGUARDED: dict[str, dict[str, str]] = {
    "historic/network_trend.json": {
        f"{g}[*].{m}": "built without the fact query (network_trend.py:301-314)"
        for g in ("weekly", "monthly")
        for m in ("p90_min", "vehicles")
    },
    "historic/receipts/{date}.json": {"vehicles": "always null (small_surfaces.py:799)"},
    "historic/route_reliability/{id}.json": {
        "headway": "one trip per route, direction, service date and shift (rollups.py:1472-1473)",
        "headway_by_grain": "needs two trips of a route direction at one stop and shift",
        "weak_stops_by_grain": "no stop reaches the Wilson floor in its window (_spine.py:545)",
        "service_spans": _SPAN,
        "habits_by_grain[*].habits": "no hour cell reaches 30 observations (_spine.py:145)",
        **{
            f"periods[*].prior_{k}": "prior attaches only to periods_by_grain (_spine.py:326)"
            for k in ("observation_count", "on_time", "otp_pct")
        },
        **{
            f"periods_by_grain[*].{g}[*].{k}": _WINDOWED
            for g in ("by_shift", "by_daytype")
            for k in ("date", "delay_histogram")
        },
        **{
            f"weak_stops[*].{k}": "sets only id, name and delay (route_reliability.py:363)"
            for k in ("observation_count", "severe_pct", "wilson_lo", "wilson_hi")
        },
    },
    "historic/alert_history.json": {
        "alerts[*].impact_passages": "always null (small_surfaces.py:1016)"
    },
    "historic/alerts/generations/{h}/{date}/{id}.json": {
        "alerts[*].impact_passages": "always null (alert_archive.py:133)"
    },
    "historic/history/index.json": {f"families[*].{k}": v for k, v in _GAP.items()},
    "historic/history/network/generations/{h}/index.json": _GAP | {"entity_id": _NETWORK_LEVEL},
    "historic/history/lines/{id}/generations/{h}/index.json": _GAP,
    "historic/history/lines/{id}/generations/{h}/{date}.json": {"days[*].service_span": _SPAN},
    "historic/history/stops/{id}/generations/{h}/index.json": _GAP,
    "historic/history/hotspots/generations/{h}/index.json": {
        "gaps[*].reason": _GAP["gaps[*].reason"],
        "entity_id": _NETWORK_LEVEL,
        "metrics": "point collections declare no metrics",
    },
    "historic/history/hotspots/generations/{h}/{date}.json": _HOT_TRAY,
    "historic/history/repeat_offenders/generations/{h}/index.json": {
        "gaps[*].reason": _GAP["gaps[*].reason"],
        "entity_id": _NETWORK_LEVEL,
        "metrics": "point collections declare no metrics",
    },
    "historic/history/repeat_offenders/generations/{h}/{date}.json": _OFFENDER_TRAY
    | {
        "offenders": "needs severe delays on 3 days of its window; seeded days are 2 weeks apart",
    },
    "historic/hotspots.json": _HOT_TRAY,
    "historic/repeat_offenders.json": _OFFENDER_TRAY,
    "live/network.json": {"non_responding_by_route": "every running seeded trip has a trip update"},
    "manifest.json": {"basemap": "the invented providers have no registry entry"},
    "provenance.json": {
        "gaps": "the invented providers have no registry entry",
    },
    "static/routes/{id}.json": {"service_periods[*].headway_min": "one trip per direction"},
}
_ENVELOPE_KEYS = {"schema_version", "methodology_version", "publish_generation_id", "generated_utc"}


def _family(key: str) -> str:
    key = re.sub(r"[0-9a-f]{64}", "{h}", key)
    key = re.sub(r"\d{4}-\d{2}(-\d{2})?", "{date}", key)
    return re.sub(r"(?<=/)[\w-]*\d[\w-]*(?=/|\.json$)", "{id}", key)


def _real(value) -> bool:
    if isinstance(value, dict | list):
        return any(_real(child) for child in (value.values() if isinstance(value, dict) else value))
    return value is not None


def _at(value, parts):
    if not parts:
        yield value
    elif parts[0] == "*" and isinstance(value, dict | list):
        for child in value.values() if isinstance(value, dict) else value:
            yield from _at(child, parts[1:])
    elif isinstance(value, dict) and parts[0] in value:
        yield from _at(value[parts[0]], parts[1:])


def _sections(value, path=""):
    """Top-level keys, and every key of an object inside a list, at any depth."""
    if isinstance(value, dict):
        for key, child in value.items():
            here = f"{path}.{key}" if path else key
            if not path or path.endswith("[*]"):
                yield here
            yield from _sections(child, here)
    elif isinstance(value, list):
        for child in value:
            yield from _sections(child, f"{path}[*]")


def test_the_baseline_lists_every_output_it_does_not_guard():
    families: dict[str, list] = {}
    for label in seed.PROVIDERS:
        for key, body in _read_baseline(label).items():
            families.setdefault(_family(key), []).append(json.loads(body))
    problems = [f"{name}: listed but not published" for name in UNGUARDED.keys() - families.keys()]
    for name, payloads in sorted(families.items()):
        listed = UNGUARDED.get(name, {})
        sections = {path for payload in payloads for path in _sections(payload)}
        for path in sorted(sections - _ENVELOPE_KEYS | set(listed)):
            parts = path.replace("[*]", ".*").split(".")
            real = any(_real(value) for payload in payloads for value in _at(payload, parts))
            if real and path in listed:
                problems.append(f"{name}: {path} is listed but holds a value")
            elif not real and path not in listed:
                problems.append(f"{name}: {path} is empty and not listed")
    assert problems == []


def _history_graph(files):
    from transit_ops.snapshots import historic_tree

    root = historic_tree.HISTORY_ROOT_PATH
    assert root in files, f"missing root: {root}"
    record = {
        "root": {root: hashlib.sha256(files[root]).hexdigest()},
        "range_leaves": {},
        "point_leaves": {},
    }
    pending = [(ref["family"], ref["index_path"]) for ref in json.loads(files[root])["families"]]
    reached = {root}
    while pending:
        name, key = pending.pop()
        if key in reached:
            continue
        assert key in files, f"missing reachable object: {key}"
        reached.add(key)
        family = historic_tree.FAMILIES[name]
        matched = historic_tree.family_path_role(key)
        assert matched is not None, f"unknown history object: {key}"
        if matched[1] == "leaf":
            group = "range_leaves" if family.selection_mode == "range" else "point_leaves"
            record[group][key] = hashlib.sha256(files[key]).hexdigest()
        else:
            pending.extend((name, edge.path) for edge in family.edges(json.loads(files[key])))
    for group in ("range_leaves", "point_leaves"):
        record[group] = dict(sorted(record[group].items()))
        assert record[group], f"root reaches no {group}"
    return record


def _compare_history_graph(label, expected, current):
    assert expected.keys() == current.keys(), label
    for group in expected:
        old, new = expected[group], current[group]
        assert old.keys() == new.keys(), (
            label,
            group,
            "missing",
            sorted(old.keys() - new.keys()),
            "added",
            sorted(new.keys() - old.keys()),
        )
        for key in old:
            assert old[key] == new[key], f"{label}/{key}: changed {group} SHA-256"


class _HistoryGraphStore(MemorySnapshotStore):
    def _check_leaf(self, key, body):
        from transit_ops.snapshots import historic_tree

        matched = historic_tree.family_path_role(key)
        if matched is not None and matched[1] == "leaf" and key in self.objects:
            assert self.objects[key] == body, f"{key}: leaf rewritten with different bytes"

    def put_bytes(self, rel_key, body, *, tier):
        self._check_leaf(rel_key, body)
        return super().put_bytes(rel_key, body, tier=tier)

    def put_immutable_json_outcome(self, rel_key, payload):
        from transit_ops.snapshots.serialization import snapshot_json_bytes

        self._check_leaf(rel_key, snapshot_json_bytes(payload))
        return super().put_immutable_json_outcome(rel_key, payload)


@pytest.mark.parametrize("label", seed.PROVIDERS)
def test_revision_2_history_graph_is_reused(published, monkeypatch, label):
    _pin(monkeypatch, seed.HISTORY_CLOCK)
    provider_id = seed.PROVIDERS[label]
    store = _HistoryGraphStore()

    def publish_history():
        result = publish.publish_snapshot(
            provider_id,
            tier="historic",
            settings=published.settings,
            engine=published.historic_engine,
            storage=store,
        )
        assert result.gate_report is not None and result.gate_report["errors"] == 0

    # Select the fixture's first publication independently of any later output.
    original = {
        k: v for k, v in published.files[label].items() if published.lane_of[k] == "historic"
    }
    publish_history()
    first_files = {k: v for k, v in store.objects.items() if not k.startswith("_meta/")}
    first = _history_graph(first_files)
    _compare_history_graph(label, _history_graph(original), first)
    leaf_keys = first["range_leaves"].keys() | first["point_leaves"].keys()
    writes = [key for key in store.keys if key in leaf_keys]
    publish_history()
    second_files = {k: v for k, v in store.objects.items() if not k.startswith("_meta/")}
    _compare_history_graph(label, first, _history_graph(second_files))
    assert [key for key in store.keys if key in leaf_keys] == writes, "leaf written twice"
    target = BASELINE / label / "history_graph.json"
    if os.environ.get(WRITE_BASELINE) == "1":
        target.write_bytes((json.dumps(first, ensure_ascii=False, indent=1) + "\n").encode())
        pytest.fail(f"baseline written; run again without {WRITE_BASELINE}")
    assert target.is_file(), f"missing baseline: {label}/history_graph.json"
    _compare_history_graph(label, json.loads(target.read_bytes()), first)
