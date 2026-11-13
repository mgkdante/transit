"""The compatibility boundary shared by the revision 2 publication guards."""

import json
import re
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timedelta


@dataclass(frozen=True)
class FileRule:
    pattern: str
    flat_additions: tuple[str, ...] = ()
    r3_allowed_at: tuple[str, ...] = ()


FILE_RULES: tuple[FileRule, ...] = (
    FileRule("static/routes_index.json", ("routes[*].live_data",), ("routes[*]",)),
    FileRule("static/stops_index.json", (), ("stops[*]",)),
    FileRule("static/stops/{id}.json", ("wheelchair_boarding",)),
    FileRule("static/routes/{id}.json", (), ("",)),
    FileRule(
        "live/trips.json",
        tuple(
            f"trips[*].{p}"
            for p in ("headsign", "direction_id", "first_departure", "first_departure_seconds")
        ),
        ("trips[*]",),
    ),
    FileRule("live/vehicles.json", (), ("vehicles[*]",)),
    FileRule("live/network.json", (), ("",)),
    FileRule("live/alerts.json", (), ("alerts[*]",)),
    FileRule(
        "manifest.json",
        tuple(f"files.historic.{p}" for p in ("data_through", "published_utc", "next_publish_utc")),
    ),
    FileRule("historic/**"),
    FileRule("provenance.json"),
    FileRule("providers.json"),
)
NEW_FILE_FAMILIES: Mapping[str, str] = {"status/capabilities.json": "capabilities-1"}


@dataclass(frozen=True)
class ClockValue:
    """A value the database computes from its own now(): its type, bound and reason."""

    kind: type
    reason: str
    below: int | None = None  # an age in seconds must lie in [0, below)


_LIVE_AGE = 3600  # live captures are seconds old when they are published
_FIXED_AGE = 36500 * 86400  # ages of the fixed 2025 stamps stay below the seeded retention
# Masked as "<clock>" in every lane; null stays null. The test asserts the alert window's
# width and end before the mask.
CLOCK_PATHS: Mapping[str, Mapping[str, ClockValue]] = {
    "live/network.json": {
        "feed_freshness_s": ClockValue(
            int, "now() minus the newest capture (live.py:442)", _LIVE_AGE
        )
    },
    "status/data_health.json": {
        "lanes[*].age_s": ClockValue(
            int, "now() minus each lane's stamp (live.py:667)", _FIXED_AGE
        ),
        "feeds[*].age_s": ClockValue(
            int, "now() minus each feed's capture (live.py:691)", _LIVE_AGE
        ),
    },
    "provenance.json": {
        "freshness[*].age_s": ClockValue(int, "now() minus each feed's run (0093:928)", _FIXED_AGE)
    },
}
_ENVELOPE = {
    "generated_utc": "the live stamp, utc_now() pinned to T0 (publish.py:425)",
    "publish_generation_id": "provider@ the live stamp (envelope.py:19)",
}
_FEED = {"feed_captured_utc": "the serving capture time, seeded from T0 (live.py:80)"}
# Live-lane times seeded from T0, written as exact offsets "T0+630s"; null stays null.
LIVE_TIME_PATHS: Mapping[str, Mapping[str, str]] = {
    "manifest.json": {
        "publish_generation_id": _ENVELOPE["publish_generation_id"],
        "files.live.generated_utc": _ENVELOPE["generated_utc"],
        "files.live.generations.*": "generation ids of the live stamp (publish.py:245)",
        **{
            f"files.live.input_captures.{feed}": "each live feed's seeded capture (publish.py:244)"
            for feed in ("trip_updates", "vehicle_positions", "i3_alerts")
        },
    },
    "status/data_health.json": _ENVELOPE,
    "live/network.json": _ENVELOPE,
    "live/trips.json": _ENVELOPE | _FEED | {"trips.*.stops[*].eta_utc": "seeded arrival times"},
    "live/stop_departures.json": _ENVELOPE | _FEED | {"stops.*[*].eta_utc": "seeded arrivals"},
    "live/vehicles.json": _ENVELOPE
    | {
        "vehicles[*].updated_utc": "the seeded vehicle capture (live.py:174)",
        "vehicles[*].reported_utc": "the seeded position timestamp (live.py:175)",
    },
    "live/alerts.json": _ENVELOPE
    | _FEED
    | {
        f"alerts[*].{path}": "seeded alert capture and active periods"
        for path in (
            "message.captured_utc",
            "start_utc",
            "end_utc",
            "active_periods[*].start_utc",
            "active_periods[*].end_utc",
        )
    },
}


