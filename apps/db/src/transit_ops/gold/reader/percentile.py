from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader.histogram import round_half_away

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Sequence


def cdf_percentile(
    hist: Sequence[int] | None, q: float, edges: Sequence[float]
) -> float | None:
    if not hist:
        return None
    total = sum(hist)
    if total <= 0:
        return None
    target = q * total
    cumulative = 0
    for bin_idx, count in enumerate(hist):
        if count <= 0:
            continue
        if cumulative + count >= target:
            lo = edges[bin_idx]
            if bin_idx + 1 >= len(edges):
                # The overflow bin has no upper edge; return its lower bound.
                return float(lo)
            hi = edges[bin_idx + 1]
            frac = (target - cumulative) / count
            return lo + (hi - lo) * frac
        cumulative += count
    return float(edges[-1])


def pctile_min_from_hist(
    hist: Sequence[int] | None, q: float, edges: Sequence[float]
) -> float | None:
    raw = cdf_percentile(hist, q, edges)
    if raw is None:
        return None
    return float(round_half_away(raw / 60.0, 1))
