"""Two seeded providers shaped like the public ones, published by the revision 2 guards.

History sits on fixed 2025 service dates, more than a year before any run of these
tests, so windows counted back from the database's own date never reach it. Live
captures and the trips they follow are placed relative to the database's now().
"""

from __future__ import annotations

import hashlib
import json
from datetime import UTC, date, datetime, time, timedelta
from pathlib import Path
from types import SimpleNamespace
from zoneinfo import ZoneInfo

import real_db_seed as db_seed
from google.transit import gtfs_realtime_pb2 as rt
from sqlalchemy import Engine, text
from sqlalchemy.exc import IntegrityError

from transit_ops.gold import delay_days, rollups
from transit_ops.gold.alert_archive import sync_alert_archive
from transit_ops.gold.marts import build_gold_marts
from transit_ops.gold.realtime import (
    initialize_realtime_serving,
    refresh_gold_realtime,
    refresh_gold_snapshots,
)
from transit_ops.settings import Settings
from transit_ops.silver.i3 import RawI3AlertSnapshot, load_i3_snapshot_to_silver
from transit_ops.silver.realtime_gtfs import load_realtime_to_silver

# Label -> provider id. Only the alert feed differs, declared by its endpoint.
PROVIDERS = {"agency_alerts": "r2guard_alerts", "no_alert_feed": "r2guard_plain"}
TZ = ZoneInfo("America/Toronto")
DAYS = tuple(date(2025, month, day) for month in (6, 7, 8) for day in (3, 19))
SEASON = (date(2025, 6, 1), date(2025, 8, 31))
BUILD_CLOCK = datetime(2025, 9, 1, 6, tzinfo=UTC)
HISTORY_CLOCK = datetime(2025, 9, 2, 7, tzinfo=UTC)
RETENTION_DAYS = 36500
GAP = 1800  # seconds between a trip's stops
STOPS = {"S1": (45.501, -73.601, 1), "S2": (45.512, -73.592, 2), "S3": (45.523, -73.583, None)}
STOPS |= {"S4": (45.534, -73.574, None)}
ROUTES = (("M1", 1, "1"), ("B10", 3, "10"), ("B20", 3, "20"))
# trip, route, direction, first stop sequence, stops, delay (None unknown, "x" cancelled)
TRIPS = (
    ("1", "M1", 0, 1, ("S1", "S2", "S3"), 30),
    ("2", "M1", 1, 1, ("S3", "S2", "S1"), -120),
    ("3", "B10", 0, 2, ("S2", "S3", "S4"), 180),
    ("4", "B10", 1, 1, ("S4", "S3", "S2"), 600),
    ("5", "B20", 0, 1, ("S1", "S3", "S4"), None),
    ("6", "B20", 1, 1, ("S4", "S2", "S1"), "x"),
)


def settings_for(root: Path) -> Settings:
    return Settings(
        _env_file=None,
        BRONZE_STORAGE_BACKEND="local",
        BRONZE_LOCAL_ROOT=str(root),
        SNAPSHOT_PUBLISH_CONCURRENCY=1,
        SNAPSHOT_PUBLIC_BASE_URL="https://data.example.test",
        GOLD_FACT_RETENTION_DAYS=RETENTION_DAYS,
        GOLD_WARM_ROLLUP_RETENTION_DAYS=RETENTION_DAYS,
        SILVER_I3_CLOSED_RETENTION_DAYS=RETENTION_DAYS,
    )


def _registry(provider_id: str) -> SimpleNamespace:
    provider = SimpleNamespace(
        provider_id=provider_id, timezone=str(TZ), bounds=None, max_vehicle_speed_kmh=100
    )
    manifest = SimpleNamespace(
        provider=provider, realtime_feed=lambda key: SimpleNamespace(endpoint_key=key)
    )
    return SimpleNamespace(get_provider=lambda _id: manifest)


def _base(provider_id: str) -> int:
    return 8_610_000 + 10_000 * list(PROVIDERS.values()).index(provider_id)


def _anchor(service_date: date) -> datetime:
    """GTFS times count from local noon minus twelve elapsed hours, in UTC.

    Aware datetimes sharing one tzinfo add and subtract by wall clock, so convert first.
    """
    return datetime.combine(service_date, time(12), TZ).astimezone(UTC) - timedelta(hours=12)