def _offset(value: str, t0: datetime) -> str:
    head, at, stamp = value.rpartition("@")
    delta = datetime.fromisoformat(stamp.replace("Z", "+00:00")) - t0
    micros = delta // timedelta(microseconds=1)
    seconds = f"{abs(micros) // 10**6}.{abs(micros) % 10**6:06d}".rstrip("0").rstrip(".")
    return f"{head}{at}T0{'-' if micros < 0 else '+'}{seconds}s"


def _hit(patterns: Mapping[str, object], path: tuple[str, ...]) -> object:
    for pattern, rule in patterns.items():
        parts = _parts(pattern)
        if len(parts) == len(path) and all(p in ("*", q) for p, q in zip(parts, path, strict=True)):
            return rule
    return None


def clock_rewrite(rel_key: str, payload: object, t0: datetime | None = None) -> object:
    """Mask CLOCK_PATHS; with the live lane's T0, write LIVE_TIME_PATHS as offsets from it."""
    masked = CLOCK_PATHS.get(rel_key, {})
    timed = LIVE_TIME_PATHS.get(rel_key, {}) if t0 is not None else {}

    def visit(value, path=()):
        clock, time = _hit(masked, path), _hit(timed, path)
        if value is None or not (clock or time):
            pass
        elif isinstance(clock, ClockValue):
            ok = isinstance(value, clock.kind) and not isinstance(value, bool)
            if ok and clock.below is not None:
                ok = 0 <= value < clock.below
            assert ok, f"{rel_key}: {'.'.join(path)} holds {value!r}"
            return "<clock>"
        else:
            assert isinstance(value, str) and t0, f"{rel_key}: {'.'.join(path)} holds {value!r}"
            return _offset(value, t0)
        if isinstance(value, dict):
            return {key: visit(child, (*path, key)) for key, child in value.items()}
        if isinstance(value, list):
            return [visit(child, (*path, "*")) for child in value]
        return value

    return visit(payload)


def _matches(pattern: str, path: str) -> bool:
    expression = (
        re.escape(pattern)
        .replace(r"\{id\}", "[^/]+")
        .replace(r"\{date\}", "[^/]+")
        .replace(r"\*\*", ".*")
    )
    return re.fullmatch(expression, path) is not None


def _rule(key: str) -> FileRule:
    return next((r for r in FILE_RULES if _matches(r.pattern, key)), FileRule(key))


def _parts(path: str) -> tuple[str, ...]:
    return tuple(path.replace("[*]", ".*").split(".")) if path else ()


def revision_2_projection(rel_key: str, payload: object) -> object:
    rule = _rule(rel_key)
    flat = {_parts(p) for p in rule.flat_additions}
    r3 = {_parts(p) for p in rule.r3_allowed_at}

    def visit(value, path=(), location="$", wildcard=False):
        if isinstance(value, list):
            return [visit(v, (*path, "*"), f"{location}[{i}]") for i, v in enumerate(value)]
        if not isinstance(value, dict):
            return deepcopy(value)
        result = {}
        for key, child in value.items():
            child_path = (*path, "*" if wildcard else key)
            if key == "r3" and not wildcard:
                assert path in r3, f"{rel_key}: unexpected r3 at {location}.r3"
            elif child_path not in flat:
                # Map keys are identities, even when an identity happens to be 'r3'.
                is_map = any(p[: len(child_path) + 1] == (*child_path, "*") for p in flat | r3)
                result[key] = visit(
                    child, child_path, f"{location}.{key}", is_map and isinstance(child, dict)
                )
        return result

    return visit(payload)


