"""Static-tier builders: gold/silver -> /v1 static snapshot pydantic models.

STATIC sources: ``gold.dim_route``/``dim_stop``/``map_stops``, ``gold.map_route_lines``
(``geojson`` is jsonb), ``silver.trips``/``stop_times``/``calendar``, ``gold.report_labels``.
Static schedules are computed for a deterministic *representative service date*
(busiest weekday / weekend in the dataset's current window) so headways and stop
times reflect one coherent day rather than the union of all 144 service calendars.
"""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import text

from transit_ops.snapshots.builders._helpers import (
    _BOARDABLE_STOP,
    _CURRENT_DATASET_VERSION_SQL,
    _ROUTE_SCHEDULE_SQL,
    _SHIFT_ORDER,
    _SHIFT_WINDOWS,
    _gtfs_min,
    _infer_shift,
    _median_headway,
    _representative_services,
    _round5,
    _route_sort_key,
    _sample_times,
    _shift_sort_min,
    _wallclock,
)
from transit_ops.snapshots.contract import (
    BasemapFile,
    LabelsFile,
    RouteDirection,
    RouteFile,
    RouteIndexEntry,
    RoutesIndex,
    RouteStop,
    ScheduledRoute,
    ServicePeriod,
    StopFile,
    StopIndexEntry,
    StopsIndex,
)

if TYPE_CHECKING:  # pragma: no cover - typing only
    from sqlalchemy.engine import Connection


# ---------------------------------------------------------------------------
# Static labels
# ---------------------------------------------------------------------------

# Citizen-facing methodology / gap / attribution copy (slice-9.1.1t).
# The methodology.* wording encodes thresholds that live in SQL/code — when those
# move, this copy MUST move in the same PR (a cross-invariant test ties provenance
# methodology keys to these label keys; an 'early' assertion locks the early band).
# Threshold sources:
#   - on-time band: migration 0020 status_band CASE — avg_delay < -60s => Early
#     (NOT on time), < +60s => On time, < +300s => Late, else Severe; build_network
#     counts only the on-time bucket against known, so early vehicles are excluded.
#   - delayed = delay_seconds > 0 (gold/rollups.py); severe = > 300s (gold/rollups.py);
#     daily public views report severe as the "delayed" surface.
#   - retention constants mirror build_provenance: detail 14d, aggregate 365d.
# The fr/en key sets MUST stay identical (parity test) — manifest.attribution stays
# the unlocalized English machine fallback; these labels are the citizen surface.
_STATIC_LABELS_FR: dict[str, str] = {
    "status.early": "En avance",
    "status.on_time": "À l'heure",
    "status.late": "En retard",
    "status.severe": "Critique",
    "status.unknown": "Inconnu",
    "severity.critical": "Critique",
    "severity.high": "Élevé",
    "severity.watch": "Surveillance",
    "occupancy.empty": "Vide",
    "occupancy.many_seats": "Nombreuses places",
    "occupancy.few_seats": "Quelques places",
    "occupancy.standing": "Debout seulement",
    "occupancy.full": "Complet",
    "methodology.otp_definition": (
        "À l'heure : en direct, un véhicule est à l'heure si son retard moyen se "
        "situe entre une minute d'avance et moins de cinq minutes de retard; plus "
        "tôt, il est compté « en avance », pas à l'heure, et cinq minutes de retard "
        "ou plus sont « sévères ». Dans l'historique quotidien, un passage est "
        "ponctuel s'il n'a aucun retard enregistré; les vues par ligne et par arrêt "
        "comptent les retards sévères (plus de 5 minutes)."
    ),
    "methodology.delay_unit": (
        "Les retards sont mesurés en secondes par rapport à l'horaire GTFS publié "
        "par la STM, puis affichés en minutes."
    ),
    "methodology.percentiles": (
        "Le p90 du réseau est mesuré à partir des véhicules suivis en ce moment, "
        "et sur les 14 derniers jours dans la vue de tendance. Les percentiles par "
        "ligne et par arrêt sont calculés chaque jour à partir des observations "
        "et conservés 365 jours."
    ),
    "methodology.retention": (
        "Les données détaillées sont conservées 14 jours; les agrégats quotidiens, "
        "365 jours."
    ),
    "gap.metro_realtime": (
        "La STM ne publie pas de données temps réel pour le métro. Les indicateurs "
        "en direct couvrent le réseau de bus; les interruptions de métro "
        "apparaissent dans les alertes de service."
    ),
    "gap.metro_realtime.short": "Métro : temps réel non disponible",
    "attribution.data_source": (
        "Contient des données de la Société de transport de Montréal, diffusées "
        "sous licence CC BY 4.0."
    ),
    "attribution.disclaimer": (
        "Site indépendant, non affilié à la STM et non approuvé par elle."
    ),
}

