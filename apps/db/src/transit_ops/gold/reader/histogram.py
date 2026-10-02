from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal
from typing import TYPE_CHECKING

if TYPE_CHECKING:  # pragma: no cover - typing only
    from collections.abc import Mapping, Sequence


type SqlNumber = int | float | Decimal


def _sql_number(value: object) -> SqlNumber:
    if isinstance(value, int | float | Decimal):
        return value
    raise TypeError("Expected a SQL numeric value")


def round_half_away(x: SqlNumber, ndigits: int) -> Decimal:
    return Decimal(str(x)).quantize(Decimal(10) ** -ndigits, rounding=ROUND_HALF_UP)


def hist_and_avg(r: Mapping[str, object]) -> tuple[list[int], float | None]:
    hist = [int(_sql_number(r[f"h{k}"] or 0)) for k in range(1, 22)]
    in_clamp = sum(hist)
    avg_sec = (float(_sql_number(r["sum_delay_sec"])) / in_clamp) if in_clamp else None
    return hist, avg_sec


def delay_histogram_bins(
    hist: Sequence[int] | None, edges: Sequence[float]
) -> list[tuple[float, float | None, int]] | None:
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
    awt = (sum_gap_sq / (2.0 * sum_gap)) if sum_gap > 0.0 else None
    if awt is None or scheduled is None:
        return None
    return float(round_half_away(max(0.0, awt - scheduled / 2.0), 1))


# Pooled sample CoV uses Bessel n-1 and PostgreSQL numeric rounding.
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
    return _COV_CASE_TEMPLATE.format(n=n, total=total, total_sq=total_sq)
