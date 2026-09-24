"""Historic snapshot builders over gold reliability rollups.

OTP is round(100 * on_time / known), or None for missing counts or known == 0.
Published rounding is half-away-from-zero for Postgres ROUND parity.
Stop reliability uses the severe-delay proxy over actual stop observations.
Average delay is round(avg_delay_seconds / 60, 1); severe_pct is round(100 * sev / known, 1).
Daily percentiles use route-local days and the most recent closed stop day.
Weekly and monthly percentiles stay None because percentiles are not additive.
"""

from __future__ import annotations

from transit_ops.snapshots.builders.historic import hotspots_history as hotspots_history
from transit_ops.snapshots.builders.historic import (
    repeat_offenders_history as repeat_offenders_history,
)
from transit_ops.snapshots.builders.historic.alert_archive import (
    AlertArchiveBundle,
    build_alert_archive,
)
from transit_ops.snapshots.builders.historic.hotspots_history import (
    HotspotsHistoryPlan,
    build_hotspots_history_plan,
    build_hotspots_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.line_history import (
    LINE_HISTORY_ENTITY_BATCH_SIZE,
    LINE_HISTORY_METRICS,
    LineHistoryBundle,
    LineHistoryPlan,
    LineHistoryStreamSummary,
    build_line_history,
    build_line_history_from_rows,
    build_line_history_plan,
    build_line_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.network_history import (
    NetworkHistoryBundle,
    NetworkHistoryPlan,
    build_network_history,
    build_network_history_from_rows,
    build_network_history_plan,
    build_network_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.network_trend import build_network_trend
from transit_ops.snapshots.builders.historic.provenance import build_provenance
from transit_ops.snapshots.builders.historic.repeat_offenders_history import (
    RepeatOffendersHistoryPlan,
    build_repeat_offenders_history_plan,
    build_repeat_offenders_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.route_reliability import build_route_reliability
from transit_ops.snapshots.builders.historic.route_reliability_batch import (
    build_all_route_reliability,
)
from transit_ops.snapshots.builders.historic.small_surfaces import (
    build_alert_history,
    build_hotspots,
    build_receipts,
    build_repeat_offenders,
)
from transit_ops.snapshots.builders.historic.stop_history import (
    STOP_HISTORY_ENTITY_BATCH_SIZE,
    STOP_HISTORY_METRICS,
    StopHistoryBundle,
    StopHistoryPlan,
    StopHistoryPointerSummary,
    StopHistoryStreamSummary,
    build_stop_history,
    build_stop_history_from_rows,
    build_stop_history_plan,
    build_stop_history_plan_from_rows,
)
from transit_ops.snapshots.builders.historic.stop_reliability import build_stop_reliability

__all__ = [
    "build_network_trend",
    "build_network_history",
    "build_network_history_from_rows",
    "build_network_history_plan",
    "build_network_history_plan_from_rows",
    "build_line_history",
    "build_line_history_from_rows",
    "build_line_history_plan",
    "build_line_history_plan_from_rows",
    "build_stop_history",
    "build_stop_history_from_rows",
    "build_stop_history_plan",
    "build_stop_history_plan_from_rows",
    "build_provenance",
    "build_route_reliability",
    "build_all_route_reliability",
    "build_alert_history",
    "build_alert_archive",
    "build_hotspots",
    "build_hotspots_history_plan",
    "build_hotspots_history_plan_from_rows",
    "build_receipts",
    "build_repeat_offenders",
    "build_repeat_offenders_history_plan",
    "build_repeat_offenders_history_plan_from_rows",
    "build_stop_reliability",
    "AlertArchiveBundle",
    "HotspotsHistoryPlan",
    "RepeatOffendersHistoryPlan",
    "NetworkHistoryBundle",
    "NetworkHistoryPlan",
    "LineHistoryBundle",
    "LineHistoryPlan",
    "LineHistoryStreamSummary",
    "StopHistoryBundle",
    "StopHistoryPlan",
    "StopHistoryPointerSummary",
    "StopHistoryStreamSummary",
    "LINE_HISTORY_ENTITY_BATCH_SIZE",
    "LINE_HISTORY_METRICS",
    "STOP_HISTORY_ENTITY_BATCH_SIZE",
    "STOP_HISTORY_METRICS",
]
