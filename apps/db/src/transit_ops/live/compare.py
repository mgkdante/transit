import json
import re
from collections.abc import Iterator, Mapping
from dataclasses import dataclass


@dataclass(frozen=True)
class Difference:
    key: str
    path: str
    expected: str
    actual: str


CLOCK_PATHS: Mapping[str, tuple[str, ...]] = {
    "*": ("generated_utc", "publish_generation_id"),
    "manifest.json": ("files.live.generated_utc", "files.live.generations.*"),
    "status/data_health.json": ("lanes[].age_s", "feeds[].age_s"),
    "live/network.json": ("feed_freshness_s",),
}
_ABSENT = object()


def _text(value: object) -> str:
    return (
        "<absent>"
        if value is _ABSENT
        else json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    )


def _leaves(expected: object, actual: object, path: str = "") -> Iterator[tuple[str, str, str]]:
    if isinstance(expected, dict) and isinstance(actual, dict):
        for key in dict.fromkeys([*expected, *actual]):
            yield from _leaves(
                expected.get(key, _ABSENT),
                actual.get(key, _ABSENT),
                f"{path}.{key}" if path else key,
            )
    elif isinstance(expected, list) and isinstance(actual, list):
        for index in range(max(len(expected), len(actual))):
            yield from _leaves(
                expected[index] if index < len(expected) else _ABSENT,
                actual[index] if index < len(actual) else _ABSENT,
                f"{path}[{index}]",
            )
        if len(expected) != len(actual):
            yield f"{path}.length", str(len(expected)), str(len(actual))
    elif type(expected) is not type(actual) or expected != actual:
        # Numeric representation differences are diagnosed by the byte comparison.
        if not (
            type(expected) in (int, float) and type(actual) in (int, float) and expected == actual
        ):
            yield path, _text(expected), _text(actual)


def _clock_match(pattern: tuple[str, ...], path: tuple[str | int, ...], token: str) -> bool:
    if len(pattern) != len(path) or token in ("{", "["):
        return False
    for part, key in zip(pattern, path, strict=True):
        if part == "[]":
            if not isinstance(key, int):
                return False
        elif not isinstance(key, str) or (part != "*" and part != key):
            return False
    kind = int if pattern[-1] in ("age_s", "feed_freshness_s") else str
    return type(json.loads(token)) is kind


def _project(text: str, paths: tuple[str, ...]) -> str:
    patterns = [tuple(p.replace("[]", ".[]").split(".")) for p in paths]
    tokens = list(re.finditer(r'"(?:\\.|[^"\\])*"|[{}\[\],:]|[^\s{}\[\],:]+', text))
    replacements: list[tuple[int, int]] = []
    index = 0

    def visit(path: tuple[str | int, ...]) -> None:
        nonlocal index
        start = tokens[index].start()
        token = tokens[index].group()
        index += 1
        if token in ("{", "["):
            count = 0
            while tokens[index].group() not in ("}", "]"):
                key: str | int = count
                if token == "{":
                    key = json.loads(tokens[index].group())
                    index += 2
                visit((*path, key))
                count += 1
                if tokens[index].group() == ",":
                    index += 1
            index += 1
        if any(_clock_match(p, path, token) for p in patterns):
            replacements.append((start, tokens[index - 1].end()))

    visit(())
    for start, end in sorted(replacements, reverse=True):
        # Keep the replacement's type so an invalid age string cannot impersonate it.
        replacement = '"<clock>"' if text[start] == '"' else "0"
        text = text[:start] + replacement + text[end:]
    return text


def compare_publications(
    expected: Mapping[str, bytes],
    actual: Mapping[str, bytes],
    *,
    project_clock: bool = False,
    limit: int = 50,
) -> list[Difference]:
    """Compare bytes strictly; ports and the shadow comparator never project clocks.

    Only calibration against recorded production files uses clock projection.
    """
    differences: list[Difference] = []
    keys = [k for k in expected if k not in actual] + [k for k in actual if k not in expected]
    for key in keys:
        differences.append(
            Difference(
                key,
                "<bytes>",
                expected[key].decode()[:200] if key in expected else "<absent>",
                actual[key].decode()[:200] if key in actual else "<absent>",
            )
        )
    for key in expected:
        if len(differences) >= limit:
            break
        if key not in actual or expected[key] == actual[key]:
            continue
        left, right = expected[key].decode(), actual[key].decode()
        # Validate before scanning clock spans; malformed publications fail closed.
        json.loads(left)
        json.loads(right)
        if project_clock:
            paths = CLOCK_PATHS["*"] + CLOCK_PATHS.get(key, ())
            left, right = _project(left, paths), _project(right, paths)
        if left == right:
            continue
        changes = _leaves(json.loads(left), json.loads(right))
        found = False
        for path, before, after in changes:
            differences.append(Difference(key, path, before, after))
            found = True
            if len(differences) >= limit:
                break
        if not found:
            differences.append(Difference(key, "<bytes>", left[:200], right[:200]))
    return differences[: max(0, limit)]
