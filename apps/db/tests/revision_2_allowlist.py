"""The compatibility boundary shared by the revision 2 publication guards."""

import json
import re
from collections.abc import Mapping
from copy import deepcopy
from dataclasses import dataclass
from datetime import UTC, date, datetime, timedelta


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

# Values the database computes from its own now(); masked as "<clock>" in every lane.
CLOCK_PATHS: Mapping[str, Mapping[str, str]] = {
    "live/network.json": {"feed_freshness_s": "now() minus the newest capture (live.py:442)"},
    "status/data_health.json": {
        "lanes[*].age_s": "now() minus each lane's publication (live.py:667)",
        "feeds[*].age_s": "now() minus each feed's capture (live.py:691)",
    },
    "provenance.json": {"freshness[*].age_s": "now() minus each feed's run (0093 migration:928)"},
    "historic/alert_history.json": {
        "window_start": "the database's local date minus the retention (small_surfaces.py:890)",
        "window_end": "the database's local date (small_surfaces.py:890)",
    },
}
# Live times are seeded within minutes of T0; fixed history stamps lie more than a year away.
CLOCK_HORIZON = timedelta(days=30)
_STAMP = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})")
_DATE = re.compile(r"\d{4}-\d{2}-\d{2}")


def clock_rewrite(rel_key: str, payload: object, t0: datetime | None = None) -> object:
    """Mask CLOCK_PATHS; with the live lane's T0, write nearby times as offsets from it."""
    masked = {_parts(p) for p in CLOCK_PATHS.get(rel_key, {})}

    def stamp(match: re.Match[str]) -> str:
        assert t0 is not None
        offset = datetime.fromisoformat(match.group().replace("Z", "+00:00")) - t0
        return (
            f"T0{round(offset.total_seconds()):+d}s" if abs(offset) <= CLOCK_HORIZON else match[0]
        )

    def visit(value, path=()):
        if path in masked:
            return "<clock>"
        if isinstance(value, dict):
            return {key: visit(child, (*path, key)) for key, child in value.items()}
        if isinstance(value, list):
            return [visit(child, (*path, "*")) for child in value]
        if t0 is None or not isinstance(value, str):
            return value
        if _DATE.fullmatch(value):
            days = (date.fromisoformat(value) - t0.astimezone(UTC).date()).days
            return f"D0{days:+d}" if abs(days) <= CLOCK_HORIZON.days else value
        return _STAMP.sub(stamp, value)

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