def _gtfs(seconds: int) -> str:
    return f"{seconds // 3600:02d}:{seconds // 60 % 60:02d}:{seconds % 60:02d}"


def _seed_static(conn, provider_id: str, service: str, prefix: str, days, first: int) -> None:
    params = {"p": provider_id, "v": _base(provider_id) + 20, "s": service}
    conn.execute(
        text(
            "INSERT INTO silver.calendar VALUES (:v,:p,:s,true,true,true,true,true,true,true,:a,:b)"
        ),
        params | {"a": days[0], "b": days[-1]},
    )
    for trip, route, direction, sequence, stops, _delay in TRIPS:
        conn.execute(
            text(
                "INSERT INTO silver.trips (dataset_version_id, provider_id, trip_id, route_id,"
                " service_id, trip_headsign, direction_id, shape_id)"
                " VALUES (:v,:p,:t,:r,:s,:h,:d,:t)"
            ),
            params | {"t": prefix + trip, "r": route, "h": f"Vers {stops[-1]}", "d": direction},
        )
        for offset, stop in enumerate(stops):  # Each trip's shape runs through its stops.
            conn.execute(
                text(
                    "INSERT INTO silver.shapes (dataset_version_id, provider_id, shape_id,"
                    " shape_pt_sequence, shape_pt_lat, shape_pt_lon) VALUES (:v,:p,:t,:q,:a,:o)"
                ),
                params
                | {"t": prefix + trip, "q": offset, "a": STOPS[stop][0], "o": STOPS[stop][1]},
            )
            clock = _gtfs(first + GAP * offset)
            conn.execute(
                text(
                    "INSERT INTO silver.stop_times (dataset_version_id, provider_id, trip_id,"
                    " stop_sequence, stop_id, arrival_time, departure_time)"
                    " VALUES (:v,:p,:t,:q,:stop,:c,:c)"
                ),
                params | {"t": prefix + trip, "q": sequence + offset, "stop": stop, "c": clock},
            )


def _seed_provider(conn, provider_id: str, alerts: bool) -> None:
    base = _base(provider_id)
    conn.execute(
        text(
            "INSERT INTO core.providers (provider_id, display_name, timezone, provider_key,"
            " short_name, city, default_language, min_latitude, max_latitude, min_longitude,"
            " max_longitude) VALUES (:p, :p, :tz, :p, 'R2', 'Ville', 'fr', 45.4, 45.7, -73.9,"
            " -73.4)"
        ),
        {"p": provider_id, "tz": str(TZ)},
    )
    endpoints = [("static_schedule", "gtfs_schedule_zip"), ("trip_updates", "gtfs_rt_trip_updates")]
    endpoints += [("vehicle_positions", "gtfs_rt_vehicle_positions")]
    endpoints += [("i3_alerts", "api_i3_json")] if alerts else []
    for index, (key, source) in enumerate(endpoints):
        db_seed.feed_endpoints(
            conn,
            {"e": base + index, "p": provider_id, "k": key, "f": source},
            endpoint_key=":k",
            feed_kind=":k",
            source_format=":f",
        )
    run = {"r": base + 10, "p": provider_id, "e": base, "d": base + 20}
    db_seed.ingestion_runs(conn, run, run_kind="'static_schedule'")
    db_seed.dataset_versions(
        conn,
        run | {"h": "r2" * 32},
        dataset_version_id=":d",
        source_ingestion_run_id=":r",
        loaded_at_utc="'2025-05-30T12:00:00Z'",
    )
    conn.execute(
        text("UPDATE core.dataset_versions SET source_version='r2-2025' WHERE provider_id=:p"),
        {"p": provider_id},
    )
    for route, kind, short in ROUTES:
        conn.execute(
            text(
                "INSERT INTO silver.routes (dataset_version_id, provider_id, route_id,"
                " route_type, route_short_name, route_long_name) VALUES (:d,:p,:r,:k,:s,:n)"
            ),
            run | {"r": route, "k": kind, "s": short, "n": f"Ligne {short}"},
        )
    for stop, (lat, lon, wheelchair) in STOPS.items():
        conn.execute(
            text(
                "INSERT INTO silver.stops (dataset_version_id, provider_id, stop_id, stop_name,"
                " stop_lat, stop_lon, wheelchair_boarding) VALUES (:d,:p,:s,:n,:a,:o,:w)"
            ),
            run | {"s": stop, "n": f"Arret {stop}", "a": lat, "o": lon, "w": wheelchair},
        )
    _seed_static(conn, provider_id, "ETE", "T", SEASON, 12 * 3600)


