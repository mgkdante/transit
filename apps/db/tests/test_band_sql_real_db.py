from decimal import Decimal

from sqlalchemy import text

from transit_ops.gold.reader import band_case_sql, band_of

_GOLDEN: list[tuple[int | Decimal | None, str]] = [
    (-86400, "early"),
    (-3601, "early"),
    (-61, "early"),
    (Decimal("-60.5"), "early"),
    (-60, "on_time"),
    (0, "on_time"),
    (300, "on_time"),
    (Decimal("300.5"), "late"),
    (301, "late"),
    (3601, "late"),
    (86400, "late"),
    (None, "unknown"),
]


def test_band_case_sql_matches_band_of(real_db_engine) -> None:
    with real_db_engine.connect() as conn:
        transaction = conn.begin()
        try:
            for sql_type in ("integer", "numeric", "double precision"):
                expected = {
                    value: band
                    for value, band in _GOLDEN
                    if sql_type != "integer" or not isinstance(value, Decimal)
                }
                values = ", ".join(
                    f"(CAST({'NULL' if value is None else value} AS {sql_type}))"
                    for value in expected
                )
                rows = conn.execute(
                    text(
                        f"SELECT v.x, {band_case_sql('v.x')} AS band FROM (VALUES {values}) AS v(x)"
                    )
                ).all()
                assert {row.x: row.band for row in rows} == expected
                for row in rows:
                    assert row.band == band_of(row.x)
        finally:
            transaction.rollback()
