from bisect import bisect_right
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from decimal import Decimal
from types import MappingProxyType


@dataclass(frozen=True)
class QuantileBin:
    bin: int
    lower_s: int | None
    upper_s: int | None
    n: int


@dataclass(frozen=True)
class HistLayout:
    layout_id: int
    edges_s: tuple[int, ...]
    left_closed: bool


_EDGES = tuple(
    edge
    for start, stop, step in (
        (-3600, -1800, 300),
        (-1800, -600, 120),
        (-600, -120, 30),
        (-120, 600, 10),
        (600, 1800, 30),
        (1800, 3600, 120),
    )
    for edge in range(start, stop, step)
) + (3600,)

# Layout 1 is reserved: its older dense array has no underflow bin.
DELAY_HIST_LAYOUTS: Mapping[int, HistLayout] = MappingProxyType({2: HistLayout(2, _EDGES, True)})


def _get_layout(layout: int) -> HistLayout:
    try:
        return DELAY_HIST_LAYOUTS[layout]
    except KeyError:
        raise ValueError(f"Unknown histogram layout: {layout}") from None


def hist_edges_sql(layout: int) -> str:
    return "ARRAY[" + ",".join(map(str, _get_layout(layout).edges_s)) + "]::integer[]"


def bin_index(delay_s: float, *, layout: int = 2) -> int:
    return bisect_right(_get_layout(layout).edges_s, delay_s)


class HistLayoutMismatch(ValueError):
    pass


def merge_hist(
    parts: Iterable[tuple[int, Sequence[int], Sequence[int]]], *, layout: int
) -> tuple[list[int], list[int]]:
    edges = _get_layout(layout).edges_s
    inputs = list(parts)
    for part_layout, _, _ in inputs:
        if part_layout != layout:
            raise HistLayoutMismatch(
                f"Part layout {part_layout} differs from requested layout {layout}"
            )
    totals: dict[int, int] = {}
    for _, bins, counts in inputs:
        if len(bins) != len(counts):
            raise ValueError("bins and counts have different lengths")
        for index, count in zip(bins, counts, strict=True):
            if not 0 <= index <= len(edges):
                raise ValueError(f"bin {index} outside layout {layout}")
            if count < 0:
                raise ValueError(f"negative count for bin {index}")
            if count:
                totals[index] = totals.get(index, 0) + count
    ordered = sorted(totals)
    return ordered, [totals[index] for index in ordered]


def quantile_bin(
    bins: Sequence[int], counts: Sequence[int], q: float, *, layout: int = 2
) -> QuantileBin | None:
    edges = _get_layout(layout).edges_s
    if not 0 < q <= 1:
        raise ValueError("q must satisfy 0 < q <= 1")
    ordered, mass = merge_hist([(layout, bins, counts)], layout=layout)
    n = sum(mass)
    if n == 0:
        return None
    # Decimal text avoids float overshoot; an integer ratio also avoids context rounding.
    numerator, denominator = Decimal(str(q)).as_integer_ratio()
    rank = (numerator * n + denominator - 1) // denominator
    cumulative = 0
    for index, count in zip(ordered, mass, strict=True):
        cumulative += count
        if cumulative >= rank:
            return QuantileBin(
                index,
                edges[index - 1] if index else None,
                edges[index] if index < len(edges) else None,
                n,
            )
    raise AssertionError("Validated histogram did not reach its quantile rank")
