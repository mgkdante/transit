"""Snapshot builders: gold/silver -> /v1 snapshot pydantic models.

Each ``build_*`` function runs one or more SELECTs and maps the rows onto the
contract models in :mod:`transit_ops.snapshots.contract`.  SQL is written
against column names verified by reading the view-defining Alembic migrations
AND by querying production directly.

This package was split from a single ``builders.py`` module (slice-9.1.1-epsilon)
into per-tier submodules with a shared helper leaf — a pure mechanical refactor,
zero behavior change.  The dependency graph is acyclic:
``__init__ -> {live, static, historic} -> _helpers -> contract``.

  * :mod:`._helpers` — value-domain mappings, small pure helpers, the
    deterministic representative-service-date resolution, and the entity
    name/habits/headway resolvers shared across tiers.
  * :mod:`.live`     — vehicles, trips, stop_departures, alerts, network, manifest.
  * :mod:`.static`   — labels, routes/stops indexes, route, all-stops, basemap.
  * :mod:`.historic` — network_trend, route/stop reliability, hotspots,
    repeat_offenders, receipts, alert_history, provenance.

Names are re-exported here so importers can keep using
``transit_ops.snapshots.builders`` (both ``from ... import name`` and the
``builders.<name>`` attribute access used by :mod:`transit_ops.snapshots.publish`)
unchanged.  Status-band thresholds mirror migration 0020; network OTP counts
on_time+late as the unified [-60s,+300s) band over vehicles with known status.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Helper leaf — pure helpers, value-domain constants, and shared SQL re-exported
# for tests/tools that reach into the builders internals.
# ---------------------------------------------------------------------------
from transit_ops.snapshots.builders._helpers import (
    _ROUTE_NAMES_SQL,
    _STOP_NAMES_SQL,
    _avg_delay_min,
    _build_habits_matrix,
    _delay_min,
    _entity_name_maps,
    _gtfs_min,
    _infer_shift,
    _iso,
    _iso_date,
    _kmh,
    _median_headway,
    _opt_int,
    _opt_iso,
    _otp_pct,
    _otp_pct_severe_proxy,
    _percentile,
    _public_impact_score,
    _representative_services,
    _round5,
    _route_sort_key,
    _sample_times,
    _scheduled_headway_by_shift,
    _severe_pct,
    _severity_code,
    _shift_sort_min,
    _split_csv,
    _status_from_band,
    _wallclock,
)

# ---------------------------------------------------------------------------
# Historic tier — builders + the SQL constants tests reach into.
# ---------------------------------------------------------------------------
from transit_ops.snapshots.builders.historic import (
    _RECEIPTS_NETWORK_DAILY_SQL,
    _RECEIPTS_NOT_REPORTED_ROUTES_SQL,
    _RECEIPTS_SERVICE_STATES_SQL,
    _RECEIPTS_SHIFT_DAILY_SQL,
    _RECEIPTS_WORST_ROUTE_SQL,
    _RECEIPTS_WORST_STOP_SQL,
    _ROUTE_REL_DAILY_SQL,
    _TREND_DAILY_SQL,
    _TREND_FACT_SQL,
    build_alert_history,
    build_hotspots,
    build_network_trend,
    build_provenance,
    build_receipts,
    build_repeat_offenders,
    build_route_reliability,
    build_stop_reliability,
)

# ---------------------------------------------------------------------------
# Live tier.
# ---------------------------------------------------------------------------
from transit_ops.snapshots.builders.live import (
    _STOP_DEPARTURES_PER_ROUTE_CAP,
    _STOP_DEPARTURES_SQL,
    _TRIP_DEPARTURES_SQL,
    build_alerts,
    build_manifest,
    build_network,
    build_stop_departures,
    build_trips,
    build_vehicles,
)

# ---------------------------------------------------------------------------
# Static tier — builders + the bilingual label dicts tests reach into.
# ---------------------------------------------------------------------------
from transit_ops.snapshots.builders.static import (
    _STATIC_LABELS_EN,
    _STATIC_LABELS_FR,
    build_all_stops_data,
    build_basemap,
    build_labels,
    build_route,
    build_routes_index,
    build_stops_index,
)

__all__ = [
    # live
    "build_vehicles",
    "build_trips",
    "build_stop_departures",
    "build_alerts",
    "build_network",
    "build_manifest",
    # static
    "build_labels",
    "build_routes_index",
    "build_stops_index",
    "build_route",
    "build_all_stops_data",
    "build_basemap",
    # historic
    "build_network_trend",
    "build_route_reliability",
    "build_stop_reliability",
    "build_hotspots",
    "build_repeat_offenders",
    "build_receipts",
    "build_alert_history",
    "build_provenance",
    # private names imported by tests / publish.py
    "_iso",
    "_iso_date",
    "_gtfs_min",
    "_infer_shift",
    "_kmh",
    "_median_headway",
    "_route_sort_key",
    "_sample_times",
    "_wallclock",
    "_otp_pct",
    "_otp_pct_severe_proxy",
    "_severity_code",
    "_round5",
    "_opt_int",
    "_opt_iso",
    "_delay_min",
    "_split_csv",
    "_percentile",
    "_status_from_band",
    "_avg_delay_min",
    "_severe_pct",
    "_public_impact_score",
    "_representative_services",
    "_scheduled_headway_by_shift",
    "_entity_name_maps",
    "_build_habits_matrix",
    "_shift_sort_min",
    # SQL constants imported by tests
    "_STATIC_LABELS_FR",
    "_STATIC_LABELS_EN",
    "_RECEIPTS_NETWORK_DAILY_SQL",
    "_RECEIPTS_NOT_REPORTED_ROUTES_SQL",
    "_RECEIPTS_SERVICE_STATES_SQL",
    "_RECEIPTS_SHIFT_DAILY_SQL",
    "_RECEIPTS_WORST_ROUTE_SQL",
    "_RECEIPTS_WORST_STOP_SQL",
    "_ROUTE_NAMES_SQL",
    "_ROUTE_REL_DAILY_SQL",
    "_STOP_NAMES_SQL",
    "_TREND_DAILY_SQL",
    "_TREND_FACT_SQL",
    "_STOP_DEPARTURES_SQL",
    "_STOP_DEPARTURES_PER_ROUTE_CAP",
    "_TRIP_DEPARTURES_SQL",
]
