# Architecture

## Logical architecture

The target system is a GTFS / GTFS-RT analytics pipeline with Neon Postgres as
the reporting core:

```text
STM GTFS static feed ----> Bronze storage (Cloudflare R2 via S3-compatible API) ----> Silver canonical tables ----> Gold marts ----> Power BI
STM GTFS-RT snapshots ---> Bronze storage (Cloudflare R2 via S3-compatible API) ----> Silver realtime tables ----> Gold marts ----> Power BI
                                                  |
                                                  +--> Ops visibility and ingestion metadata
```

Prompt 1 established the repository scaffold, application settings, CLI, and
foundational Neon schemas and metadata tables. Prompt 2 added a file-backed
provider manifest seam for STM. Slice 2 adds Bronze static GTFS ingestion for
the STM schedule feed only. Slice 3 adds one-shot Bronze GTFS-RT snapshot
capture for STM `trip_updates` and `vehicle_positions`. Slice 4 adds Silver
static GTFS normalization for the latest Bronze static archive. Slice 5 adds
Silver GTFS-RT normalization for the latest Bronze realtime snapshots. Slice 6
adds the first BI-ready Gold marts and KPI views.

## Schema purpose

- `core`: provider metadata, feed registry, and dataset version tracking
- `raw`: ingestion execution records and raw snapshot indexing
- `silver`: reserved for canonical GTFS / GTFS-RT relational tables
- `gold`: reserved for BI-ready marts, facts, dimensions, and KPI views
- `ops`: reserved for operational monitoring and audit views

This step creates the schemas above and only the initial `core` and `raw`
tables needed to support future ingestion and normalization slices.

Slice 4 expands the `silver` schema with these static GTFS tables:

- `silver.routes`
- `silver.trips`
- `silver.stops`
- `silver.stop_times`
- `silver.calendar`
- `silver.calendar_dates`

Slice 5 expands the `silver` schema with these realtime GTFS-RT tables:

- `silver.trip_updates`
- `silver.trip_update_stop_time_updates`
- `silver.vehicle_positions`

Slice 6 expands the `gold` schema with these marts:

- `gold.dim_route`
- `gold.dim_stop`
- `gold.dim_date`
- `gold.fact_vehicle_snapshot`
- `gold.fact_trip_delay_snapshot`

Slice 6 also adds KPI views:

- `gold.kpi_active_vehicles_latest`
- `gold.kpi_routes_with_live_vehicles_latest`
- `gold.kpi_avg_trip_delay_latest`
- `gold.kpi_max_trip_delay_latest`
- `gold.kpi_delayed_trip_count_latest`

The current automation slice adds:

- one-shot orchestration commands for the static and realtime pipelines
- one long-running realtime worker entrypoint
- one GitHub Actions workflow for the daily static pipeline
- one Docker image entrypoint for the continuous realtime worker
- a dedicated static Gold dimension refresh path (`refresh-gold-static`) that
  decouples the daily static batch from the heavy full Gold rebuild

## Bronze static ingestion

The first implemented ingestion flow is intentionally narrow:

- it only handles the STM static schedule ZIP
- it downloads the source URL from the validated provider manifest
- it archives the ZIP through the configured Bronze storage backend
- it records one `raw.ingestion_runs` row and one `raw.ingestion_objects` row

The current Bronze logical object key pattern is:

`provider_id/endpoint_key/ingested_at_utc=YYYY-MM-DD/YYYYMMDDTHHMMSSffffffZ__<checksum12>__<filename>`

This keeps Bronze object keys:

- human-readable
- deterministic from run metadata and downloaded content
- provider-aware
- simple to inspect from the filesystem or object storage

The current backend behavior is:

- the intended durable mode is `BRONZE_STORAGE_BACKEND=s3` with Cloudflare R2
- in S3-compatible mode, the logical key is written directly as the object key
- in local mode, the logical key is stored under `BRONZE_LOCAL_ROOT`
- `raw.ingestion_objects.storage_path` remains a logical key only
- for R2, the endpoint must be the account-level endpoint and the bucket must be passed separately

## Bronze realtime capture

Slice 3 adds one-shot GTFS-RT snapshot capture for the STM realtime feeds:

