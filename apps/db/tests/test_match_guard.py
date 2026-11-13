import ast
import sys
from pathlib import Path

import pytest

from transit_ops.gold import match_guard
from transit_ops.gold.match_guard import (
    MATCH_GUARD_MIN_SHARE,
    MATCH_GUARD_MIN_TRIPS,
    line_passes_match_guard,
)


def test_exactly_eighty_percent_passes() -> None:
    for realtime, matched in ((5, 4), (10, 8), (100, 80), (5000, 4000)):
        assert line_passes_match_guard(realtime, matched)
    assert not line_passes_match_guard(100, 79)


def test_fewer_than_five_trips_always_pass() -> None:
    for realtime, matched in ((0, 0), (1, 0), (4, 0), (4, 3)):
        assert line_passes_match_guard(realtime, matched)


def test_four_of_six_fails() -> None:
    assert not line_passes_match_guard(6, 4)
    assert not line_passes_match_guard(5, 0)


def test_the_share_is_exact_for_every_count() -> None:
    for realtime in range(5, 2001):
        matched = (4 * realtime + 4) // 5
        assert line_passes_match_guard(realtime, matched), (realtime, matched)
        assert not line_passes_match_guard(realtime, matched - 1), (realtime, matched - 1)


def test_constants_have_the_specified_values() -> None:
    assert MATCH_GUARD_MIN_SHARE == 0.80
    assert MATCH_GUARD_MIN_TRIPS == 5
    assert type(MATCH_GUARD_MIN_TRIPS) is int


def test_module_source_imports_only_the_standard_library() -> None:
    tree = ast.parse(Path(match_guard.__file__).read_text(encoding="utf-8"))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names = [alias.name for alias in node.names]
        elif isinstance(node, ast.ImportFrom):
            assert node.level == 0
            assert node.module is not None
            names = [node.module]
        else:
            continue
        for name in names:
            root = name.split(".")[0]
            assert root != "transit_ops"
            assert root in sys.stdlib_module_names


@pytest.mark.parametrize("realtime, matched", [(-1, 0), (5, -1), (-2, -1), (4, 5), (0, 1)])
def test_input_checks(realtime: int, matched: int) -> None:
    with pytest.raises(ValueError) as error:
        line_passes_match_guard(realtime, matched)
    assert f"realtime_trip_ids={realtime}" in str(error.value)
    assert f"matched_trip_ids={matched}" in str(error.value)


@pytest.mark.parametrize("realtime, matched", [(True, 0), (False, 0), (5, True), (5, False)])
def test_input_checks_reject_bools(realtime: int, matched: int) -> None:
    with pytest.raises(TypeError):
        line_passes_match_guard(realtime, matched)
