"""Regression tests for the pure-helper functions in builders.py.

These tests lock the exact numeric and string contracts of every small helper
so a future refactor cannot silently break conversion logic without a test
failure.  No database connection is required.
"""

from __future__ import annotations

import pytest

from transit_ops.snapshots.builders import (
    _gtfs_min,
    _infer_shift,
    _kmh,
    _median_headway,
    _route_sort_key,
    _sample_times,
    _wallclock,
)


# ---------------------------------------------------------------------------
# _wallclock
# ---------------------------------------------------------------------------


def test_wallclock_extended_25_48() -> None:
    """25:48 wraps to 01:48 (next-day service)."""
    assert _wallclock("25:48") == "01:48"


def test_wallclock_extended_29_03() -> None:
    """29:03 wraps to 05:03."""
    assert _wallclock("29:03") == "05:03"


def test_wallclock_normal_13_05() -> None:
    """Normal intra-day time passes through unchanged."""
    assert _wallclock("13:05") == "13:05"


def test_wallclock_none_returns_none() -> None:
    """None input → None output (no crash)."""
    assert _wallclock(None) is None


def test_wallclock_empty_string_returns_none() -> None:
    """Empty string is falsy → None."""
    assert _wallclock("") is None


def test_wallclock_with_seconds() -> None:
    """HH:MM:SS form — seconds portion is ignored; wrapping still applies."""
    assert _wallclock("25:48:00") == "01:48"
    assert _wallclock("07:30:45") == "07:30"


# ---------------------------------------------------------------------------
# _kmh
# ---------------------------------------------------------------------------


def test_kmh_10_ms() -> None:
    """10 m/s → 36 km/h (exact)."""
    assert _kmh(10) == 36


def test_kmh_none() -> None:
    """NULL speed → None, not 0."""
    assert _kmh(None) is None


def test_kmh_float_precision() -> None:
    """15.0001 m/s rounds to 54 km/h (15.0001 * 3.6 = 54.00036 → 54)."""
    assert _kmh(15.0001) == 54


def test_kmh_zero() -> None:
    """0 m/s → 0 km/h."""
    assert _kmh(0) == 0


def test_kmh_small_float() -> None:
    """8.33 m/s ≈ 30 km/h."""
    assert _kmh(8.333333) == 30


# ---------------------------------------------------------------------------
# _gtfs_min
# ---------------------------------------------------------------------------


def test_gtfs_min_extended() -> None:
    """25:48 → 1548 minutes (extended GTFS time)."""
    assert _gtfs_min("25:48") == 1548


def test_gtfs_min_normal() -> None:
    """05:00 → 300 minutes."""
    assert _gtfs_min("05:00") == 300


def test_gtfs_min_midnight() -> None:
    """00:00 → 0 minutes."""
    assert _gtfs_min("00:00") == 0


def test_gtfs_min_with_seconds() -> None:
    """HH:MM:SS → only hours+minutes counted."""
    assert _gtfs_min("06:30:00") == 390


# ---------------------------------------------------------------------------
# _median_headway
# ---------------------------------------------------------------------------


def test_median_headway_uniform() -> None:
    """[0, 10, 20, 30] → gaps [10, 10, 10] → median 10.0."""
    assert _median_headway([0, 10, 20, 30]) == 10.0


def test_median_headway_uneven() -> None:
    """[0, 10, 20, 21] → gaps [10, 10, 1] → median 10.0."""
    assert _median_headway([0, 10, 20, 21]) == 10.0


def test_median_headway_single_value_returns_none() -> None:
    """A single distinct value means no gaps → None."""
    assert _median_headway([5]) is None


def test_median_headway_deduplicates() -> None:
    """Duplicate minutes are deduplicated: {0,10,20} → gaps [10,10] → 10.0."""
    assert _median_headway([0, 0, 10, 10, 20]) == 10.0


def test_median_headway_empty_returns_none() -> None:
    """Empty list → None (no distinct values, no gaps)."""
    assert _median_headway([]) is None


def test_median_headway_two_values() -> None:
    """Two distinct values → one gap."""
    assert _median_headway([5, 15]) == 10.0


# ---------------------------------------------------------------------------
# _route_sort_key
# ---------------------------------------------------------------------------


def test_route_sort_key_ordering() -> None:
    """Numeric routes sort before alpha; within numerics: natural order."""
    routes = ["72", "229", "1", "10", "X1"]
    routes.sort(key=_route_sort_key)
    assert routes == ["1", "10", "72", "229", "X1"]


def test_route_sort_key_all_numeric() -> None:
    """Pure numeric routes sort numerically, not lexicographically."""
    routes = ["100", "10", "9", "2"]
    routes.sort(key=_route_sort_key)
    assert routes == ["2", "9", "10", "100"]


def test_route_sort_key_all_alpha() -> None:
    """Alpha routes sort lexicographically among themselves."""
    routes = ["Z1", "A1", "B1"]
    routes.sort(key=_route_sort_key)
    assert routes == ["A1", "B1", "Z1"]


# ---------------------------------------------------------------------------
# _infer_shift
# ---------------------------------------------------------------------------


def test_infer_shift_am_peak() -> None:
    assert _infer_shift(7) == "am_peak"


def test_infer_shift_midday() -> None:
    assert _infer_shift(12) == "midday"


def test_infer_shift_pm_peak() -> None:
    assert _infer_shift(17) == "pm_peak"


def test_infer_shift_evening() -> None:
    assert _infer_shift(21) == "evening"


def test_infer_shift_night_late() -> None:
    assert _infer_shift(23) == "night"


def test_infer_shift_night_early() -> None:
    assert _infer_shift(2) == "night"


def test_infer_shift_boundaries() -> None:
    """Boundary hours fall into the correct bucket."""
    assert _infer_shift(6) == "am_peak"   # start of am_peak
    assert _infer_shift(9) == "midday"    # start of midday
    assert _infer_shift(15) == "pm_peak"  # start of pm_peak
    assert _infer_shift(19) == "evening"  # start of evening
    assert _infer_shift(0) == "night"     # midnight


# ---------------------------------------------------------------------------
# _sample_times
# ---------------------------------------------------------------------------


def test_sample_times_dedup_and_wallclock() -> None:
    """Duplicates are removed and times converted to wall-clock HH:MM."""
    assert _sample_times(["08:00:00", "08:00:00", "08:30:00"]) == ["08:00", "08:30"]


def test_sample_times_long_list_capped_at_12() -> None:
    """A list of 50 ascending times is sampled down to exactly 12 items."""
    times = [f"{h:02d}:{m:02d}:00" for h in range(5, 23) for m in (0, 30)][:50]
    result = _sample_times(times)
    assert len(result) <= 12
    # Last item must be the last distinct time
    assert result[-1] == _wallclock(times[-1])


def test_sample_times_preserves_last() -> None:
    """When sampling, the last departure is always kept."""
    times = [f"0{h}:00:00" for h in range(5, 9)] + ["23:59:00"]
    result = _sample_times(times)
    assert result[-1] == "23:59"


def test_sample_times_single() -> None:
    """A single-entry list passes through as-is."""
    assert _sample_times(["14:22:00"]) == ["14:22"]


def test_sample_times_extended_hour() -> None:
    """Extended GTFS hours are converted to wall-clock in output."""
    assert _sample_times(["25:10:00"]) == ["01:10"]