- it resolves the endpoint URL and auth shape from the validated provider manifest
- it currently uses the `apiKey` request header backed by `STM_API_KEY`
- it pins TLS 1.2 in the Python transport for compatibility with `api.stm.info`
- it performs one request per CLI invocation
- it archives the raw protobuf response through the configured Bronze storage backend
- it records one `raw.ingestion_runs` row
- it records one `raw.ingestion_objects` row
- it records one `raw.realtime_snapshot_index` row

The current realtime logical object key pattern is:

`provider_id/endpoint_key/captured_at_utc=YYYY-MM-DD/YYYYMMDDTHHMMSSffffffZ__<checksum12>__<endpoint_key>.pb`

The current captured realtime metadata is:

- feed header timestamp from the GTFS-RT protobuf
- entity count from the GTFS-RT protobuf
- endpoint kind via the manifest-selected feed and command input
- byte size, checksum, source URL, and UTC run timing metadata

The STM shared secret is still not part of the current GTFS-RT request path.

The Bronze storage abstraction is intentionally small:

- one local backend
- one S3-compatible backend
- no plugin framework

The S3-compatible path is hardened for Cloudflare R2 while remaining generic
enough for other S3-compatible object stores:

- SigV4 signing
- `auto` signing region for R2
- path-style addressing
- account-level endpoint validation

The current implementation still uses a local temp file before final
persistence, even in S3-compatible mode.

## Silver static normalization

Slice 4 adds the first canonical relational load for static GTFS:

- it finds the latest successful Bronze static archive for the provider
- it opens the archived ZIP through the recorded Bronze storage backend
- it validates the required GTFS members before loading
- it creates a new `core.dataset_versions` row for the load
- it loads the required static GTFS entities into the `silver` schema

The current Silver static tables are:

- `silver.routes`
- `silver.trips`
- `silver.stops`
- `silver.stop_times`
- `silver.calendar`
- `silver.calendar_dates`

Dataset versioning now works like this:

- each Silver static load creates a fresh `core.dataset_versions` row
- the version points back to the Bronze static ingestion run and object
- every Silver static row carries both `provider_id` and `dataset_version_id`
- previous dataset-versioned rows remain intact
- prior dataset version records are marked non-current and the latest load is marked current

This keeps Silver loads replace-free at the row level while preserving a clean
current-version pointer for downstream work.

## Silver realtime normalization

Slice 5 adds the first canonical relational load for Bronze GTFS-RT snapshots:

- it finds the latest successful Bronze realtime snapshot for the provider and endpoint
- it opens the archived protobuf through the recorded Bronze storage backend
- it parses the payload with `gtfs-realtime-bindings`
- it writes a minimal V1 set of analytics-friendly realtime fields into the `silver` schema

The current Silver realtime tables are:

- `silver.trip_updates`
- `silver.trip_update_stop_time_updates`
- `silver.vehicle_positions`

The Bronze-to-Silver linkage is explicit:

- every Silver realtime row carries `realtime_snapshot_id`
- `realtime_snapshot_id` points to `raw.realtime_snapshot_index`
- that snapshot row links back to the original Bronze run and Bronze object metadata

The current V1 payload coverage is intentionally narrow:

- trip updates capture trip-level identifiers and delay metadata
- stop time updates capture only the minimum practical arrival/departure fields
- vehicle positions capture only the minimum practical trip, vehicle, stop, and location fields

This keeps the Silver realtime layer useful for downstream marts without trying
to model every optional GTFS-RT field in the first pass.

## Gold marts

Slice 6 creates the first BI-ready layer so Power BI does not have to reconstruct
the current static dimensions and latest realtime metrics from raw Silver tables.

The Gold design stays intentionally small:

- `gold.dim_route` uses the current static `core.dataset_versions` row and the current `silver.routes`
- `gold.dim_stop` uses the current static dataset and the current `silver.stops`
- `gold.dim_date` expands the current static service date range and exception dates into a reusable date dimension
- `gold.fact_vehicle_snapshot` keeps vehicle snapshot history without being fully rewritten every realtime cycle
- `gold.fact_trip_delay_snapshot` keeps trip delay snapshot history, plus stop-time update counts and backfilled vehicle/delay values from related realtime/static tables
- `gold.latest_vehicle_snapshot` keeps only the newest vehicle snapshot per provider for dashboards and browser inspection
- `gold.latest_trip_delay_snapshot` keeps only the newest trip-delay snapshot per provider for dashboards and browser inspection

Gold refresh now has three explicit paths:

