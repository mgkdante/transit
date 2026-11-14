from datetime import date

import pytest

from transit_ops.gold import reader
from transit_ops.gold.reader.delay_hist import HistLayoutMismatch, QuantileBin


def test_band_pct_preserves_missing_and_measured_zero() -> None:
    for count, known in [(None, 100), (0, None), (0, 0)]:
        assert reader.band_pct(count, known) is None
    assert reader.band_pct(0, 100) == 0.0
    assert reader.band_pct(100, 100) == 100.0


def test_rate_rounding_uses_half_away_ties() -> None:
    assert reader.band_pct(341, 400) == 85.3
    assert reader.band_pct(1, 16) == 6.3
    for count, known in [(-1, 10), (1, -10), (11, 10)]:
        with pytest.raises(ValueError):
            reader.band_pct(count, known)


def test_late_average_uses_pooled_seconds() -> None:
    assert reader.late_avg_min(1830, 5) == 6.1
    assert reader.late_avg_min(945, 3) == 5.3
    assert reader.late_avg_min(0, 5) == 0.0
    for total, late in [(None, 5), (0, None), (0, 0)]:
        assert reader.late_avg_min(total, late) is None
    for total, late in [(-1, 5), (1, -5)]:
        with pytest.raises(ValueError):
            reader.late_avg_min(total, late)


def test_band_pct_preserves_divide_then_scale_half_tie() -> None:
    # 9 * 100 / 2000 = 0.45 exactly, so half-away to one decimal is 0.5.
    assert reader.band_pct(9, 2000) == 0.5


def test_min_service_days_of_one_two_and_three_days() -> None:
    for width, scheduled, expected in [(1, 1, 1), (2, 2, 2), (3, 3, 3)]:
        assert reader.min_service_days(width, scheduled) == expected


def test_late_average_preserves_a_value_just_below_a_half_tie() -> None:
    # Seconds = 27 * late - 1: minutes = 0.45 - 1/60000000000000000, below the tie.
    assert reader.late_avg_min(26999999999999999, 1000000000000000) == 0.4


def test_min_service_days_is_capped_by_scheduled_days_and_never_under_four() -> None:
    for width, scheduled, expected in [
        (4, 4, 4),
        (7, 7, 5),
        (30, 30, 15),
        (31, 31, 16),
        (90, 90, 45),
        (30, 8, 8),
        (7, 2, 4),
        (7, 0, 4),
    ]:
        assert reader.min_service_days(width, scheduled) == expected
    for width, scheduled in [(0, 0), (-1, 0), (7, -1), (7, 8)]:
        with pytest.raises(ValueError):
            reader.min_service_days(width, scheduled)


def test_summary_pools_counts_instead_of_daily_percentages() -> None:
    days = [
        reader.DayCount(date(2026, 1, 1), 10, 10, 10),
        reader.DayCount(date(2026, 1, 2), 0, 90, 20),
    ]
    original = days.copy()
    for order in [days, days[::-1]]:
        assert reader.rate_summary(order, window="range", window_days=2, scheduled_days=2) == (
            reader.RateSummary(10.0, 100, 30, 2, "counts")
        )
    assert days == original


def test_summary_is_tentative_below_either_floor() -> None:
    days = [
        reader.DayCount(date(2026, 1, 1), 10, 10, 10),
        reader.DayCount(date(2026, 1, 2), 0, 90, 19),
    ]
    assert reader.rate_summary(days, window="range", window_days=2, scheduled_days=2) == (
        reader.RateSummary(10.0, 100, 29, 2, "tentative")
    )
    days[1] = reader.DayCount(date(2026, 1, 2), 0, 90, 20)
    days.append(reader.DayCount(date(2026, 1, 3), 0, 0, 0))
    assert reader.rate_summary(days, window="range", window_days=3, scheduled_days=3) == (
        reader.RateSummary(10.0, 100, 30, 2, "tentative")
    )


