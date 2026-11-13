from collections import Counter
from fractions import Fraction
from itertools import permutations
from math import ceil
from random import Random

import pytest

from transit_ops.gold.reader.delay_hist import (
    DELAY_HIST_LAYOUTS,
    HistLayoutMismatch,
    QuantileBin,
    bin_index,
    hist_edges_sql,
    merge_hist,
    quantile_bin,
)


def test_merge_is_bin_by_bin_and_order_free() -> None:
    parts = [(2, [7, 1, 7], [2, 3, 4]), (2, [160, 7, 0], [5, 1, 0]), (2, [], [])]
    for order in permutations(parts):
        assert merge_hist(iter(order), layout=2) == ([1, 7, 160], [3, 7, 5])
    assert merge_hist([], layout=2) == ([], [])
    assert merge_hist([(2, [], []), (2, [1], [0])], layout=2) == ([], [])


@pytest.mark.parametrize("foreign", [1, 3])
def test_merge_refuses_a_part_of_another_layout(foreign: int) -> None:
    parts = [(2, [1], [3]), (foreign, [], []), (2, [2], [4])]
    for order in permutations(parts):
        with pytest.raises(HistLayoutMismatch):
            merge_hist(order, layout=2)


@pytest.mark.parametrize("size", [1, 7, 100, 1000])
def test_quantile_bin_holds_the_nearest_rank_value_on_generated_data(size: int) -> None:
    rng = Random(718 + size)
    delays = [rng.gauss(0, 250) for _ in range(size)] + [-20000.5, 18000.25]
    delays += [rng.choice([-1, 1]) * rng.expovariate(1 / 5000) for _ in range(size)]
    histogram = Counter(bin_index(delay) for delay in delays)
    ordered = sorted(delays)
    for q in [0.01, 0.07, 0.5, 0.9, 0.99, 1.0]:
        rank = ceil(Fraction(str(q)) * len(delays))
        result = quantile_bin(list(histogram), list(histogram.values()), q)
        assert result is not None
        assert result.bin == bin_index(ordered[rank - 1])
        assert result.n == len(delays)


def test_nine_hundred_zeros_and_a_hundred_hours_give_the_zero_bin() -> None:
    bins = [bin_index(0), bin_index(3600)]
    assert quantile_bin(bins, [900, 100], 0.9) == QuantileBin(bins[0], 0, 10, 1000)
    assert quantile_bin(bins, [900, 100], 0.99) == QuantileBin(160, 3600, None, 1000)


def test_open_bins_have_one_null_edge() -> None:
    assert quantile_bin([bin_index(-4000)], [4], 0.5) == QuantileBin(0, None, -3600, 4)
    assert quantile_bin([bin_index(4000)], [4], 0.5) == QuantileBin(160, 3600, None, 4)


def test_exactly_one_hour_is_in_the_top_bin() -> None:
    assert bin_index(3600) == 160
    assert bin_index(3599) == 159
    assert bin_index(-3600) == 1
    assert bin_index(-3601) == 0


def test_every_band_threshold_is_an_edge() -> None:
    for threshold in [-60, 60, 120, 180, 300, 600]:
        assert threshold in DELAY_HIST_LAYOUTS[2].edges_s
        assert bin_index(threshold) == bin_index(threshold - 1) + 1


def test_sql_edges_equal_the_python_edges() -> None:
    sql = hist_edges_sql(2)
    assert sql.startswith("ARRAY[") and sql.endswith("]::integer[]")
    edges = tuple(
        int(value) for value in sql.removeprefix("ARRAY[").removesuffix("]::integer[]").split(",")
    )
    layout = DELAY_HIST_LAYOUTS[2]
    assert edges == layout.edges_s
    assert len(edges) == 160
    assert all(a < b for a, b in zip(edges, edges[1:], strict=False))
    assert layout.layout_id == 2 and layout.left_closed
    for index, delay in enumerate(edges, start=1):
        assert bin_index(delay - 0.25) == index - 1
        assert bin_index(delay) == bin_index(delay + 0.25) == index
        result = quantile_bin([bin_index(delay)], [1], 1)
        assert result is not None and result.lower_s == delay


def test_empty_histogram_gives_none() -> None:
    assert quantile_bin([], [], 0.5) is None
    assert quantile_bin([0, 160], [0, 0], 0.5) is None


@pytest.mark.parametrize("q,n,expected", [(0.07, 100, 6), (0.14, 100, 13), (0.28, 100, 27)])
def test_rank_is_exact_for_decimal_quantiles(q: float, n: int, expected: int) -> None:
    assert quantile_bin(list(range(n)), [1] * n, q) == QuantileBin(
        expected,
        DELAY_HIST_LAYOUTS[2].edges_s[expected - 1],
        DELAY_HIST_LAYOUTS[2].edges_s[expected],
        n,
    )


def test_unsorted_duplicate_bins_are_added_for_quantiles() -> None:
    assert quantile_bin([160, 1, 1, 0], [3, 2, 2, 0], 0.5) == QuantileBin(1, -3600, -3300, 7)
    # Decimal arithmetic must remain exact even beyond its default context precision.
    assert quantile_bin([1, 2], [10**40, 1], 1) == QuantileBin(2, -3300, -3000, 10**40 + 1)


def test_input_checks() -> None:
    for bins, counts, problem in [
        ([1], [], "length"),
        ([-1], [1], "bin"),
        ([161], [0], "bin"),
        ([1], [-1], "negative"),
    ]:
        with pytest.raises(ValueError, match=problem):
            merge_hist([(2, bins, counts)], layout=2)
        with pytest.raises(ValueError, match=problem):
            quantile_bin(bins, counts, 0.5)
    for layout in [1, 3]:
        with pytest.raises(ValueError, match="layout"):
            hist_edges_sql(layout)
        with pytest.raises(ValueError, match="layout"):
            bin_index(0, layout=layout)
        with pytest.raises(ValueError, match="layout"):
            merge_hist([], layout=layout)
        with pytest.raises(ValueError, match="layout"):
            quantile_bin([], [], 0.5, layout=layout)
    for q in [0, -0.1, 1.1, float("nan"), float("inf")]:
        with pytest.raises(ValueError, match="q"):
            quantile_bin([], [], q)