- `build-gold-marts`
  - heavy full-history backfill and recovery path
  - acquires `LOCK TABLE ... IN ACCESS EXCLUSIVE MODE` on all Gold tables
  - intended for manual recovery only, not called from any automated pipeline
- `refresh-gold-static`
  - lightweight static batch path that replaces only `dim_route`, `dim_stop`,
    and `dim_date` from the current static Silver dataset version
  - acquires only the advisory lock, no table lock, does not touch fact tables
  - called by `run-static-pipeline` after each daily Bronze → Silver static load
- `refresh-gold-realtime`
  - lightweight realtime path that upserts only the latest snapshots into
    history and refreshes the small `gold.latest_*` tables
  - acquires only the advisory lock, no table lock

The realtime worker and `run-realtime-cycle` use the `refresh-gold-realtime`
path. The daily static pipeline uses the `refresh-gold-static` path. Neither
automated path acquires the ACCESS EXCLUSIVE table lock, eliminating lock
contention between the daily static job and the 60s realtime worker.

The KPI views stay close to the marts:

- active vehicles in the latest vehicle snapshot
- routes with live vehicles in the latest vehicle snapshot
- average trip delay in the latest trip-delay snapshot
- maximum trip delay in the latest trip-delay snapshot
- delayed trip count in the latest trip-delay snapshot

The KPI views now read the lightweight `gold.latest_*` tables directly instead
of scanning the full history facts to discover the latest snapshot first.

The current trip-delay KPI views still use `delay_seconds` derived from the
Gold trip-delay snapshot rows. That Gold field keeps the trip-level GTFS-RT
`delay_seconds` value when STM provides it, and otherwise falls back to a
derived delay based on stop-time update timestamps versus the current static
`silver.stop_times` schedule for the same trip and stop sequence.

`gold.fact_trip_delay_snapshot.vehicle_id` follows the same idea: it keeps the
trip-update `vehicle_id` when present and otherwise backfills from the nearest
`silver.vehicle_positions` row for the same `trip_id`. `route_id` is not used
alone for vehicle inference because multiple active vehicles can share a route.

Storage pressure is now reduced in three places:

- static Silver keeps only the current dataset version by default
- realtime Silver keeps only the newest two days of snapshots by default
- Gold fact tables (`fact_vehicle_snapshot`, `fact_trip_delay_snapshot`) keep
  only the newest two days of rows by default (`GOLD_FACT_RETENTION_DAYS=2`)

Gold fact retention is enforced every realtime cycle via a time-based DELETE
on `captured_at_utc`. Two B-tree indexes on `(provider_id, captured_at_utc)`
support these DELETEs efficiently (migration `0007_gold_fact_retention_indexes`).

That keeps the reporting path honest: heavy history still exists where it is
useful, but the hot path for dashboards no longer depends on repeatedly
rewriting or scanning all of it.

## Why provider abstraction exists

The project is STM-first because the portfolio story is stronger when V1 is
small, real, and disciplined. It is still provider-ready from day one:

- settings are expressed in provider-oriented terms
- provider manifests live under `config/providers/`
- feed endpoints are registered in `core.feed_endpoints`
- all foundational tables carry `provider_id`
- GTFS source identifiers are preserved for later normalization work

The abstraction boundary stays inside GTFS and GTFS-Realtime. The system is not
trying to become a generic transit API framework.

## Why provider manifests exist

Provider manifests exist so provider metadata and GTFS feed definitions can be
declared once and reused by the CLI, seed logic, and future ingestion code.
This keeps Prompt 2 boring and explicit:

- YAML manifests hold provider/feed metadata
- pydantic models validate the manifest structure
- a small registry lists manifests and loads one provider by id

STM is the only active manifest in V1. Future GTFS providers can be added by
adding another validated manifest file without introducing a plugin system.

The static Bronze ingestion code now depends on the manifest and registry
instead of hardcoded STM feed settings, which keeps the extension seam inside
GTFS / GTFS-RT rather than inside custom downloader code.

The realtime Bronze capture code follows the same pattern: manifest-driven feed
resolution, a small service module, Bronze archiving through the configured
backend, and explicit writes to the existing raw metadata tables.

The Silver static loader follows the same pattern again: provider manifest
resolution, explicit load steps, and Neon-first canonical tables without adding
unnecessary framework complexity.

## Power BI status