def test_a_line_scheduled_twice_a_week_meets_the_thirty_day_floor_only() -> None:
    days = [reader.DayCount(date(2026, 1, i), 1, 1, 4) for i in range(1, 9)]
    assert reader.rate_summary(days, window="trailing_30", window_days=30, scheduled_days=8) == (
        reader.RateSummary(100.0, 8, 32, 8, "counts")
    )
    days = [reader.DayCount(date(2026, 1, i), 1, 1, 30) for i in (1, 2)]
    assert reader.rate_summary(days, window="trailing_7", window_days=7, scheduled_days=2) == (
        reader.RateSummary(100.0, 2, 60, 2, "tentative")
    )


@pytest.mark.parametrize(
    "window,width",
    [
        ("day", 1),
        ("trailing_7", 7),
        ("trailing_30", 30),
        ("calendar_month", 28),
        ("calendar_month", 29),
        ("calendar_month", 30),
        ("calendar_month", 31),
        ("range", 90),
    ],
)
def test_empty_summary_is_missing_and_tentative(window, width) -> None:
    assert reader.rate_summary([], window=window, window_days=width, scheduled_days=0) == (
        reader.RateSummary(None, 0, 0, 0, "tentative")
    )


@pytest.mark.parametrize(
    "window,width,scheduled,rows",
    [
        ("bad", 1, 1, []),
        ("day", 2, 2, []),
        ("trailing_7", 6, 6, []),
        ("trailing_30", 29, 29, []),
        ("calendar_month", 27, 27, []),
        ("calendar_month", 32, 32, []),
        ("range", 0, 0, []),
        ("range", 2, -1, []),
        ("range", 2, 3, []),
        ("range", 2, 2, [(1, 0, 0, 0), (1, 0, 0, 0)]),
        ("range", 1, 1, [(1, 0, 0, 0), (2, 0, 0, 0)]),
        ("range", 2, 0, [(1, 0, 1, 0)]),
        ("day", 1, 1, [(1, -1, 1, 30)]),
        ("day", 1, 1, [(1, 0, -1, 30)]),
        ("day", 1, 1, [(1, 0, 1, -1)]),
        ("day", 1, 1, [(1, 2, 1, 30)]),
    ],
)
def test_summary_validates_rows_and_window_metadata(window, width, scheduled, rows) -> None:
    days = [reader.DayCount(date(2026, 1, d), s, r, t) for d, s, r, t in rows]
    with pytest.raises(ValueError):
        reader.rate_summary(days, window=window, window_days=width, scheduled_days=scheduled)


def test_delay_bins_call_quantile_bin_of_layout_2() -> None:
    parts = [(2, [45, 160], [500, 100]), (2, [45], [400])]
    original = [(tag, bins.copy(), counts.copy()) for tag, bins, counts in parts]
    for order in [parts, parts[::-1]]:
        assert reader.delay_bins(iter(order)) == (
            QuantileBin(45, 0, 10, 1000),
            QuantileBin(45, 0, 10, 1000),
        )
    assert parts == original


def test_delay_bins_preserve_open_ends_and_empty_mass() -> None:
    assert reader.delay_bins([(2, [45, 160], [800, 200])]) == (
        QuantileBin(45, 0, 10, 1000),
        QuantileBin(160, 3600, None, 1000),
    )
    assert reader.delay_bins([(2, [0], [4])]) == (
        QuantileBin(0, None, -3600, 4),
        QuantileBin(0, None, -3600, 4),
    )
    assert reader.delay_bins([]) == (None, None)
    assert reader.delay_bins([(2, [], []), (2, [45], [0])]) == (None, None)


def test_delay_bins_distinguish_p90_from_p89() -> None:
    # Ranks 1..890 are in [0,10); rank 900 is in layout 2's [3600,infinity) bin.
    assert reader.delay_bins([(2, [45, 160], [890, 110])]) == (
        QuantileBin(45, 0, 10, 1000),
        QuantileBin(160, 3600, None, 1000),
    )


def test_delay_bins_pass_layout_tagged_parts_and_refuse_another_layout() -> None:
    for foreign in [1, 3]:
        with pytest.raises(HistLayoutMismatch):
            reader.delay_bins([(2, [45], [1]), (foreign, [], [])])
    for bins, counts in [([45], []), ([45], [-1])]:
        with pytest.raises(ValueError):
            reader.delay_bins([(2, bins, counts)])
