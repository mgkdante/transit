"""Shared delay bands for revision 3 readings."""

from decimal import Decimal
from math import isfinite

EARLY_BELOW_SECONDS = -60
LATE_ABOVE_SECONDS = 300


def band_of(delay_seconds: int | float | Decimal | None) -> str:
    """Classify a delay before rounding; missing delays remain unknown."""
    if delay_seconds is None:
        return "unknown"
    if isinstance(delay_seconds, bool):
        raise TypeError("delay_seconds must not be a bool")
    if isinstance(delay_seconds, Decimal) and not delay_seconds.is_finite():
        raise ValueError("delay_seconds must be finite")
    if isinstance(delay_seconds, float) and not isfinite(delay_seconds):
        raise ValueError("delay_seconds must be finite")
    if delay_seconds < EARLY_BELOW_SECONDS:
        return "early"
    if delay_seconds <= LATE_ABOVE_SECONDS:
        return "on_time"
    return "late"


def band_case_sql(column: str) -> str:
    """Build a CASE over a trusted SQL expression supplied by the caller."""
    return f"""CASE
    WHEN {column} IS NULL THEN 'unknown'
    WHEN {column} < {EARLY_BELOW_SECONDS} THEN 'early'
    WHEN {column} <= {LATE_ABOVE_SECONDS} THEN 'on_time'
    ELSE 'late'
END"""