_STATIC_LABELS_EN: dict[str, str] = {
    "status.early": "Early",
    "status.on_time": "On time",
    "status.late": "Late",
    "status.severe": "Severe",
    "status.unknown": "Unknown",
    "severity.critical": "Critical",
    "severity.high": "High",
    "severity.watch": "Watch",
    "occupancy.empty": "Empty",
    "occupancy.many_seats": "Many seats available",
    "occupancy.few_seats": "Few seats available",
    "occupancy.standing": "Standing room only",
    "occupancy.full": "Full",
    "methodology.otp_definition": (
        "On time: live, a vehicle counts as on time when its average delay is "
        "from one minute early to under five minutes late; earlier than that is "
        "counted as early, not on time, and five minutes or more late is severe. "
        "In daily history, a tracked passage counts as punctual when no delay was "
        "recorded; route and stop views count severe delays (over 5 minutes)."
    ),
    "methodology.delay_unit": (
        "Delays are measured in seconds against the STM's published GTFS schedule, "
        "then shown in minutes."
    ),
    "methodology.percentiles": (
        "Network p90 is measured from the buses tracked right now, and over the "
        "last 14 days in the trend view. Per-route and per-stop percentiles are "
        "computed daily from observations and kept for 365 days."
    ),
    "methodology.retention": (
        "Detailed data is kept for 14 days; daily aggregates for 365 days."
    ),
    "gap.metro_realtime": (
        "The STM does not publish real-time data for the métro. Live indicators "
        "cover the bus network; métro interruptions appear in service alerts."
    ),
    "gap.metro_realtime.short": "Métro: real-time not available",
    "attribution.data_source": (
        "Contains data from the Société de transport de Montréal, made available "
        "under the CC BY 4.0 licence."
    ),
    "attribution.disclaimer": (
        "Independent site, not affiliated with or endorsed by the STM."
    ),
}

_LABELS_SQL = text(
    """
    SELECT label_key, label_fr, label_en
    FROM gold.report_labels
    ORDER BY sort_order NULLS LAST, label_key
    """
)  # not provider-scoped


def build_labels(conn: Connection, *, lang: str = "fr", generated_utc: str) -> "LabelsFile":
    """Build labels/{lang}.json: static code translations + metric catalog labels.

    Every metric.* key is emitted in BOTH languages (with cross-language / raw-key
    fallback) so fr.json and en.json always carry an identical key set.

    Two UI conventions for the slice-9.1.1t copy (methodology.*, gap.*, attribution.*):
      1. For each gap g in provenance.gaps, the client shows labels['gap.' + g] on the
         affected surface; gap.metro_realtime applies to routes_index entries whose
         type == 1 (métro), with gap.metro_realtime.short as the compact badge.
      2. The attribution surface is labels['attribution.data_source'] +
         labels['attribution.disclaimer']; manifest.attribution is the unlocalized
         machine-level fallback, frozen until the STM licensing determination (T1).
    """
    static = _STATIC_LABELS_FR if lang == "fr" else _STATIC_LABELS_EN
    labels: dict[str, str] = dict(static)

    for r in conn.execute(_LABELS_SQL).mappings():
        key = f"metric.{r['label_key']}"
        primary = r["label_fr"] if lang == "fr" else r["label_en"]
        fallback = r["label_en"] if lang == "fr" else r["label_fr"]
        labels[key] = primary or fallback or r["label_key"]

    return LabelsFile(generated_utc=generated_utc, labels=labels)


