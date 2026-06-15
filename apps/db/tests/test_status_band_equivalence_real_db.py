"""Real-DB band-equivalence lock for the build_trips status refactor (slice-9.1.1-theta).

build_trips used to bucket ``avg_delay_seconds`` in Python via
``_status_from_delay_seconds``. That recompute is gone: the band is now computed
IN-QUERY by ``STATUS_BAND_CASE_SQL`` (character-identical to migration 0020's
``gold.current_vehicle_map_with_status.status_band`` CASE) and mapped to the
status enum by ``_status_from_band``.

This test PROVES the SQL CASE -> ``_status_from_band`` pipeline reproduces the
exact OLD Python behavior at every band boundary, by running the real fragment
against a Postgres VALUES grid (so band-edge inclusivity — strict ``<`` vs
``<=`` — is exercised by the actual database, which an offline SQL-string test
cannot do). The golden table below is the OLD ``_status_from_delay_seconds``
contract verbatim.

Runs ONLY when TRANSIT_TEST_DATABASE_URL points at a disposable Postgres:

    TRANSIT_TEST_DATABASE_URL="postgresql+psycopg://..." \
        uv run pytest tests/test_status_band_equivalence_real_db.py -v

No transit schema/migration is required — the VALUES grid is self-contained.
Each test runs inside one transaction and rolls back. Never point at production.
"""

from __future__ import annotations

import os

import pytest
from sqlalchemy import create_engine, text

from transit_ops.snapshots.builders._helpers import (
    STATUS_BAND_CASE_SQL,
    _status_from_band,
)

DB_URL = os.environ.get("TRANSIT_TEST_DATABASE_URL")

pytestmark = pytest.mark.skipif(
    not DB_URL,
    reason="TRANSIT_TEST_DATABASE_URL not set — real-DB equivalence test skipped",
)

# Golden table: avg_delay_seconds -> status enum, the OLD _status_from_delay_seconds
# behavior (mirrors migration 0020). Boundaries exercise strict-< inclusivity:
#   s < -60 -> early ; -60 <= s < 60 -> on_time ; 60 <= s < 300 -> late ;
#   s >= 300 -> severe ; NULL -> unknown.
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


def test_status_band_case_sql_matches_old_python_bucketing() -> None:
    """The 0020 CASE fragment + _status_from_band == the retired Python bucketing,
    at every band edge, evaluated by the real Postgres engine."""
    engine = create_engine(DB_URL)
    band_case = STATUS_BAND_CASE_SQL.format(col="v.x")
    # Build a VALUES grid of doubled-precision delay seconds plus a NULL case, and
    # let Postgres emit the band label for each via the authoritative CASE.
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
    try:
        with engine.connect() as conn:
            transaction = conn.begin()
            try:
                rows = list(conn.execute(sql).mappings())
            finally:
                transaction.rollback()
    finally:
        engine.dispose()

    got: dict[float | None, str] = {}
    for r in rows:
        secs = None if r["secs"] is None else float(r["secs"])
        got[secs] = _status_from_band(r["status_band"])

    expected = {s: enum for s, enum in _GOLDEN}
    assert got == expected, f"band-equivalence drift: got {got!r}, expected {expected!r}"
