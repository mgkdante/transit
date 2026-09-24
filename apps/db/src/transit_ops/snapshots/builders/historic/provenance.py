"""Publish source lineage, freshness, retention and metric methodology."""

from __future__ import annotations

from typing import TYPE_CHECKING

from transit_ops.settings import get_settings
from transit_ops.snapshots.builders._helpers import (
    MIN_N_RATE,
    WILSON_Z,
    _opt_iso,
)
from transit_ops.snapshots.contract import (
    Provenance,
    ProvenanceConformance,
    ProvenanceFreshness,
    ProvenanceSource,
)
from transit_ops.sql_registry import named_query

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


_PROVENANCE_SOURCES_SQL = named_query(
    "provenance.sources",
    """
    SELECT dataset_kind, storage_backend, storage_path, source_url, loaded_at_utc
    FROM gold.source_lineage_reporting
    WHERE provider_id = :provider_id
      AND is_current = true
    ORDER BY dataset_kind
    """
)

_PROVENANCE_FRESHNESS_SQL = named_query(
    "provenance.freshness",
    """
    SELECT endpoint_key, status, completed_age_seconds
    FROM gold.feed_freshness_current
    WHERE provider_id = :provider_id
    ORDER BY endpoint_key
    """
)

# Feed conformance for the provider's current static load: the out-of-norm signal
# is the unknown/extra GTFS members captured verbatim in silver.gtfs_extra_rows
# (mirrors /health check_feed_conformance, scoped to this provider). Empty result
# => no current static dataset => no conformance block.
_PROVENANCE_CONFORMANCE_SQL = named_query(
    "provenance.conformance",
    """
    SELECT
        (
            SELECT count(*)
            FROM silver.gtfs_extra_rows AS ger
            WHERE ger.dataset_version_id = dv.dataset_version_id
        )::bigint AS extra_row_count,
        (
            SELECT array_agg(DISTINCT ger.source_file_name)
            FROM silver.gtfs_extra_rows AS ger
            WHERE ger.dataset_version_id = dv.dataset_version_id
        ) AS unknown_members
    FROM core.dataset_versions AS dv
    WHERE dv.provider_id = :provider_id
      AND dv.is_current IS TRUE
      AND dv.dataset_kind = 'static_schedule'
    """
)


_PROVIDER_GAPS: dict[str, list[str]] = {"stm": ["metro_realtime"]}