# ---------------------------------------------------------------------------
# STATIC indexes
# ---------------------------------------------------------------------------

_ROUTES_INDEX_SQL = text(
    """
    SELECT route_id, route_short_name, route_long_name, route_color, route_type
    FROM gold.dim_route
    WHERE provider_id = :provider_id
    ORDER BY route_sort_order NULLS LAST, route_short_name
    """
)

_STOPS_INDEX_SQL = text(
    f"""
    SELECT s.stop_id, s.stop_code, s.stop_name, s.stop_lat, s.stop_lon
    FROM gold.dim_stop AS s
    WHERE s.provider_id = :provider_id
      AND {_BOARDABLE_STOP.replace("location_type", "s.location_type")}
    ORDER BY s.stop_id
    """
)


def build_routes_index(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> "RoutesIndex":
    """Build static/routes_index.json from gold.dim_route."""
    routes = []
    for r in conn.execute(_ROUTES_INDEX_SQL, {"provider_id": provider_id}).mappings():
        routes.append(
            RouteIndexEntry(
                id=str(r["route_id"]),
                short=str(r["route_short_name"] or r["route_id"]),
                long=r["route_long_name"],
                color=r["route_color"],
                # preserve legitimate GTFS route_type 0 (tram); only NULL -> bus(3)
                type=int(r["route_type"]) if r["route_type"] is not None else 3,
            )
        )
    routes.sort(key=lambda e: _route_sort_key(e.id))
    return RoutesIndex(generated_utc=generated_utc, routes=routes)


# GTFS route_type -> contract mode. A stop served by several modes reports its
# highest-priority one (metro on a metro+bus interchange); NULL/unknown
# route_type folds to bus, mirroring build_routes_index.
_ROUTE_TYPE_TO_MODE = {0: "tram", 1: "metro", 2: "rail", 3: "bus", 4: "ferry"}
_MODE_PRIORITY = {"metro": 0, "tram": 1, "rail": 2, "bus": 3, "ferry": 4}


def _mode_from_route_types(route_types: list[int | None]) -> str | None:
    """Highest-priority transit mode among the GTFS route_types serving a stop.

    Priority metro > tram > rail > bus > ferry. A NULL/unknown route_type folds
    to bus (same convention as build_routes_index). Returns None for empty input.
    """
    best: str | None = None
    for rt in route_types:
        mode = _ROUTE_TYPE_TO_MODE.get(rt, "bus")  # NULL/unknown -> bus
        if best is None or _MODE_PRIORITY[mode] < _MODE_PRIORITY[best]:
            best = mode
    return best


def build_stops_index(
    conn: Connection,
    *,
    provider_id: str = "stm",
    generated_utc: str,
    routes_served_by_stop: dict[str, list[str]] | None = None,
    route_type_by_id: dict[str, int] | None = None,
) -> "StopsIndex":
    """Build static/stops_index.json from gold.dim_stop.

    When *routes_served_by_stop* and *route_type_by_id* are supplied (threaded
    from the same publish pass — see publish._publish_static), each entry also
    carries a short top-5 ``routes`` list plus a derived ``mode`` (the
    highest-priority GTFS mode among ALL routes serving the stop). With neither
    argument the index still builds standalone (mode null, routes []), so old
    callers and tests keep working. No second heavy query: both maps are built
    in memory from build_routes_index + build_all_stops_data, which run anyway.
    """
    routes_by_stop = routes_served_by_stop or {}
    type_by_id = route_type_by_id or {}
    stops = []
    for r in conn.execute(_STOPS_INDEX_SQL, {"provider_id": provider_id}).mappings():
        lat, lon = r["stop_lat"], r["stop_lon"]
        if lat is None or lon is None:
            continue
        sid = str(r["stop_id"])
        full_routes = routes_by_stop.get(sid, [])
        # mode from the FULL served set (metro sorts first so it survives the
        # cap anyway, but deriving from the full set is robust regardless).
        mode = _mode_from_route_types([type_by_id.get(rt) for rt in full_routes]) if full_routes else None
        stops.append(
            StopIndexEntry(
                id=sid,
                code=r["stop_code"],
                name=str(r["stop_name"] or r["stop_id"]),
                lat=_round5(float(lat)),
                lon=_round5(float(lon)),
                mode=mode,
                routes=full_routes[:5],
            )
        )
    return StopsIndex(generated_utc=generated_utc, stops=stops)


# ---------------------------------------------------------------------------
# STATIC route file
# ---------------------------------------------------------------------------

_ROUTE_SHAPES_SQL = text(
    """
    SELECT mrl.shape_id, mrl.geojson, t.direction_id, t.trip_headsign,
           count(*) AS trip_count
    FROM gold.map_route_lines AS mrl
    JOIN silver.trips AS t
        ON  t.provider_id        = mrl.provider_id
        AND t.dataset_version_id = mrl.dataset_version_id
        AND t.shape_id           = mrl.shape_id
        AND t.route_id           = mrl.route_id
    WHERE mrl.provider_id        = :provider_id
      AND mrl.dataset_version_id = :dataset_version_id
      AND mrl.route_id           = :route_id
    GROUP BY mrl.shape_id, mrl.geojson, t.direction_id, t.trip_headsign
    ORDER BY t.direction_id, count(*) DESC, mrl.shape_id
    """
)

_ROUTE_STOPS_SQL = text(
    """
    SELECT DISTINCT ON (st.stop_sequence)
        st.stop_sequence, st.stop_id, ds.stop_name
    FROM silver.trips AS t
    JOIN silver.stop_times AS st
        ON  st.trip_id           = t.trip_id
        AND st.dataset_version_id = t.dataset_version_id
        AND st.provider_id       = t.provider_id
    LEFT JOIN gold.dim_stop AS ds
        ON  ds.stop_id           = st.stop_id
        AND ds.provider_id       = t.provider_id
        AND ds.dataset_version_id = t.dataset_version_id
    WHERE t.provider_id        = :provider_id
      AND t.dataset_version_id = :dataset_version_id
      AND t.route_id           = :route_id
      AND t.shape_id           = :shape_id
    ORDER BY st.stop_sequence
    LIMIT 400
    """
)


def build_route(conn: Connection, *, provider_id: str = "stm", route_id: str, generated_utc: str) -> "RouteFile":
    """Build static/routes/{route_id}.json — branches + shapes + stops + schedule.

    One RouteDirection is emitted per real branch ((direction, headsign) with its
    most-used shape + that shape's full stop list), so multi-branch routes are not
    truncated.  Headways are the median gap between DISTINCT first-stop departures
    of the busiest direction on a representative weekday, per time-of-day shift,
    plus one 'weekend' period.  Times are wall-clock (GTFS >=24:00 normalised).
    """
    from collections import defaultdict

    dv_row = conn.execute(_CURRENT_DATASET_VERSION_SQL, {"provider_id": provider_id}).mappings().fetchone()
    if dv_row is None:
        return RouteFile(generated_utc=generated_utc, id=route_id)
    dv_id = dv_row["dataset_version_id"]
    params = {"provider_id": provider_id, "dataset_version_id": dv_id, "route_id": route_id}

    weekday_services, weekend_services = _representative_services(
        conn, provider_id=provider_id, dataset_version_id=dv_id
    )

    name_row = conn.execute(
        text(
            "SELECT route_long_name FROM gold.dim_route "
            "WHERE provider_id=:provider_id AND route_id=:route_id LIMIT 1"
        ),
        {"provider_id": provider_id, "route_id": route_id},
    ).mappings().fetchone()
    long_name = name_row["route_long_name"] if name_row else None

    # --- branches: one per (direction, headsign), best (most-used) shape ---
    branches: dict[tuple, dict] = {}
    for row in conn.execute(_ROUTE_SHAPES_SQL, params).mappings():
        key = (int(row["direction_id"] or 0), row["trip_headsign"])
        if key not in branches:  # rows ordered direction, count DESC, shape_id
            branches[key] = {"shape_id": row["shape_id"], "geojson": row["geojson"]}

    directions: list[RouteDirection] = []
    for (dir_id, headsign), best in sorted(branches.items(), key=lambda kv: (kv[0][0], str(kv[0][1] or ""))):
        stop_rows = conn.execute(_ROUTE_STOPS_SQL, {**params, "shape_id": best["shape_id"]}).mappings()
        stops = [
            RouteStop(id=str(s["stop_id"]), seq=int(s["stop_sequence"]), name=s["stop_name"])
            for s in stop_rows
        ]
        directions.append(
            RouteDirection(dir=dir_id, headsign=headsign, shape=best["geojson"], stops=stops)
        )

    # --- schedule: distinct first-stop departures by daytype + direction ---
    sched_rows = conn.execute(
        _ROUTE_SCHEDULE_SQL,
        {**params, "weekday_services": weekday_services or [""], "weekend_services": weekend_services or [""]},
    ).mappings()
    wd_by_dir: dict[int, list[str]] = defaultdict(list)
    we_times: list[str] = []
    for r in sched_rows:
        t = str(r["departure_time"])
        if r["is_weekday"]:
            wd_by_dir[int(r["direction_id"] or 0)].append(t)
        else:
            we_times.append(t)

    service_periods: list[ServicePeriod] = []
    if wd_by_dir:
        # busiest direction is representative of the route's frequency
        best_dir = max(wd_by_dir, key=lambda d: len(set(wd_by_dir[d])))
        shift_times: dict[str, list[str]] = defaultdict(list)
        for t in set(wd_by_dir[best_dir]):
            shift_times[_infer_shift((_gtfs_min(t) // 60) % 24)].append(t)
        for shift in _SHIFT_ORDER:
            bucket = shift_times.get(shift)
            if not bucket:
                continue
            mins = [_shift_sort_min(t, shift) for t in bucket]
            service_periods.append(
                ServicePeriod(shift=shift, window=_SHIFT_WINDOWS[shift], headway_min=_median_headway(mins))
            )
    if we_times:
        service_periods.append(
            ServicePeriod(
                shift="weekend",
                window=None,
                headway_min=_median_headway([_gtfs_min(t) % 1440 for t in set(we_times)]),
            )
        )

    # span from the representative weekday (fallback weekend), wall-clock display
    all_wd = sorted({t for ts in wd_by_dir.values() for t in ts}, key=_gtfs_min)
    span = all_wd or sorted(set(we_times), key=_gtfs_min)
    first_dep = _wallclock(span[0]) if span else None
    last_dep = _wallclock(span[-1]) if span else None

    return RouteFile(
        generated_utc=generated_utc,
        id=route_id,
        long=long_name,
        directions=directions,
        service_periods=service_periods,
        first_departure=first_dep,
        last_departure=last_dep,
    )


# ---------------------------------------------------------------------------
# STATIC stop files (batch — one pass for all stops)
# ---------------------------------------------------------------------------

_ALL_STOPS_SQL = text(
    f"""
    SELECT stop_id, stop_code, stop_name, stop_lat, stop_lon, wheelchair_boarding
    FROM gold.dim_stop
    WHERE provider_id = :provider_id
      AND {_BOARDABLE_STOP}
    ORDER BY stop_id
    """
)

# Distinct departures per (stop, route, headsign) for the representative WEEKDAY
# service only, so each stop shows one coherent day's schedule (not the union of
# all 144 calendars).  DISTINCT collapses simultaneous branch departures.
_ALL_STOP_SCHEDULES_SQL = text(
    """
    SELECT DISTINCT st.stop_id, t.route_id, t.trip_headsign, st.departure_time
    FROM silver.stop_times AS st
    JOIN silver.trips AS t
        ON  t.trip_id            = st.trip_id
        AND t.dataset_version_id = st.dataset_version_id
        AND t.provider_id        = st.provider_id
    WHERE st.provider_id        = :provider_id
      AND st.dataset_version_id = :dataset_version_id
      AND st.departure_time IS NOT NULL
      AND t.service_id = ANY(:weekday_services)
    ORDER BY st.stop_id, t.route_id, st.departure_time
    """
)


def build_all_stops_data(conn: Connection, *, provider_id: str = "stm", generated_utc: str) -> "dict[str, StopFile]":
    """Build all StopFile objects in a single two-query pass (representative weekday).

    Returns stop_id -> StopFile. The schedule is a representative all-day sample
    of the busiest weekday's service; weekend-only stops have an empty schedule.
    """
    import logging
    from collections import defaultdict

    logger = logging.getLogger(__name__)
    params_base = {"provider_id": provider_id}

    dv_row = conn.execute(_CURRENT_DATASET_VERSION_SQL, params_base).mappings().fetchone()
    if dv_row is None:
        return {}
    dv_id = dv_row["dataset_version_id"]
    weekday_services, _weekend = _representative_services(
        conn, provider_id=provider_id, dataset_version_id=dv_id
    )

    stops: dict[str, StopFile] = {}
    for r in conn.execute(_ALL_STOPS_SQL, params_base).mappings():
        sid = str(r["stop_id"])
        lat, lon = r["stop_lat"], r["stop_lon"]
        if lat is None or lon is None:
            continue
        raw = r["wheelchair_boarding"]
        # GTFS: 1=accessible, 2=not accessible, 0/NULL=unknown. The contract field
        # is a bare bool with no 'unknown'; STM only emits 1/2 today.
        if raw not in (1, 2):
            logger.warning(
                "stop %s wheelchair_boarding=%r not in (1,2); publishing wheelchair=False", sid, raw
            )
        stops[sid] = StopFile(
            generated_utc=generated_utc,
            id=sid,
            code=r["stop_code"],
            name=str(r["stop_name"] or sid),
            lat=_round5(float(lat)),
            lon=_round5(float(lon)),
            wheelchair=(raw == 1),
            routes_served=[],
            scheduled=[],
        )

    schedule: dict[str, dict[tuple, list[str]]] = defaultdict(lambda: defaultdict(list))
    for r in conn.execute(
        _ALL_STOP_SCHEDULES_SQL, {**params_base, "dataset_version_id": dv_id, "weekday_services": weekday_services or [""]}
    ).mappings():
        sid = str(r["stop_id"])
        key = (str(r["route_id"]), r["trip_headsign"] or "")
        schedule[sid][key].append(str(r["departure_time"]))  # raw, already chronological

    for sid, route_map in schedule.items():
        stop = stops.get(sid)
        if stop is None:
            continue
        routes_seen: set[str] = set()
        scheduled: list[ScheduledRoute] = []
        for (route_id, headsign), raw_times in route_map.items():
            routes_seen.add(route_id)
            scheduled.append(
                ScheduledRoute(route=route_id, headsign=headsign or None, times=_sample_times(raw_times))
            )
        scheduled.sort(key=lambda s: (_route_sort_key(s.route), s.headsign or ""))
        stops[sid] = StopFile(
            generated_utc=generated_utc,
            id=stop.id,
            code=stop.code,
            name=stop.name,
            lat=stop.lat,
            lon=stop.lon,
            wheelchair=stop.wheelchair,
            routes_served=sorted(routes_seen, key=_route_sort_key),
            scheduled=scheduled,
        )

    return stops


# --------------------------------------------------------------------------
# build_basemap (settings-driven PMTiles pointer)
# --------------------------------------------------------------------------


def build_basemap(settings: object, *, generated_utc: str) -> "BasemapFile | None":
    """Build static/basemap.json — a pointer to the hosted PMTiles archive.

    Pure function (no DB): returns ``None`` when SNAPSHOT_BASEMAP_PMTILES_URL is
    unset/falsy, so the basemap artifact ships only once a real archive exists.
    """
    url = getattr(settings, "SNAPSHOT_BASEMAP_PMTILES_URL", None)
    if not url:
        return None
    return BasemapFile(
        url=str(url),
        style_url=(getattr(settings, "SNAPSHOT_BASEMAP_STYLE_URL", None) or None),
        attribution=str(
            getattr(settings, "SNAPSHOT_BASEMAP_ATTRIBUTION", None)
            or "© OpenStreetMap contributors, © Protomaps"
        ),
        generated_utc=generated_utc,
    )