def _feed(kind: str, captured: datetime, service_date: date, prefix: str, first: int) -> bytes:
    """One capture of every trip, taken between its first and second stop."""
    message = rt.FeedMessage()
    message.header.gtfs_realtime_version = "2.0"
    message.header.timestamp = int(captured.timestamp())
    for index, (trip, route, direction, sequence, stops, delay) in enumerate(TRIPS):
        entity = message.entity.add(id=f"{kind}-{trip}")
        body = entity.trip_update if kind == "tu" else entity.vehicle
        body.trip.trip_id, body.trip.route_id = prefix + trip, route
        body.trip.direction_id = direction
        body.trip.start_date = service_date.strftime("%Y%m%d")
        if kind == "vp":
            body.vehicle.id = f"V{trip}"
            body.position.latitude, body.position.longitude = STOPS[stops[1]][:2]
            body.position.bearing, body.position.speed = 90.0, 8.5
            body.timestamp, body.occupancy_status = message.header.timestamp, index % 5
            continue
        if delay == "x":
            body.trip.schedule_relationship = rt.TripDescriptor.CANCELED
            continue
        body.vehicle.id = f"V{trip}"
        for offset, stop in enumerate(stops):
            update = body.stop_time_update.add(stop_sequence=sequence + offset, stop_id=stop)
            if delay is not None:
                planned = _anchor(service_date) + timedelta(seconds=first + GAP * offset)
                update.arrival.time = int(planned.timestamp()) + delay
                update.arrival.delay = delay
    return message.SerializeToString()


def _capture(conn, root: Path, provider_id: str, number: int, endpoint: int, body: bytes, at):
    base = _base(provider_id)
    ids = {"s": base + 100 + number, "r": base + 300 + number, "o": base + 500 + number}
    path = f"{provider_id}/rt/{ids['s']}.pb"
    (root / path).parent.mkdir(parents=True, exist_ok=True)
    (root / path).write_bytes(body)
    key = ("trip_updates", "vehicle_positions")[endpoint - 1]
    params = ids | {"p": provider_id, "e": base + endpoint, "k": key, "path": path, "ts": at}
    params |= {"h": hashlib.sha256(body).hexdigest(), "b": len(body), "n": len(TRIPS)}
    db_seed.ingestion_runs(
        conn, params, run_kind=":k", started_at_utc=":ts", completed_at_utc=":ts"
    )
    db_seed.ingestion_objects(
        conn,
        params,
        object_kind="'realtime_feed'",
        storage_backend="'local'",
        checksum_sha256=":h",
        byte_size=":b",
    )
    db_seed.realtime_snapshot_index(conn, params, ingestion_object_id=":o")
    return ids["s"], key


def _load(engine: Engine, settings: Settings, provider_id: str, captures) -> dict:
    return {
        snapshot: load_realtime_to_silver(
            provider_id,
            key,
            snapshot_id=snapshot,
            settings=settings,
            registry=_registry(provider_id),
            engine=engine,
        )
        for snapshot, key in captures
    }