def build_provenance(
    conn: Connection, provider_id: str = "stm", *, generated_utc: str
) -> Provenance:
    """Build provenance.json — feed lineage, freshness, retention policy, methodology.

    Sources from gold.source_lineage_reporting (is_current=true only).
    Freshness from gold.feed_freshness_current.
    Retention follows runtime settings; methodology describes the published fields.
    gaps lists known missing feeds (STM metro publishes no realtime feed).
    """
    params = {"provider_id": provider_id}

    # Provider-specific known gaps. metro_realtime is STM's: it runs a métro whose
    # realtime is unpublished. Bus/LRT-only networks (STO/OC/STS) have no such gap.
    gaps = list(_PROVIDER_GAPS.get(provider_id, []))

    sources: list[ProvenanceSource] = []
    for r in conn.execute(_PROVENANCE_SOURCES_SQL, params).mappings():
        backend = r["storage_backend"]
        path = r["storage_path"]
        chain = f"{backend}:{path}" if backend else r["source_url"]
        sources.append(
            ProvenanceSource(
                feed=str(r["dataset_kind"]),
                chain=chain,
                last_loaded_utc=_opt_iso(r["loaded_at_utc"]),
            )
        )

    freshness: list[ProvenanceFreshness] = []
    for r in conn.execute(_PROVENANCE_FRESHNESS_SQL, params).mappings():
        freshness.append(
            ProvenanceFreshness(
                feed=str(r["endpoint_key"]),
                status=r["status"],
                age_s=(
                    int(r["completed_age_seconds"])
                    if r["completed_age_seconds"] is not None
                    else None
                ),
            )
        )

    conformance = _build_provenance_conformance(conn, params)

    # Retention numbers derive from settings so the citizen-facing policy can
    # never drift from the actual prune defaults (detail = capped facts, aggregate
    # = warm rollups). The methodology copy below mirrors aggregate_days verbatim.
    _settings = get_settings()
    return Provenance(
        generated_utc=generated_utc,
        sources=sources,
        freshness=freshness,
        conformance=conformance,
        retention={
            "detail_days": _settings.GOLD_FACT_RETENTION_DAYS,
            "aggregate_days": _settings.GOLD_WARM_ROLLUP_RETENTION_DAYS,
        },
        methodology={
            "otp_definition": (
                "on-time band = -60s <= delay < +300s. Historical route/network OTP counts "
                "on-time observations over known-delay observations. Live OTP counts "
                "map-eligible vehicle-position rows in that band over rows with known status. "
                "Historical stop-level otp_pct is a not-severe proxy over eligible per-stop "
                "delay observations, not on-time-band OTP."
            ),
            "reliability_floor": (
                f"reliable-enough = {MIN_N_RATE} known-delay observations "
                "(Chart Doctrine MIN_N_RATE). Rates below it are shown with their "
                "raw observation_count but flagged low-confidence, never suppressed. "
                "Each reliability period carries observation_count plus the 95% "
                "Wilson score bounds (wilson_lo / wilson_hi) so the UI gates display "
                "by depth and ranks on the lower bound, not the raw rate."
            ),
            # Machine-readable so the web reads ONE authoritative value (methodology
            # is additionalProperties:true / z.unknown() — no schema or Zod change).
            "min_n_rate": MIN_N_RATE,
            "wilson_z": WILSON_Z,
            "rounding": (
                "Snapshot metric rounding uses decimal half-away-from-zero ties at each field "
                "precision. Methodology live-2, reliability-2 and alerts-2 apply this rule "
                "consistently, including live whole-minute percentiles and histogram "
                "assignment, alert duration and compatible historical outputs. Retained "
                "version-1 artifacts keep their original values; compare methodology versions "
                'when reproducing a result. Live histogram bins still classify rounded '
                'whole-minute '
                "trip means."
            ),
            "network_totals_basis": (
                "network trend/receipt totals derive from route-attributed "
                "observations (2026-07-02 spine re-point); observations without "
                "a route_id are excluded where the legacy path counted them "
                "under an unrouted partition"
            ),
            "delay_unit": (
                "Predicted schedule deviations are measured in seconds. Delay summaries use "
                "their documented populations and typically exclude |delay| > 1 hour; route OTP "
                "retains all known-delay observations. Historical severe = >300s and <=3600s; "
                "current live severity uses its separate >=300s boundary."
            ),
            "percentiles": (
                "Live network p50/p90 give each current trip-average predicted delay equal "
                "weight. Daily route/stop percentiles use eligible signed delay observations on "
                "the provider-local capture date, including repeated predictions. Retained "
                "multi-day histogram percentiles are estimates, not averages of exact daily "
                "quantiles. Network trend p90 uses its recent detailed-fact window; missing "
                "historical p90 stays unknown."
            ),
            "headway": (
                "Observed headway is a gap between first trip appearances in the feed, not a "
                "measured stop-arrival interval. Retained 1/7/30-day windows pool weekday gap "
                "histograms for the busiest direction selected separately in each window; "
                "observed_min is an estimated median, CoV uses pooled gap moments, and bunching "
                "is estimated from histogram bins. The scalar fallback uses the configured "
                "raw-fact retention window (14 days by default). Scheduled headway uses the "
                "current representative weekday timetable. Windowed EWT models uniform rider "
                "arrivals: max(0, sum(gap^2)/(2*sum(gap)) - scheduled/2). Scalar rows retain "
                "max(0, observed median - scheduled median). The web EWT headline is an "
                "unweighted mean of available shift estimates, not a pooled daily wait."
            ),
            "history_freeze": (
                "closed reporting periods are immutable after they leave the "
                "10-day open window; later runs rebuild only open hours/dates "
                "and derived files read frozen hourly/daily history"
            ),
            "service_time_conversion": (
                "GTFS stop_times are interpreted as elapsed service-day offsets "
                "from the local noon-minus-12h anchor; on fall-back days the "
                "repeated 01:00-01:59 hour follows that elapsed-time convention"
            ),
            "alert_text_en": (
                "English alert text fields (header_text_en, description_en) are "
                "populated only from explicitly tagged English variants. Once "
                "observed for a content version, Silver's monotonic merge retains "
                "the last explicit English value when later raw observations omit "
                "English or leave it untagged; the fields remain NULL when "
                "explicit English has never been observed for that content "
                "version, plus a legacy tail: history entries built solely from "
                "pre-2026-06-09 NULL-hash rows carry no English text regardless "
                "of what the provider published, until they age out of the "
                "retention window. Coverage is measured from pre-coalescing "
                "observations, never from the monotonic English fields on Silver "
                "SCD rows."
            ),
            "alert_history_window": (
                "historic/alert_history.json serves the full honest retention "
                f"span — the trailing {_settings.SILVER_I3_CLOSED_RETENTION_DAYS} "
                "days (SILVER_I3_CLOSED_RETENTION_DAYS), provider-local, disclosed "
                "as window_start/window_end; alerts are the newest-first distinct "
                "alerts in that window, capped at 500 with total_in_window + "
                "truncated flagging when more existed. Each entry lists ALL its "
                "active windows (active_periods); alerts captured before the S15 "
                "multi-period capture (2026-07-02) carry only their primary window "
                "as a 1-element list and a null url — the extra windows were "
                "dropped at ingest and are not recoverable"
            ),
            "network_no_data": (
                "network.json on_time_pct, coverage_pct, delay_p50_min, "
                "delay_p90_min and feed_freshness_s are null (not 0) when their "
                "denominator is empty — no known-status vehicles, no live fleet, "
                "no delay observations, or no completed ingestion run; a feed "
                "blackout is reported as no-data, never as a fabricated 0% or 0s"
            ),
            "cancellation": (
                "cancellation_rate = canceled trip-days / observed trip-days, "
                "where a trip-day is a distinct (trip_id, start_date) seen in the "
                "realtime feed and counts canceled if ever reported with "
                "schedule_relationship=CANCELED; the denominator is RT-reported "
                "trips, NOT the full published schedule; computed per closed local "
                'day and retained under the configured aggregate policy; null when no trips '
                'were observed. '
                "SCHEDULED UNIVERSE (2026-07-02, GC2 H1): scheduled_trip_days = "
                "distinct scheduled trips active that date after resolving the "
                "static GTFS calendar ∩ calendar_dates (exception_type 1/2, incl. "
                "calendar_dates-only feeds) against the current edition; "
                "delivered_trip_days = total_trip_days − canceled_trip_days "
                "(RT-observed, run); silent_trip_days = max(scheduled − total_observed, "
                "0) = scheduled trips that never appeared in ANY realtime poll (clamped "
                "at 0, so over-delivery is hidden); service_completeness_pct = 100 × "
                "delivered / scheduled is the honest scheduled-complete readout. NOTE: "
                "cancellation_rate_pct KEEPS its RT-observed denominator (total = "
                "RT-reported trip-days) and is NOT redefined; the scheduled-aware view "
                "is the new service_completeness field. Scheduled fields are null on "
                "history before 2026-07-02 and on editions with no silver schedule"
            ),
            "occupancy": (
                "historic crowding = GTFS-RT OccupancyStatus band shares over "
                "band-bearing pings (no numeric load factor); CRUSHED_STANDING "
                "folds into standing; NOT_ACCEPTING/NO_DATA/NOT_BOARDABLE excluded; "
                'summed per closed local day and retained under the configured aggregate '
                'policy; null when no '
                "occupancy telemetry exists, never an all-zero mix"
            ),
            "headway_regularity": (
                "cov = stddev/mean of observed trip-start gaps in the busiest "
                "weekday direction per shift (trailing 14d), null with fewer than "
                "2 gaps; bunched = share of gaps under half the shift median "
                "headway; the 0.5x threshold is a fixed bunching definition"
            ),
            "service_span": (
                "first/last trip = earliest/latest first-realtime-observation "
                "trip-start per route per GTFS SERVICE DAY (start_date, NOT the "
                "calendar capture day — overnight trips keep their own service day, "
                "no fake 00:00 first departure); observed activity, not the scheduled "
                "departure; span in minutes (may exceed 24h on overnight service); "
                "first delay = the first trip's first-observation deviation, last delay "
                "= the last trip's LATEST (terminal) observation deviation; retained under the "
                'configured aggregate policy'
            ),
            "alert_breakdown": (
                "distinct content-hashed alerts in the 30-day window grouped by "
                "GTFS cause/effect/severity; NULL/blank labeled 'unknown' (STM "
                "frequently omits cause/effect); median duration from active-period "
                "start/end, the high-confidence dimension; over the 200-alert cap"
            ),
            "skipped_stops": (
                "skipped-stop rate = stop-time updates flagged SKIPPED (GTFS-RT "
                "StopTimeUpdate.ScheduleRelationship=1) / all observed stop-time "
                "updates per route per closed local day; accrued FORWARD from the "
                "date this metric shipped (ramp-in, no historical backfill); null "
                "when no stop-time updates were observed"
            ),
        },
        gaps=gaps,
    )


def _build_provenance_conformance(
    conn: Connection, params: dict
) -> ProvenanceConformance | None:
    """Feed conformance for the provider's current static load, or None when the
    provider has no current static dataset (nothing to describe)."""
    rows = list(conn.execute(_PROVENANCE_CONFORMANCE_SQL, params).mappings())
    if not rows:
        return None
    row = rows[0]
    unknown_members = sorted(row.get("unknown_members") or [])
    extra_row_count = int(row.get("extra_row_count") or 0)
    status = "out_of_norm" if (unknown_members or extra_row_count) else "conformant"
    return ProvenanceConformance(
        status=status,
        unknown_members=unknown_members,
        extra_row_count=extra_row_count,
    )
