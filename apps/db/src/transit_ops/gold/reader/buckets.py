from __future__ import annotations

# Hour bounds are inclusive; the remaining hours map to night.
SHIFT_BOUNDS: tuple[tuple[int, int, str], ...] = (
    (6, 8, "am_peak"),
    (9, 14, "midday"),
    (15, 18, "pm_peak"),
    (19, 22, "evening"),
)
SHIFT_DEFAULT = "night"

DAYTYPE_WEEKDAY_LO, DAYTYPE_WEEKDAY_HI = 1, 5


def _case_sql(
    whens: list[tuple[str, str, str]], default: str, *, indent: int, lead: bool, wrap: bool
) -> str:
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
    whens = [(hour_expr, f"{lo} AND {hi}", label) for lo, hi, label in SHIFT_BOUNDS]
    return _case_sql(whens, SHIFT_DEFAULT, indent=indent, lead=lead, wrap=wrap)


def daytype_case_sql(
    dow_date_expr: str, *, indent: int = 8, lead: bool = False, wrap: bool = False
) -> str:
    whens = [
        (
            f"EXTRACT(ISODOW FROM {dow_date_expr})",
            f"{DAYTYPE_WEEKDAY_LO} AND {DAYTYPE_WEEKDAY_HI}",
            "weekday",
        )
    ]
    return _case_sql(whens, "weekend", indent=indent, lead=lead, wrap=wrap)


def infer_shift(hour: int) -> str:
    for lo, hi, label in SHIFT_BOUNDS:
        if lo <= hour <= hi:
            return label
    return SHIFT_DEFAULT