def _alerts(engine: Engine, provider_id: str, number: int, at: datetime, open_end: bool) -> None:
    """Two alerts, one with a severity; open_end leaves the second without an end."""
    base = _base(provider_id)
    start, end = (
        int((at - timedelta(hours=1)).timestamp()),
        int((at + timedelta(hours=2)).timestamp()),
    )
    payload = [
        {"id": f"A{number}", "header": "Travaux", "description": "Detour", "severity": "warning",
         "cause": "CONSTRUCTION", "effect": "DETOUR", "routes": ["B10"],
         "activePeriods": [{"start": start, "end": end}]},
        {"id": f"B{number}", "header": "Avis", "routes": ["M1"], "stops": ["S2"],
         "activePeriods": [{"start": start} if open_end else {"start": start, "end": end}]},
    ]  # fmt: skip
    params = {"r": base + 800 + number, "p": provider_id, "e": base + 3, "s": base + 700 + number}
    with engine.begin() as conn:
        db_seed.ingestion_runs(conn, params, run_kind="'i3_alerts'")
        conn.execute(
            text(
                "INSERT INTO raw.i3_alert_snapshots (i3_alert_snapshot_id, provider_id,"
                " feed_endpoint_id, ingestion_run_id, captured_at_utc, raw_payload_json)"
                " VALUES (:s, :p, :e, :r, :at, CAST(:j AS jsonb))"
            ),
            params | {"at": at, "j": json.dumps(payload)},
        )
        snapshot = RawI3AlertSnapshot(params["s"], provider_id, str(TZ), at, payload)
        load_i3_snapshot_to_silver(conn, snapshot=snapshot, loaded_at_utc=at)


def seed_history(engine: Engine, settings: Settings, root: Path) -> None:
    with engine.connect() as conn:
        build_start = conn.execute(text("SELECT clock_timestamp()")).scalar_one()
    for provider_id in PROVIDERS.values():
        alerts = provider_id == PROVIDERS["agency_alerts"]
        with engine.begin() as conn:
            _seed_provider(conn, provider_id, alerts)
            captures = []
            for number, day in enumerate(DAYS):
                at = datetime.combine(day, time(12, 12), TZ).astimezone(UTC)
                for endpoint, kind in ((1, "tu"), (2, "vp")):
                    body = _feed(kind, at, day, "T", 12 * 3600)
                    captures.append(
                        _capture(conn, root, provider_id, 2 * number + endpoint, endpoint, body, at)
                    )
        registry = _registry(provider_id)
        build_gold_marts(provider_id, engine=engine, settings=settings, registry=registry)
        receipts = _load(engine, settings, provider_id, captures)
        refresh_gold_snapshots(
            provider_id,
            expected_rows={key: receipt.row_counts for key, receipt in receipts.items()},
            settings=settings,
            registry=registry,
            engine=engine,
        )
        if alerts:
            for number, day in enumerate(DAYS):
                at = datetime.combine(day, time(10), TZ).astimezone(UTC)
                _alerts(engine, provider_id, number, at, open_end=False)
            sync_alert_archive(
                provider_id, from_date=DAYS[0], to_date=DAYS[-1], settings=settings, engine=engine
            )
        for day in DAYS:  # Only captured days hold a complete trip-update cohort.
            rollups.rebuild_warm_rollups(
                provider_id,
                engine=engine,
                settings=settings,
                from_date=day,
                to_date=day,
                kinds=list(delay_days.DAILY_DELAY_TABLES),
            )
        rollups.build_warm_rollups(provider_id, engine=engine, settings=settings)
    _freeze_build_stamps(engine, build_start)


_HISTORY_LEAF = "MAX(built_at_utc) is generated_utc of"
# Build stamps that reach a published file, written from the build's clock: column, reason.
FROZEN_STAMPS = {
    "gold.route_delay_spine": ("built_at_utc", f"{_HISTORY_LEAF} line/network history, hotspots"),
    "gold.stop_delay_spine": ("built_at_utc", f"{_HISTORY_LEAF} stop history, hotspots"),
    "gold.stop_delay_shift_daily": ("built_at_utc", f"{_HISTORY_LEAF} hotspots days"),
    "gold.repeat_offender_daily_spine": ("built_at_utc", f"{_HISTORY_LEAF} repeat offenders"),
    "gold.route_cancellation_daily": ("built_at_utc", f"{_HISTORY_LEAF} line/network history"),
    "gold.route_delay_percentile_daily": ("built_at_utc", f"{_HISTORY_LEAF} line history"),
    "gold.stop_delay_percentile_daily": ("built_at_utc", f"{_HISTORY_LEAF} stop history"),
    "gold.route_occupancy_band_daily": ("built_at_utc", f"{_HISTORY_LEAF} line/network history"),
    "gold.stop_occupancy_band_daily": ("built_at_utc", f"{_HISTORY_LEAF} stop history"),
    "gold.route_service_span_daily": ("built_at_utc", f"{_HISTORY_LEAF} line history"),
    "gold.route_skipped_stop_daily": ("built_at_utc", f"{_HISTORY_LEAF} line history"),
    "gold.alert_archive_entry": ("updated_at_utc", "MAX is generated_utc of alert archive pages"),
}


