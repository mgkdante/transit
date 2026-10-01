
from __future__ import annotations

from transit_ops.snapshots.builders._helpers import (
    _gtfs_min,
    _infer_shift,
    _kmh,
    _median_headway,
    _route_sort_key,
    _sample_times,
    _wallclock,
)


def test_wallclock_extended_25_48() -> None:
    assert _wallclock("25:48") == "01:48"


def test_wallclock_extended_29_03() -> None:
    assert _wallclock("29:03") == "05:03"


def test_wallclock_normal_13_05() -> None:
    assert _wallclock("13:05") == "13:05"


def test_wallclock_none_returns_none() -> None:
    assert _wallclock(None) is None


def test_wallclock_empty_string_returns_none() -> None:
    assert _wallclock("") is None


def test_wallclock_with_seconds() -> None:
    assert _wallclock("25:48:00") == "01:48"
    assert _wallclock("07:30:45") == "07:30"


def test_kmh_10_ms() -> None:
    assert _kmh(10) == 36


def test_kmh_none() -> None:
    assert _kmh(None) is None


def test_kmh_float_precision() -> None:
    assert _kmh(15.0001) == 54


def test_kmh_zero() -> None:
    assert _kmh(0) == 0


def test_kmh_small_float() -> None:
    assert _kmh(8.333333) == 30


def test_gtfs_min_extended() -> None:
    assert _gtfs_min("25:48") == 1548


def test_gtfs_min_normal() -> None:
    assert _gtfs_min("05:00") == 300


def test_gtfs_min_midnight() -> None:
    assert _gtfs_min("00:00") == 0


def test_gtfs_min_with_seconds() -> None:
    assert _gtfs_min("06:30:00") == 390


def test_median_headway_uniform() -> None:
    assert _median_headway([0, 10, 20, 30]) == 10.0


def test_median_headway_uneven() -> None:
    assert _median_headway([0, 10, 20, 21]) == 10.0


def test_median_headway_single_value_returns_none() -> None:
    assert _median_headway([5]) is None


def test_median_headway_deduplicates() -> None:
    assert _median_headway([0, 0, 10, 10, 20]) == 10.0


def test_median_headway_empty_returns_none() -> None:
    assert _median_headway([]) is None


def test_median_headway_two_values() -> None:
    assert _median_headway([5, 15]) == 10.0


def test_route_sort_key_ordering() -> None:
    routes = ["72", "229", "1", "10", "X1"]
    routes.sort(key=_route_sort_key)
    assert routes == ["1", "10", "72", "229", "X1"]


def test_route_sort_key_all_numeric() -> None:
    routes = ["100", "10", "9", "2"]
    routes.sort(key=_route_sort_key)
    assert routes == ["2", "9", "10", "100"]


def test_route_sort_key_all_alpha() -> None:
    routes = ["Z1", "A1", "B1"]
    routes.sort(key=_route_sort_key)
    assert routes == ["A1", "B1", "Z1"]


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
    assert _infer_shift(6) == "am_peak"
    assert _infer_shift(9) == "midday"
    assert _infer_shift(15) == "pm_peak"
    assert _infer_shift(19) == "evening"
    assert _infer_shift(0) == "night"


def test_sample_times_dedup_and_wallclock() -> None:
    assert _sample_times(["08:00:00", "08:00:00", "08:30:00"]) == ["08:00", "08:30"]


def test_sample_times_long_list_capped_at_12() -> None:
    times = [f"{h:02d}:{m:02d}:00" for h in range(5, 23) for m in (0, 30)][:50]
    result = _sample_times(times)
    assert len(result) <= 12
    assert result[-1] == _wallclock(times[-1])


def test_sample_times_preserves_last() -> None:
    times = [f"0{h}:00:00" for h in range(5, 9)] + ["23:59:00"]
    result = _sample_times(times)
    assert result[-1] == "23:59"


def test_sample_times_single() -> None:
    assert _sample_times(["14:22:00"]) == ["14:22"]


def test_sample_times_extended_hour() -> None:
    assert _sample_times(["25:10:00"]) == ["01:10"]
