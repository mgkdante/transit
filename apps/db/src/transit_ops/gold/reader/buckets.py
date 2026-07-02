"""The ONE shift / day_type bucket source (SQL emitters + the Python twin).

Every hour->shift CASE and ISODOW weekday/weekend CASE in the pipeline is
emitted from SHIFT_BOUNDS through these formatters, so the headway rollups,
the spine projectors, the stop-grain reads and the Python `infer_shift` can
never drift apart. The emitters are byte-exact against the historical
literals (locked by frozen-string tests in tests/test_gold_reader.py):
`indent` is the column of CASE/END, the WHEN/ELSE body sits at indent+4,
`wrap=True` breaks after the hour/ISODOW expression with the BETWEEN
continuation at indent+8, and `lead=False` drops the leading pad on the CASE
line for f-string splices that already sit at the target column.
"""

from __future__ import annotations

# (lo, hi, label): hour BETWEEN lo AND hi (closed, ints) -> label; else night.
SHIFT_BOUNDS: tuple[tuple[int, int, str], ...] = (
    (6, 8, "am_peak"),
    (9, 14, "midday"),
    (15, 18, "pm_peak"),
    (19, 22, "evening"),
)
SHIFT_DEFAULT = "night"

# ISODOW 1..5 -> weekday, else weekend (single source for daytype_case_sql).
DAYTYPE_WEEKDAY_LO, DAYTYPE_WEEKDAY_HI = 1, 5


def _case_sql(
    whens: list[tuple[str, str, str]], default: str, *, indent: int, lead: bool, wrap: bool
) -> str:
    # whens = (tested expression, "lo AND hi", label) triples.
    pad = " " * indent
    body = " " * (indent + 4)
    cont = " " * (indent + 8)
    lines = [f"{pad}CASE" if lead else "CASE"]
    for expr, between, label in whens:
        if wrap:
            lines.append(f"{body}WHEN {expr}")
            lines.append(f"{cont}BETWEEN {between} THEN '{label}'")
        else:
            lines.append(f"{body}WHEN {expr} BETWEEN {between} THEN '{label}'")
    lines.append(f"{body}ELSE '{default}'")
    lines.append(f"{pad}END")
    return "\n".join(lines)


def shift_case_sql(
    hour_expr: str, *, indent: int = 8, lead: bool = False, wrap: bool = False
) -> str:
    """Emit the canonical hour->shift CASE over `hour_expr` (an int hour 0..23 expr)."""
    whens = [(hour_expr, f"{lo} AND {hi}", label) for lo, hi, label in SHIFT_BOUNDS]
    return _case_sql(whens, SHIFT_DEFAULT, indent=indent, lead=lead, wrap=wrap)


def daytype_case_sql(
    dow_date_expr: str, *, indent: int = 8, lead: bool = False, wrap: bool = False
) -> str:
    """Emit the canonical ISODOW weekday/weekend CASE over a date-valued expr."""
    whens = [
        (
            f"EXTRACT(ISODOW FROM {dow_date_expr})",
            f"{DAYTYPE_WEEKDAY_LO} AND {DAYTYPE_WEEKDAY_HI}",
            "weekday",
        )
    ]
    return _case_sql(whens, "weekend", indent=indent, lead=lead, wrap=wrap)


def infer_shift(hour: int) -> str:
    """Python twin of shift_case_sql — closed int bounds == the SQL BETWEEN buckets."""
    for lo, hi, label in SHIFT_BOUNDS:
        if lo <= hour <= hi:
            return label
    return SHIFT_DEFAULT  # {23, 0..5}
