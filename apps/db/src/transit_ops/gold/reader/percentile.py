"""The ONE CDF interpolator over an additive histogram (spine delay + headway gaps).

`cdf_percentile` unifies the two historical walkers (`_pctile_from_hist`,
`_headway_pctile_from_hist`): same loop, RAW value in the edges' native unit,
NO rounding — unit conversion and rounding belong to the wrappers/callers.
Terminal-branch resolution (documented divergence fix): when the percentile
lands in a bin with no upper edge (bin index + 1 >= len(edges)) the value
FLOORS at that bin's lower edge — the delay spine's 21-bin behavior (bin 20 =
[3600, +inf) pins at 3600). The gap histogram has 20 bins over 21 finite
edges, so this branch is dead code there (the old interp-to-edges[-1] arm it
replaces was equally unreachable) — no published value moves.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.gold.reader.histogram import round_half_away

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Sequence


def cdf_percentile(
    hist: Sequence[int] | None, q: float, edges: Sequence[float]
) -> float | None:
    """q-th percentile via CDF interpolation; raw native-unit float, honest-None."""
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
                # Overflow bin without an upper edge: floor at the last edge.
                return float(lo)
            hi = edges[bin_idx + 1]
            frac = (target - cumulative) / count
            return lo + (hi - lo) * frac
        cumulative += count
    # Unreachable when target <= total, but clamp to the last edge defensively.
    return float(edges[-1])


def pctile_min_from_hist(
    hist: Sequence[int] | None, q: float, edges: Sequence[float]
) -> float | None:
    """Seconds-histogram wrapper: percentile in MINUTES rounded half-away to 0.1.

    Owns the unit conversion + rounding the delay-spine callers need (the core
    stays raw). Half-away matches Postgres ROUND (2026-07-01 rounding rebaseline).
    """
    raw = cdf_percentile(hist, q, edges)
    if raw is None:
        return None
    return float(round_half_away(raw / 60.0, 1))
