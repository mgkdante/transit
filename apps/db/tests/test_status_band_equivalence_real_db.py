
from __future__ import annotations

from sqlalchemy import text

from transit_ops.snapshots.builders._helpers import (
    STATUS_BAND_CASE_SQL,
    _status_from_band,
)

_GOLDEN: list[tuple[float | None, str]] = [
    (-61.0, "early"),
    (-60.0, "on_time"),
    (0.0, "on_time"),
    (59.0, "on_time"),
    (60.0, "late"),
    (299.0, "late"),
    (300.0, "severe"),
    (301.0, "severe"),
    (None, "unknown"),
]


def test_status_band_case_sql_matches_old_python_bucketing(real_db_engine) -> None:
    band_case = STATUS_BAND_CASE_SQL.format(col="v.x")
    numeric = [s for s, _ in _GOLDEN if s is not None]
    values_rows = ", ".join(f"({s})" for s in numeric)
    sql = text(
        f"""
        SELECT v.x AS secs, {band_case} AS status_band
        FROM (VALUES {values_rows}) AS v(x)
        UNION ALL
        SELECT NULL::double precision AS secs,
               {STATUS_BAND_CASE_SQL.format(col="NULL::double precision")} AS status_band
        """
    )
    with real_db_engine.connect() as conn:
        transaction = conn.begin()
        try:
            rows = list(conn.execute(sql).mappings())
        finally:
            transaction.rollback()

    got: dict[float | None, str] = {}
    for r in rows:
        secs = None if r["secs"] is None else float(r["secs"])
        got[secs] = _status_from_band(r["status_band"])

    expected = {s: enum for s, enum in _GOLDEN}
    assert got == expected, f"band-equivalence drift: got {got!r}, expected {expected!r}"
