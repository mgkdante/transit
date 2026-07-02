"""build_provenance — feed lineage, freshness, retention policy, methodology.

Split out of the former monolithic ``historic.py`` (S7-close C3) verbatim. The
methodology dict is kept inline in ``build_provenance`` (its only caller); the
conformance carve-out (``_build_provenance_conformance``) stays alongside it.
"""

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
    Retention and methodology are hardcoded v1 constants.
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
                "on-time = observed delay between -60s and +300s "
                "(at most 1 min early, less than 5 min late); route OTP = "
                "on-time observations / observations with known delay; "
                "stop-level otp_pct is observations not severe(>300s) over "
                "per-stop delay observations, a severe-delay proxy rather "
                "than true on-time-band OTP"
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
                "as of 2026-07-01 every Python-side published rounding uses "
                "half-away-from-zero ties (matching Postgres ROUND), replacing "
                "Python's banker's rounding; values move only at exact-.5 "
                "boundaries (S7-B rebaseline)"
            ),
            "delay_unit": (
                "seconds from schedule; delay statistics exclude observations "
                "with |delay| > 1 hour (ghost-trip guard); severe = >300s and <=3600s"
            ),
            "percentiles": (
                "network p90 from fact (live + trailing 14d trend); route and "
                "stop p50/p90 from a daily fact-derived percentile rollup, "
                "computed per closed local day and retained 730 days"
            ),
            "headway": (
                "observed = median gap between consecutive trip starts "
                "(first realtime observation with a computed delay) in the "
                "busiest direction, per weekday service day, trailing 14d; "
                "scheduled = representative-weekday first-stop departures, "
                "busiest direction; excess_wait (windowed grains) = passenger-"
                "weighted Excess Wait Time max(0, AWT - scheduled/2), AWT = "
                "sum(gap^2)/(2*sum(gap)) over the window's gaps (bunching-aware); "
                "the scalar whole-history rows keep the typical-gap proxy "
                "max(0, observed - scheduled)"
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
                "English alert text (header_text_en, description_en) is present "
                "only where STM published an explicit English variant and only "
                "for content-hashed rows captured since 2026-06-09; it is "
                "honest-NULL otherwise, including for pre-2026-06-09 legacy "
                "history entries built from NULL-hash rows, which carry no EN "
                "text until they age out of the history window"
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
                "day and retained 730 days; null when no trips were observed"
            ),
            "occupancy": (
                "historic crowding = GTFS-RT OccupancyStatus band shares over "
                "band-bearing pings (no numeric load factor); CRUSHED_STANDING "
                "folds into standing; NOT_ACCEPTING/NO_DATA/NOT_BOARDABLE excluded; "
                "summed per closed local day and retained 730 days; null when no "
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
                "= the last trip's LATEST (terminal) observation deviation; retained 730 days"
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