Power BI report authoring is still downstream of this repository and no `.pbix`
file is checked into the repo.

This slice now adds the minimum Power BI handoff artifacts under `powerbi/`:

- dashboard V1 specification
- report build playbook
- visual-to-field mapping
- DAX measure plan
- SQL validation queries
- portfolio-facing notes

That keeps the repo honest: the BI semantic design is documented and grounded
in the proven Gold layer, but the actual Power BI file is still a downstream
authoring step.

Neon Data API exposure is also still deferred. The current automation slice
stops at the CLI, database, and object-storage layers.

## Orchestration and automation

The current repo now has three operating modes on top of the existing one-shot
services:

- one-shot static orchestration through `run-static-pipeline stm`
- one-shot realtime orchestration through `run-realtime-cycle stm`
- continuous realtime execution through `run-realtime-worker stm`

The orchestration layer stays intentionally thin:

- it reuses the existing Bronze ingestion services
- it reuses the existing Silver loaders
- it reuses the existing Gold mart rebuild
- it does not change DB lineage rules
- it does not change R2 object key behavior

The realtime orchestration behavior is explicit:

- both realtime endpoints are attempted every cycle
- each endpoint is reported separately
- a single endpoint failure does not get reported as all-green
- Gold is rebuilt after any successful realtime load so downstream views stay current

## Automation artifacts

The repo now includes the minimum cloud-ready automation artifacts:

- `.github/workflows/daily-static-pipeline.yml`
  - runs the static Bronze -> Silver -> Gold pipeline once per day
  - currently scheduled for `06:00 UTC`
  - this corresponds to `2:00 AM Eastern` while EDT is in effect
  - GitHub Actions cron is UTC-based, so the UTC schedule may need a seasonal
    adjustment during EST if the desired local run time remains `2:00 AM Eastern`
  - also supports `workflow_dispatch`
  - uses `timeout-minutes: 30`
  - uses workflow `concurrency` to avoid overlapping static runs
  - narrows GitHub permissions to `contents: read`
- `Dockerfile`
  - packages the repo for a generic container platform
  - defaults to `python -m transit_ops.cli run-realtime-worker stm`
  - now uses an explicit CLI entrypoint and a non-root runtime user
- `.dockerignore`
  - keeps `.env`, Git metadata, docs, local data, tests, and dev caches out of the container build context

Hosted realtime deployment is now achieved on Railway.

The current hosted worker target is:

- project: `transit-ops`
- environment: `production`
- service: `realtime-worker`

Railway is using the existing repo `Dockerfile` directly, and the runtime
command remains:

- `python -m transit_ops.cli run-realtime-worker stm`

Hosted verification from Railway logs showed:

- the worker starts successfully
- hosted realtime cycles succeed end to end
- Bronze writes remain R2-backed with `storage_backend = "s3"`
- Gold rebuilds successfully after hosted realtime cycles
- the worker honors the `REALTIME_POLL_SECONDS=60` start-to-start target

Detailed hosted deployment notes live in:

- `docs/realtime-worker-hosting.md`

Exact GitHub Actions secrets required for the included static workflow are:

- `NEON_DATABASE_URL`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

The realtime worker container still expects runtime secret injection outside the
image itself. In practice that means:

- `NEON_DATABASE_URL`
- `STM_API_KEY`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

## Freshness and live data delay

The current operating freshness model is intentionally simple:

- static GTFS is a daily refresh job
- realtime runs as repeated one-shot cycles inside the worker
- the production realtime cadence is `REALTIME_POLL_SECONDS=60`

That means live dashboard freshness is expected to be:

- one polling interval
- plus the actual request and processing time for both GTFS-RT endpoints
- plus the Silver loads
- plus the Gold rebuild

This is near-real-time operational reporting, not true streaming. The trade-off
is deliberate: it stays well inside STM quota limits, keeps the code boring,
and preserves full raw lineage in R2 and Neon.

## Still deferred

The following remain intentionally deferred after the current automation slice:

- Power BI dashboard implementation
- Neon Data API exposure
- richer operational alerting and notifications
- public packaging under `transit.yesid.dev`

## Future packaging

The eventual public packaging is expected to live under
`transit.yesid.dev`, including project notes, architecture visuals, and a case
study for the STM operations dashboard. That public packaging is intentionally
deferred until the pipeline and analytics layers exist.
