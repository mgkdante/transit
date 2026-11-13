"""Decide whether a line's live trips match its scheduled list closely enough.
The service build passes these two constants to SQL as parameters, keeping them here only.
"""

from fractions import Fraction

MATCH_GUARD_MIN_SHARE = 0.80
MATCH_GUARD_MIN_TRIPS = 5


def line_passes_match_guard(realtime_trip_ids: int, matched_trip_ids: int) -> bool:
    if isinstance(realtime_trip_ids, bool) or isinstance(matched_trip_ids, bool):
        raise TypeError("Trip counts must not be bools")
    if realtime_trip_ids < 0 or matched_trip_ids < 0 or matched_trip_ids > realtime_trip_ids:
        raise ValueError(
            f"Invalid counts: realtime_trip_ids={realtime_trip_ids}, "
            f"matched_trip_ids={matched_trip_ids}"
        )
    if realtime_trip_ids < MATCH_GUARD_MIN_TRIPS:
        return True
    # Decimal text preserves the exact threshold without binary float rounding.
    return Fraction(matched_trip_ids, realtime_trip_ids) >= Fraction(str(MATCH_GUARD_MIN_SHARE))