def compare_with_baseline(
    baseline: Mapping[str, bytes], published: Mapping[str, bytes]
) -> list[str]:
    """Compare bytes already projected by the caller; new families retain their envelope."""
    problems = [
        f"{key}: missing baseline file" for key in sorted(baseline.keys() - published.keys())
    ]
    for key in sorted(published):
        if key in baseline:
            if baseline[key] != published[key]:
                problems.append(f"{key}: projected bytes differ")
            continue
        token = next((v for p, v in NEW_FILE_FAMILIES.items() if _matches(p, key)), None)
        try:
            payload = json.loads(published[key])
        except (ValueError, UnicodeError):
            payload = None
        if (
            token is None
            or not isinstance(payload, dict)
            or payload.get("methodology_version") != token
        ):
            problems.append(f"{key}: unlisted family or wrong methodology_version")
    return problems


def _schema_nodes(root, node, parts):
    if "$ref" in node:
        node = root["$defs"][node["$ref"].removeprefix("#/$defs/")]
    if not parts:
        yield node
    elif "anyOf" in node:
        for option in node["anyOf"]:
            yield from _schema_nodes(root, option, parts)
    elif parts[0] == "*":
        child = node.get("items", node.get("additionalProperties"))
        if isinstance(child, dict):
            yield from _schema_nodes(root, child, parts[1:])
    elif parts[0] in node.get("properties", {}):
        yield from _schema_nodes(root, node["properties"][parts[0]], parts[1:])


def _refs(value):
    if isinstance(value, dict):
        if "$ref" in value:
            yield value["$ref"].removeprefix("#/$defs/")
        for child in value.values():
            yield from _refs(child)
    elif isinstance(value, list):
        for child in value:
            yield from _refs(child)


def _differences(old, new, path):
    if isinstance(old, dict) and isinstance(new, dict):
        for key in sorted(old.keys() | new.keys()):
            location = f"{path}.{key}"
            if key not in old or key not in new:
                yield location
            else:
                yield from _differences(old[key], new[key], location)
    elif old != new:
        yield path


def _project_schema(old, new, rule):
    projected = deepcopy(new)
    allowed = (*rule.flat_additions, *(f"{p}.r3" if p else "r3" for p in rule.r3_allowed_at))
    removed = []
    for path in allowed:
        parts = _parts(path)
        old_nodes = list(_schema_nodes(old, old, parts[:-1]))
        new_nodes = list(_schema_nodes(projected, projected, parts[:-1]))
        for before, after in zip(old_nodes, new_nodes, strict=True):
            prop = parts[-1]
            if (
                prop not in before.get("properties", {})
                and prop in after.get("properties", {})
                and prop not in after.get("required", [])
            ):
                removed.append(after["properties"].pop(prop))
    extra = projected.get("$defs", {}).keys() - old.get("$defs", {}).keys()
    # Only definitions reachable from removed properties may disappear with them.
    reached = set(_refs(removed)) & extra
    pending = list(reached)
    while pending:
        for ref in set(_refs(projected["$defs"][pending.pop()])) & extra - reached:
            reached.add(ref)
            pending.append(ref)
    remaining = deepcopy(projected)
    for name in extra:
        del remaining["$defs"][name]
    forbidden = set(_refs(remaining)) & extra
    for name in reached - forbidden:
        del projected["$defs"][name]
    if not projected.get("$defs") and "$defs" not in old:
        projected.pop("$defs", None)
    return projected


def compare_schemas_with_baseline(baseline: Mapping, exported: Mapping) -> list[str]:
    problems = []
    for name in sorted(baseline.keys() | exported.keys()):
        if name not in exported:
            problems.append(f"{name}: $ missing schema")
        elif name not in baseline:
            # Export names use the family name, without its directory or suffix.
            if not any(
                name == p.rsplit("/", 1)[-1].removesuffix(".json") for p in NEW_FILE_FAMILIES
            ):
                problems.append(f"{name}: $ unlisted schema")
        else:
            # Per-entity schemas use singular names (static_route, static_stop).
            rule = next(
                (
                    r
                    for r in FILE_RULES
                    if r.pattern.replace("s/{id}", "").replace("/", "_").removesuffix(".json")
                    == name
                ),
                None,
            )
            try:
                projected = _project_schema(baseline[name], exported[name], rule or FileRule(name))
                problems.extend(_differences(baseline[name], projected, f"{name}: $"))
            except (KeyError, ValueError) as exc:
                problems.append(f"{name}: $ invalid schema path: {exc}")
    return problems
