# 05 — Business Logic & KPI Semantics

Every non-trivial business rule, fallback chain, and KPI computation in the
pipeline. Line references point to the actual source. Nothing here is generic.

---

## 1. delay_seconds fallback chain

**File:** `src/transit_ops/gold/marts.py`, function `_trip_delay_snapshot_statement()` (lines 331-513)

The `delay_seconds` column in `gold.fact_trip_delay_snapshot` is the most
important number in the entire pipeline. It can come from two sources, tried
in order:

### Primary: `tu.delay_seconds` (GTFS-RT TripUpdate top-level delay)

```sql
-- Final SELECT, line 481:
COALESCE(tu.delay_seconds, tdf.derived_delay_seconds)
```

If `silver.trip_updates.delay_seconds` is not NULL, it is used directly. This
is the best signal — it comes straight from the STM feed's TripUpdate message.

### Fallback: derived delay from stop_time_updates vs static stop_times

When `tu.delay_seconds` IS NULL, the pipeline computes a derived delay by
comparing realtime stop-level predictions against the static schedule:

**Step 1 — `stop_time_candidates` CTE (lines 373-438)**

Joins:
- `silver.trip_updates` (the trip)
- `silver.trip_update_stop_time_updates` (the trip's stop-level predictions)
- `silver.stop_times` (the static scheduled arrival/departure times)

Join condition: match on `trip_id` + `stop_sequence` within the current
`dataset_version_id`.

**Step 2 — compute `derived_delay_seconds`**

```sql
EXTRACT(EPOCH FROM (
    COALESCE(stu.arrival_time_utc, stu.departure_time_utc)   -- realtime predicted time
    - (
        tu.start_date::timestamp
        + make_interval(
            hours => split_part(COALESCE(st.arrival_time, st.departure_time), ':', 1)::integer,
            mins  => split_part(COALESCE(st.arrival_time, st.departure_time), ':', 2)::integer,
            secs  => split_part(COALESCE(st.arrival_time, st.departure_time), ':', 3)::integer
        )
    ) AT TIME ZONE :provider_timezone
))::integer
```

This subtracts the scheduled arrival (reconstructed from `start_date` + the
`HH:MM:SS` arrival_time text, converted to the provider timezone) from the
realtime predicted arrival. Result is in seconds: positive = late, negative = early.

**Step 3 — rank candidates and pick the best one**

```sql
row_number() OVER (
    PARTITION BY tu.realtime_snapshot_id, tu.entity_index
    ORDER BY
        CASE
            WHEN COALESCE(stu.arrival_time_utc, stu.departure_time_utc)
                >= tu.feed_timestamp_utc
            THEN 0 ELSE 1
        END,                                           -- prefer future stops
        abs(EXTRACT(EPOCH FROM (... - tu.feed_timestamp_utc))),  -- closest to now
        stu.stop_sequence NULLS LAST,                 -- tiebreak by sequence
        stu.stop_time_update_index                    -- final tiebreak
) AS delay_rank
```

Ranking priority:
1. Future stops (arrival >= feed_timestamp) preferred over past stops
2. Among future stops, closest to feed_timestamp wins
3. Ties broken by stop_sequence, then stop_time_update_index

**Step 4 — `trip_delay_fallback` CTE (lines 440-447)**

Filters to `delay_rank = 1` to get the single best derived delay per trip.

**Step 5 — COALESCE in the final INSERT**

```sql
COALESCE(tu.delay_seconds, tdf.derived_delay_seconds)
```

Primary wins if present; fallback used only when primary is NULL.

### When both are NULL

If a trip has no top-level `delay_seconds` AND has no usable stop_time_updates
(e.g., no `arrival_time_utc`, no matching `stop_sequence` in static schedule,
or no `start_date`), then `delay_seconds` in the Gold fact is NULL.

**Production reality:** ~87.6% of Gold fact rows have non-null `delay_seconds`.
The remaining ~12.4% are trips where neither source provided delay information.

---

## 2. vehicle_id LATERAL JOIN fallback

**File:** `src/transit_ops/gold/marts.py`, lines 490-507

STM's TripUpdate messages sometimes lack a `vehicle_id`. The pipeline tries to
recover it from `silver.vehicle_positions` by matching on `trip_id`:

```sql
LEFT JOIN LATERAL (
    SELECT vp.vehicle_id
    FROM silver.vehicle_positions AS vp
    WHERE vp.provider_id = tu.provider_id
      AND vp.trip_id = tu.trip_id
      AND vp.vehicle_id IS NOT NULL
      AND (tu.route_id IS NULL OR vp.route_id = tu.route_id)
      AND vp.feed_timestamp_utc BETWEEN
            tu.feed_timestamp_utc - interval '10 minutes'
        AND tu.feed_timestamp_utc + interval '10 minutes'
    ORDER BY
        abs(EXTRACT(EPOCH FROM (vp.feed_timestamp_utc - tu.feed_timestamp_utc))),
        vp.realtime_snapshot_id DESC,
        vp.entity_index
    LIMIT 1
) AS vpm
  ON tu.vehicle_id IS NULL
 AND tu.trip_id IS NOT NULL
```

**How it works:**
1. Only activates when `tu.vehicle_id IS NULL` and `tu.trip_id IS NOT NULL`
2. Searches `silver.vehicle_positions` for a matching `trip_id` within ±10 minutes of `feed_timestamp_utc`
3. Optionally constrains by `route_id` if known
4. Picks the closest-in-time vehicle position
5. The recovered `vehicle_id` is applied via `COALESCE(tu.vehicle_id, vpm.vehicle_id)` (line 479)

**Performance note:** This is a LATERAL JOIN (correlated subquery per row).
It is expensive but bounded by the ±10-minute window and the LIMIT 1.

---

## 3. Timezone handling

**File:** `src/transit_ops/gold/marts.py`, lines 470-471

All Gold fact tables store both UTC timestamps and local-timezone-derived fields:

```sql
to_char(timezone(:provider_timezone, tu.feed_timestamp_utc), 'YYYYMMDD')::integer  AS snapshot_date_key,
timezone(:provider_timezone, tu.feed_timestamp_utc)::date                          AS snapshot_local_date,
```

- `:provider_timezone` comes from `Settings.PROVIDER_TIMEZONE` (default `'America/Toronto'`)
- `snapshot_date_key` is YYYYMMDD integer (e.g., `20260327`) — used as the FK join key to `gold.dim_date`
- `snapshot_local_date` is the date portion in the provider's timezone
- `feed_timestamp_utc` is preserved as-is for precise UTC ordering

**Why this matters:** A snapshot captured at `2026-03-27 03:30:00 UTC` is
`2026-03-26 23:30:00 ET` — a different calendar day. The date dimension must
match what a local operator would call "today."

---

## 4. dim_date generation

**File:** `src/transit_ops/gold/marts.py`, `build_gold_marts()` and `refresh_gold_static()`

The date dimension is generated from Silver calendar data, not hardcoded:

```sql
generate_series(
    LEAST(MIN(c.start_date), MIN(cd.service_date)),
    GREATEST(MAX(c.end_date), MAX(cd.service_date)),
    interval '1 day'
)
```

This creates one row per day across the full range of:
- `silver.calendar.start_date` to `silver.calendar.end_date`
- Any additional dates in `silver.calendar_dates`

Each date gets enriched with:
- `date_key` (YYYYMMDD integer)
- `day_of_week_iso` (1=Monday, 7=Sunday)
- `day_name` (text, e.g. 'Monday')
- `is_weekend`
- `has_calendar_exception` — true if any `calendar_dates` row exists for this date
- `is_service_added` — true if `exception_type = 1` for this date
- `is_service_removed` — true if `exception_type = 2` for this date

---

## 5. Warm rollup aggregation semantics

**File:** `src/transit_ops/gold/rollups.py`

### Period bucketing

```sql
DATE_BIN('5 minutes', captured_at_utc, TIMESTAMPTZ '2000-01-01') AS period_start_utc
```

All rollups use Postgres `DATE_BIN()` with a 5-minute bucket anchored at
`2000-01-01 00:00:00 UTC`. This produces deterministic, aligned period
boundaries (e.g., `:00`, `:05`, `:10`, ..., `:55`).

### Vehicle summary (`gold.vehicle_summary_5m`)

| Column | Aggregation |
|--------|------------|
| `vehicle_count` | `COUNT(DISTINCT vehicle_id)` — unique vehicles seen in the 5-min window |
| `observation_count` | `COUNT(*)` — total vehicle position rows |
| `snapshot_count` | `COUNT(DISTINCT realtime_snapshot_id)` — how many 30s snapshots fell in this period |

At 30s cadence, a 5-minute window should contain ~10 snapshots.

### Trip delay summary (`gold.trip_delay_summary_5m`)

| Column | Aggregation |
|--------|------------|
| `trip_count` | `COUNT(DISTINCT trip_id)` — unique trips in the period |
| `observation_count` | `COUNT(*)` — total trip delay rows |
| `delay_observation_count` | `COUNT(delay_seconds)` — rows where delay is NOT NULL |
| `avg_delay_seconds` | `AVG(delay_seconds::numeric)` — raw average including outliers |
| `avg_delay_seconds_capped` | `AVG(delay_seconds::numeric) FILTER (WHERE ABS(delay_seconds) <= 3600)` — capped at ±1 hour |
| `max_delay_seconds` | `MAX(delay_seconds)` |
| `min_delay_seconds` | `MIN(delay_seconds)` |
| `delayed_trip_count` | `COUNT(DISTINCT trip_id) FILTER (WHERE delay_seconds > 0)` — trips running late |
| `outlier_count` | `COUNT(*) FILTER (WHERE ABS(delay_seconds) > 3600)` — extreme values excluded from capped avg |

### Why two averages?

- `avg_delay_seconds` is the raw, unfiltered average — includes all non-null delays
- `avg_delay_seconds_capped` filters out observations where |delay| > 3600 seconds (1 hour)
- Extreme outliers are typically stale GTFS-RT feed artifacts (route 777, phantom trips)
- `outlier_count` reports how many observations were excluded so dashboards can show "X outliers excluded"
- **Power BI should use `avg_delay_seconds_capped`** for trend charts; `avg_delay_seconds` is available for validation

### Route handling

```sql
COALESCE(route_id, '__unrouted__')
```

Both rollup tables substitute NULL `route_id` with `'__unrouted__'` to ensure
every observation is represented in the rollup. The PK includes `route_id`,
so NULLs would violate uniqueness.

---

## 6. Null semantics catalog

Every nullable column that matters, what NULL means, and how downstream
consumers should handle it.

### Silver layer

| Table.Column | NULL means |
|-------------|-----------|
| `trip_updates.delay_seconds` | Feed did not provide a top-level delay — triggers fallback chain |
| `trip_updates.vehicle_id` | TripUpdate lacked a vehicle reference — triggers LATERAL JOIN fallback |
| `trip_updates.route_id` | Rare but possible; trip-to-route mapping missing in feed |
| `trip_update_stop_time_updates.arrival_time_utc` | Only departure predicted, not arrival |
| `trip_update_stop_time_updates.departure_time_utc` | Only arrival predicted, not departure |
| `trip_update_stop_time_updates.arrival_delay_seconds` | No arrival delay reported for this stop |
| `vehicle_positions.vehicle_id` | Feed entity lacked vehicle descriptor (uncommon) |
| `vehicle_positions.trip_id` | Vehicle not assigned to a trip (deadheading, garage, etc.) |
| `vehicle_positions.route_id` | Vehicle not on a route |
| `vehicle_positions.position_timestamp_utc` | Feed used header timestamp only, no per-entity timestamp |
| `stop_times.arrival_time` | Stop is departure-only in schedule (first stop of trip) |
| `stop_times.departure_time` | Stop is arrival-only in schedule (last stop of trip) |

### Gold layer

| Table.Column | NULL means |
|-------------|-----------|
| `fact_trip_delay_snapshot.delay_seconds` | **Neither primary nor fallback produced a delay** — ~12.4% of rows |
| `fact_trip_delay_snapshot.vehicle_id` | Both TripUpdate `vehicle_id` AND LATERAL fallback failed |
| `fact_trip_delay_snapshot.route_id` | Trip update had no route_id |
| `fact_trip_delay_snapshot.direction_id` | Feed did not specify direction |
| `fact_trip_delay_snapshot.start_date` | Feed did not specify trip start date — blocks fallback chain |
| `fact_vehicle_snapshot.vehicle_id` | Feed entity lacked vehicle descriptor |
| `fact_vehicle_snapshot.trip_id` | Vehicle not on a trip |
| `fact_vehicle_snapshot.route_id` | Vehicle not on a route |
| `fact_vehicle_snapshot.position_timestamp_utc` | Per-entity timestamp missing |

### Warm rollups

| Table.Column | NULL means |
|-------------|-----------|
| `trip_delay_summary_5m.avg_delay_seconds` | All observations in the period had NULL delay |
| `trip_delay_summary_5m.avg_delay_seconds_capped` | All non-outlier observations had NULL delay |
| `trip_delay_summary_5m.max_delay_seconds` | All delays NULL |
| `trip_delay_summary_5m.min_delay_seconds` | All delays NULL |

### Power BI handling rules

- Display blank/dash for NULL delays, never zero
- Use `delay_observation_count` vs `observation_count` to show delay coverage percentage
- NULL `route_id` maps to `'__unrouted__'` in warm rollups — filter or label in visuals
- NULL `vehicle_id` in delay facts is acceptable — delay is still valid without it

---

## 7. Idempotency guarantees

### Silver realtime deduplication

**File:** `src/transit_ops/silver/realtime_gtfs.py`, function `load_latest_realtime_to_silver()`

Before loading, the function checks if the `realtime_snapshot_id` already has
rows in the Silver table. If rows exist, it skips the load. This prevents
double-loading if the same snapshot is processed twice.

### Gold upsert (facts)

**File:** `src/transit_ops/gold/marts.py`

`refresh_gold_realtime()` uses `ON CONFLICT ... DO UPDATE SET` for fact tables.
If the same `(provider_id, realtime_snapshot_id, entity_index)` is processed
again, the row is overwritten with identical data. No duplicates.

### Gold replace (latest)

`refresh_gold_realtime()` does `DELETE WHERE provider_id = :provider_id` then
`INSERT ... SELECT` for the latest tables. This is a full replace scoped to one
provider — always results in exactly one snapshot's worth of rows.

### Gold dimensions (static)

`refresh_gold_static()` does `DELETE WHERE provider_id = :provider_id` then
`INSERT ... SELECT` for dimensions. Same full-replace pattern — always
reflects the current `dataset_version_id`.

### Warm rollup idempotency

**File:** `src/transit_ops/gold/rollups.py`

The `warm_rollup_periods` table tracks which 5-minute periods have been built.
The `SELECT_MISSING_*_PERIODS` queries use `NOT IN (SELECT period_start_utc
FROM gold.warm_rollup_periods WHERE ...)` to find only unbuilt periods. The
`UPSERT_WARM_ROLLUP_PERIOD` uses `ON CONFLICT DO UPDATE SET built_at_utc = ...`
so re-running is safe and incremental.

---

## 8. Advisory lock pattern

**File:** `src/transit_ops/gold/marts.py`

Both `refresh_gold_realtime()` and `refresh_gold_static()` acquire advisory
locks to prevent concurrent Gold refreshes from corrupting data:

```python
conn.execute(text("SELECT pg_advisory_xact_lock(:lock_key)"), {"lock_key": lock_key})
```

- `refresh_gold_realtime` and `refresh_gold_static` use different lock keys
- `build_gold_marts()` (manual recovery) uses `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` — heavier but only for manual use
- Advisory locks are transaction-scoped (`pg_advisory_xact_lock`) — released on commit/rollback
- The realtime worker runs single-threaded, so the lock is a safety net, not a hot contention point

---

## 9. stop_time_update_count

The `stop_time_update_count` column in Gold fact tables counts how many
stop-level predictions existed for each trip:

```sql
COALESCE(stc.stop_time_update_count, 0)
```

From the `stop_time_counts` CTE:
```sql
SELECT
    realtime_snapshot_id,
    trip_update_entity_index AS entity_index,
    count(*)::integer AS stop_time_update_count
FROM silver.trip_update_stop_time_updates
WHERE provider_id = :provider_id
GROUP BY realtime_snapshot_id, trip_update_entity_index
```

This tells you:
- `0` = trip had no stop-level predictions at all
- Low count = sparse predictions (common for trips far from service start)
- High count = dense predictions (trip actively running with many stops predicted)

Useful for data quality analysis: trips with `stop_time_update_count = 0` AND
`delay_seconds IS NULL` are trips where no delay information was available at all.

---

*Cross-references: [04-schema-usage-map](04-schema-usage-map.md) for table
definitions, [07-query-drills.sql](07-query-drills.sql) for reproducing
these computations against live data.*
