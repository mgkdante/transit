"""Histogram / regularity math over the additive spine rows (pure, honest-None).

Owns the seconds-domain 21-bin helpers (`hist_and_avg`, `delay_histogram_bins`),
the minutes-domain gap helpers (`bunched_pct`, `ewt_min`), the Bessel-CoV SQL
fragment, and the pipeline's half-away rounding kernel. Callers keep model
construction and ranking policy — these functions return primitives only.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Mapping, Sequence


def round_half_away(x: float, ndigits: int) -> Decimal:
    """Half-away-from-zero round (Python's builtin round() is banker's).

    decimal ROUND_HALF_UP resolves ties away from zero for BOTH signs, matching
    Postgres ROUND(::numeric, n) — the single published-rounding convention
    (2026-07-01 rebaseline; see the provenance methodology `rounding` note).
    """
    return Decimal(str(x)).quantize(Decimal(10) ** -ndigits, rounding=ROUND_HALF_UP)


def hist_and_avg(r: Mapping[str, object]) -> tuple[list[int], float | None]:
    """(21-bin summed histogram, ghost-excluded pooled avg seconds-or-None) from a row.

    avg = SUM(sum_delay_seconds) / in-clamp count, where the in-clamp count is the
    sum of the histogram bins (Finding C: ghost-excluded numerator AND denominator).
    None when there are no in-clamp delays -> avg_delay_min -> honest None.
    """
    hist = [int(r[f"h{k}"] or 0) for k in range(1, 22)]  # type: ignore[arg-type]
    in_clamp = sum(hist)
    avg_sec = (float(r["sum_delay_sec"]) / in_clamp) if in_clamp else None  # type: ignore[arg-type]
    return hist, avg_sec


def delay_histogram_bins(
    hist: Sequence[int] | None, edges: Sequence[float]
) -> list[tuple[float, float | None, int]] | None:
    """(lo_sec, hi_sec-or-None, count) triples from the spine histogram (honest-None).

    bin i = [edges[i], edges[i + 1]) for i in 0..len(edges)-2; the final bin is the
    [edges[-1], +inf) overflow (hi=None). None when there are no observations;
    otherwise ALL bins are emitted (zeros included) so the UI draws the full shape.
    """
    if not hist or sum(hist) <= 0:
        return None
    return [
        (
            edges[i],
            edges[i + 1] if i + 1 < len(edges) else None,
            int(count),
        )
        for i, count in enumerate(hist)
    ]


def bunched_pct(
    hist: Sequence[int] | None, edges: Sequence[float], median_min: float | None
) -> float | None:
    """Windowed %bunched: pooled-histogram mass below 0.5*median (straddling-bin linear
    interp) / total. NEVER a sum of daily bunched counts (D4). None on empty / None median."""
    if not hist or median_min is None:
        return None
    total = sum(hist)
    if total <= 0:
        return None
    thresh = 0.5 * median_min
    below = 0.0
    for i, c in enumerate(hist):
        lo, hi = edges[i], edges[i + 1]
        if hi <= thresh:
            below += c
        elif lo >= thresh:
            break
        else:
            below += c * (thresh - lo) / (hi - lo)
    return 100.0 * below / total


def ewt_min(sum_gap: float, sum_gap_sq: float, scheduled: float | None) -> float | None:
    """True passenger-weighted Excess Wait Time (Welding/Osuna-Newell), minutes, 1 dp.

    AWT = E[H²]/(2·E[H]) = Σgap²/(2·Σgap) is the wait a random passenger actually
    expects (it folds in bunching: long gaps catch more riders), and SWT =
    scheduled/2 is the wait on perfectly even service, so EWT = max(0, AWT −
    scheduled/2). CLAMPED at 0 (actual-more-frequent-than-scheduled is an honest 0,
    never a negative wait); None when there are no gaps (Σgap=0) or no scheduled
    headway.
    """
    awt = (sum_gap_sq / (2.0 * sum_gap)) if sum_gap > 0.0 else None
    if awt is None or scheduled is None:
        return None
    return float(round_half_away(max(0.0, awt - scheduled / 2.0), 1))


# Bessel n-1 pooled CoV recomposed in SQL (D2): sample SD / mean over summed
# moments, guarded n>=2 AND mean>0, ROUND(::numeric,4) (half-away) — byte-identical
# to the legacy stddev_samp. The slots take the three aggregate expressions
# (count, Σgap, Σgap²); indentation is fixed to the headway-window SELECT list.
_COV_CASE_TEMPLATE = """\
        CASE
            WHEN {n} >= 2 AND {total} > 0
            THEN ROUND(
                (
                    sqrt(
                        GREATEST(
                            ({total_sq} - power({total}, 2) / {n})
                            / ({n} - 1),
                            0
                        )
                    )
                    / ({total} / {n})
                )::numeric, 4)
        END"""


def cov_case_sql(*, n: str, total: str, total_sq: str) -> str:
    """Emit the Bessel-CoV CASE over aggregate expressions (see _COV_CASE_TEMPLATE)."""
    return _COV_CASE_TEMPLATE.format(n=n, total=total, total_sq=total_sq)