def _freeze_build_stamps(engine: Engine, build_start: datetime) -> None:
    """Published history carries the time its source rows were built; fix that time."""
    ids = list(PROVIDERS.values())
    with engine.begin() as conn:
        for table, (column, _reason) in FROZEN_STAMPS.items():
            outside = conn.execute(
                text(
                    f"SELECT count(*) FROM {table} WHERE provider_id = ANY(:ids)"
                    f" AND NOT {column} BETWEEN :start AND clock_timestamp()"
                ),
                {"ids": ids, "start": build_start},
            ).scalar_one()
            assert outside == 0, f"{table}.{column}: {outside} values not from the build's clock"
            conn.execute(
                text(f"UPDATE {table} SET {column} = :built WHERE provider_id = ANY(:ids)"),
                {"built": BUILD_CLOCK, "ids": ids},
            )


def live_schedule(t0: datetime) -> tuple[date, int]:
    """A service date whose GTFS clock puts T0 at least two hours in; first stops T0-20min."""
    service_date = (t0 - timedelta(hours=2)).astimezone(TZ).date()
    return service_date, int((t0 - _anchor(service_date)).total_seconds()) - 1200


def seed_live(engine: Engine, settings: Settings, root: Path, t0: datetime) -> None:
    service_date, first = live_schedule(t0)
    for provider_id in PROVIDERS.values():
        with engine.begin() as conn:
            _seed_static(conn, provider_id, "VIVANT", "L", (service_date,), first)
            captures = [
                _capture(conn, root, provider_id, 90 + endpoint, endpoint, body, at)
                for endpoint, kind, at in ((1, "tu", t0 - timedelta(seconds=30)),
                                           (2, "vp", t0 - timedelta(seconds=20)))
                for body in [_feed(kind, at, service_date, "L", first)]
            ]  # fmt: skip
        receipts = _load(engine, settings, provider_id, captures)
        keys = ("trip_updates", "vehicle_positions")
        initialize_realtime_serving(provider_id, keys, engine=engine)
        refresh_gold_realtime(
            provider_id,
            snapshots=list(receipts.values()),
            settings=settings,
            registry=_registry(provider_id),
            engine=engine,
            bootstrap_from_archive=True,
        )
        if provider_id == PROVIDERS["agency_alerts"]:
            _alerts(engine, provider_id, 90, t0 - timedelta(seconds=10), open_end=True)


def delete_rows(engine: Engine) -> None:
    """Delete every row of the seeded providers, retrying tables a foreign key still holds."""
    with engine.connect() as conn:
        pending = set(conn.execute(text(_TABLES_SQL)).scalars())
    while pending:
        progress = False
        for table in sorted(pending):
            try:
                with engine.begin() as conn:
                    conn.execute(
                        text(f"DELETE FROM {table} WHERE provider_id = ANY(:ids)"),
                        {"ids": list(PROVIDERS.values())},
                    )
                pending.discard(table)
                progress = True
            except IntegrityError:
                continue
        assert progress, f"rows still referenced in {sorted(pending)}"


def remaining_rows(engine: Engine) -> dict[str, int]:
    with engine.connect() as conn:
        counts = {
            table: conn.execute(
                text(f"SELECT count(*) FROM {table} WHERE provider_id = ANY(:ids)"),
                {"ids": list(PROVIDERS.values())},
            ).scalar_one()
            for table in conn.execute(text(_TABLES_SQL)).scalars()
        }
    return {table: count for table, count in counts.items() if count}


_TABLES_SQL = """
SELECT format('%I.%I', c.table_schema, c.table_name)
FROM information_schema.columns c
JOIN information_schema.tables t USING (table_schema, table_name)
WHERE c.column_name = 'provider_id' AND t.table_type = 'BASE TABLE'
"""
