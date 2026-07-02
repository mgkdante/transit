"""gold.reader — gold's official virtual-mart read kernel (S7-close C2).

The read-time metric math the historic builders re-derive from the gold
spines lives HERE, importable by both gold/rollups and snapshots/builders
with no cycle (gold never imports snapshots; this package imports ONLY
stdlib + sqlalchemy + the sql_registry — locked by a no-cycle import test).
Submodules: buckets (shift/day_type), percentile (the ONE CDF interpolator),
histogram (hist/CoV/EWT/rounding), window (GrainWindows + trailing clauses),
projector (spine projector factory + habit read), rates (OTP/severe/Wilson).
"""

from transit_ops.gold.reader.buckets import (
    SHIFT_BOUNDS,
    SHIFT_DEFAULT,
    daytype_case_sql,
    infer_shift,
    shift_case_sql,
)
from transit_ops.gold.reader.histogram import (
    bunched_pct,
    cov_case_sql,
    delay_histogram_bins,
    ewt_min,
    hist_and_avg,
    round_half_away,
)
from transit_ops.gold.reader.percentile import cdf_percentile, pctile_min_from_hist
from transit_ops.gold.reader.projector import (
    PROJECT_TEMPLATE,
    ROUTE_ENTITY_CLAUSE,
    ROUTE_HABIT_SPINE_SQL,
    SPINE_HIST_COLS,
    hist_cols,
    spine_project_sql,
)
from transit_ops.gold.reader.rates import (
    MIN_N_RATE,
    WILSON_Z,
    avg_delay_min,
    otp_pct,
    otp_pct_severe_proxy,
    severe_pct,
    wilson_bounds,
    wilson_hi,
    wilson_lo,
)
from transit_ops.gold.reader.window import (
    SPINE_WINDOW_CLAUSE,
    GrainWindows,
    current_date_trailing_clause,
)

__all__ = [
    "MIN_N_RATE",
    "PROJECT_TEMPLATE",
    "ROUTE_ENTITY_CLAUSE",
    "ROUTE_HABIT_SPINE_SQL",
    "SHIFT_BOUNDS",
    "SHIFT_DEFAULT",
    "SPINE_HIST_COLS",
    "SPINE_WINDOW_CLAUSE",
    "WILSON_Z",
    "GrainWindows",
    "avg_delay_min",
    "bunched_pct",
    "cdf_percentile",
    "cov_case_sql",
    "current_date_trailing_clause",
    "daytype_case_sql",
    "delay_histogram_bins",
    "ewt_min",
    "hist_and_avg",
    "hist_cols",
    "infer_shift",
    "otp_pct",
    "otp_pct_severe_proxy",
    "pctile_min_from_hist",
    "round_half_away",
    "severe_pct",
    "shift_case_sql",
    "spine_project_sql",
    "wilson_bounds",
    "wilson_hi",
    "wilson_lo",
]
