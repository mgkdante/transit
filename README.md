# Transit Ops

`transit_ops` is a portfolio-oriented GTFS / GTFS-RT analytics foundation that
starts with STM and is designed to stay provider-ready within the GTFS and
GTFS-Realtime standards.

## What this project is

This repository is the bootstrap and database foundation for an operations-style
transit analytics system. The end state is a clean pipeline that stores GTFS
schedule and GTFS-RT data in Neon Postgres, models it into Bronze / Silver /
Gold layers, and feeds a downstream Power BI dashboard.

This is intentionally not a startup SaaS. V1 is STM-first, single-provider, and
portfolio-focused.

## V1 scope

The current implemented slices establish the project skeleton, core database
foundation, and provider registry seam:

- Python 3.12 project managed with `uv`
- Pydantic settings and logging
- Runnable Typer CLI
- Alembic migration setup for the base schemas and metadata tables
- STM seed data for `core.providers` and `core.feed_endpoints`
- YAML-backed provider manifest loading for STM
- Bronze static GTFS download, checksuming, R2-first raw archiving, and raw metadata registration
- Bronze GTFS-RT one-shot snapshot capture, protobuf metadata extraction, R2-first raw archiving, and raw metadata registration
- Silver static GTFS normalization into canonical Neon tables with dataset-versioned loads
- Silver GTFS-RT normalization from captured Bronze snapshots into canonical Neon tables
- Gold route/stop/date dimensions plus realtime snapshot facts and KPI views
- explicit static and realtime orchestration commands for the proven Bronze -> Silver -> Gold flow
- one long-running realtime worker entrypoint for cloud/container deployment
- one GitHub Actions workflow for daily static refreshes plus a Dockerfile for the realtime worker
- Architecture and setup documentation

## Why STM-first but provider-ready

The implementation starts with STM because the portfolio story is clearer when
the first provider is real and well-scoped. The database design and settings
model are still provider-ready:

- all core metadata carries `provider_id`
- GTFS source identifiers are preserved
- feed endpoint registration is normalized in `core.feed_endpoints`
- the schema shape can support more GTFS / GTFS-RT providers later

The abstraction target is GTFS and GTFS-Realtime, not arbitrary transit APIs.

Prompt 2 adds a simple provider registry based on YAML manifests in
`config/providers/`. STM is the only active manifest in V1, but the seam now
exists for additional GTFS providers later.

## Why Neon is the reporting core

Neon Postgres is the reporting core because this project is meant to highlight
SQL-first analytics engineering:

- a durable relational source for normalized schedule and realtime data
- clean separation between raw ingestion metadata and curated marts
- direct support for downstream BI tools such as Power BI
- simple local development with a cloud-hosted reporting database

## Why Bronze / Silver / Gold exists

The data model is layered on purpose:

- Bronze preserves raw source artifacts and ingestion traceability
- Silver holds canonical GTFS / GTFS-RT relational tables
- Gold exposes BI-friendly facts, dimensions, and KPI views

The current foundation only creates the schemas and base metadata tables needed
to grow into that layered design.

## Bronze static ingestion

Slice 2 adds the first real ingestion step for STM static GTFS:

- the static schedule URL comes from the validated STM provider manifest
- the ZIP is downloaded once on demand through the CLI
- the file is archived under the configured Bronze storage backend
- a SHA-256 checksum and byte size are recorded
- one row is written to `raw.ingestion_runs`
- one row is written to `raw.ingestion_objects`

The current logical Bronze object key pattern is:

`provider_id/endpoint_key/ingested_at_utc=YYYY-MM-DD/YYYYMMDDTHHMMSSffffffZ__<checksum12>__<filename>`

Example logical key:

`stm/static_schedule/ingested_at_utc=2026-03-24/20260324T110203456789Z__aaaaaaaaaaaa__gtfs_stm.zip`

Backend behavior:

- local mode stores that logical key under `BRONZE_LOCAL_ROOT`
- S3-compatible mode stores that same logical key as the bucket object key
- `raw.ingestion_objects.storage_path` always stores the logical key only, never an absolute local path
- the implementation is intended to stay compatible with Cloudflare R2 while remaining generic S3-compatible

## Bronze realtime capture

Slice 3 adds one-shot GTFS-RT snapshot capture for STM:

- the `trip_updates` and `vehicle_positions` URLs come from the validated STM provider manifest
- STM realtime access uses the `apiKey` request header with `STM_API_KEY`
- the current Python transport pins TLS 1.2 for compatibility with `api.stm.info`
- each command performs one on-demand capture only
- the raw protobuf payload is archived under the configured Bronze storage backend
- a SHA-256 checksum and byte size are recorded
- GTFS-RT metadata is extracted from the payload:
  - feed header timestamp
  - entity count
  - endpoint kind (`trip_updates` or `vehicle_positions`)
- one row is written to `raw.ingestion_runs`
- one row is written to `raw.ingestion_objects`
- one row is written to `raw.realtime_snapshot_index`

The current realtime logical object key pattern is:

`provider_id/endpoint_key/captured_at_utc=YYYY-MM-DD/YYYYMMDDTHHMMSSffffffZ__<checksum12>__<endpoint_key>.pb`

Example logical key:

`stm/trip_updates/captured_at_utc=2026-03-24/20260324T121516987654Z__bbbbbbbbbbbb__trip_updates.pb`

As with static Bronze storage:

- local mode stores this logical key under `BRONZE_LOCAL_ROOT`
- S3-compatible mode stores this logical key directly in the configured bucket
- the DB continues to record `storage_backend`, logical `storage_path`, byte size, checksum, source URL, and ingestion lineage

This slice intentionally starts with one-shot Bronze capture, but the repo now
also includes a separate orchestration layer and a long-running realtime worker
that can call those captures continuously on a safe cadence.

The STM shared secret is still not used by the current GTFS-RT capture path.

## Bronze storage modes

The current Bronze storage abstraction still supports two backends in code:

- `local`
- `s3`

The intended durable Bronze mode is now Cloudflare R2 through the S3-compatible
backend:

- set `BRONZE_STORAGE_BACKEND=s3`
- set `BRONZE_S3_ENDPOINT=https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com`
- set `BRONZE_S3_BUCKET=transit-raw`
- set `BRONZE_S3_ACCESS_KEY`
- set `BRONZE_S3_SECRET_KEY`
- set `BRONZE_S3_REGION=auto`

Important R2 rules:

- `BRONZE_S3_ENDPOINT` must be the account-level endpoint only
- do not append `/transit-raw` or any other path segment to the endpoint
- pass the bucket separately as `BRONZE_S3_BUCKET=transit-raw`
- the implementation uses SigV4 signing and path-style addressing for R2 compatibility

Local disk is no longer the intended durable Bronze store. It still exists for:

- local temp staging before upload/download
- backward-compatible reads for historical local Bronze rows
- explicit local-only development workflows if you intentionally set `BRONZE_STORAGE_BACKEND=local`

The current implementation still downloads each artifact to a local temp file
first and then persists it through the configured Bronze backend. The
orchestration and worker layers sit on top of this storage path without
changing the underlying Bronze key semantics.

## Silver static normalization

Slice 4 adds the first Silver normalization step for STM static GTFS:

- the loader finds the latest successfully archived Bronze static ZIP for the provider
- it reopens the archive through the recorded Bronze storage backend
- it validates the required GTFS members inside the archive
- it parses the required core files:
  - `routes.txt`
  - `trips.txt`
  - `stops.txt`
  - `stop_times.txt`
  - `calendar.txt`
  - `calendar_dates.txt`
- it creates a new `core.dataset_versions` row for every Silver load
- it loads canonical rows into:
  - `silver.routes`
  - `silver.trips`
  - `silver.stops`
  - `silver.stop_times`
  - `silver.calendar`
  - `silver.calendar_dates`

Dataset versioning works like this:

- the latest successful Bronze static archive is treated as the source artifact
- each Silver load creates a fresh dataset version row
- Silver rows are written with both `provider_id` and `dataset_version_id`
- prior Silver dataset versions are left intact
- older dataset version rows are marked `is_current = false` and the newly loaded version is marked current

This keeps the pipeline append-only at the data level while still letting the
repo point to one current static dataset for downstream use.

## Silver realtime normalization

Slice 5 adds the first Silver normalization step for GTFS-RT snapshots:

- the loader finds the latest successful Bronze realtime snapshot for the provider and endpoint
- it reads the archived protobuf through the recorded Bronze storage backend
- it parses the payload with `gtfs-realtime-bindings`
- it normalizes a minimal V1 field set into:
  - `silver.trip_updates`
  - `silver.trip_update_stop_time_updates`
  - `silver.vehicle_positions`

The current V1 realtime fields are intentionally narrow:

- trip updates store snapshot linkage plus practical trip-level fields such as `trip_id`, `route_id`, `direction_id`, `start_date`, `vehicle_id`, `trip_schedule_relationship`, `delay_seconds`, and `entity_id`
- stop time updates store only the parent linkage plus practical stop-level fields such as `stop_sequence`, `stop_id`, `arrival_delay_seconds`, `arrival_time_utc`, `departure_delay_seconds`, `departure_time_utc`, and `schedule_relationship`
- vehicle positions store snapshot linkage plus practical location fields such as `vehicle_id`, `trip_id`, `route_id`, `stop_id`, `current_stop_sequence`, `current_status`, `occupancy_status`, `latitude`, `longitude`, `bearing`, `speed`, and `position_timestamp_utc`

Bronze-to-Silver linkage is explicit through `realtime_snapshot_id`, which
connects each Silver realtime row back to:

- `raw.realtime_snapshot_index`
- `raw.ingestion_runs`
- `raw.ingestion_objects`

This remains a one-shot load from already captured snapshots, and the new
realtime worker simply automates those same explicit load steps on a fixed
cadence.

## Gold marts and KPI views

Slice 6 adds the first BI-ready Gold layer for STM:

- `gold.dim_route`
- `gold.dim_stop`
- `gold.dim_date`
- `gold.fact_vehicle_snapshot`
- `gold.fact_trip_delay_snapshot`

The Gold layer is intentionally explicit and narrow:

- route and stop dimensions are rebuilt from the current static Silver dataset
- the date dimension is rebuilt from the current static service calendar range and exceptions
- vehicle and trip delay facts are rebuilt from all currently loaded Silver realtime snapshots
- KPI views query the Gold fact tables directly instead of making BI rebuild the logic ad hoc

The current KPI views are:

- `gold.kpi_active_vehicles_latest`
- `gold.kpi_routes_with_live_vehicles_latest`
- `gold.kpi_avg_trip_delay_latest`
- `gold.kpi_max_trip_delay_latest`
- `gold.kpi_delayed_trip_count_latest`

The current trip-delay KPIs intentionally use the trip-level GTFS-RT
`delay_seconds` field from `silver.trip_updates`. If STM omits that top-level
delay in a snapshot, the average and maximum delay KPIs will return `NULL`
while the delayed trip count KPI will return `0`.

Gold refresh is still explicit and CLI-driven:

- `build-gold-marts stm`

Power BI dashboard work is still deferred.

## Pipeline orchestration and automation

The repo now includes explicit orchestration commands that reuse the already
proven Bronze, Silver, and Gold services instead of duplicating business logic:

- `run-static-pipeline stm`
  - runs `ingest-static stm`
  - runs `load-static-silver stm`
  - runs `build-gold-marts stm`
- `run-realtime-cycle stm`
  - runs `capture-realtime stm trip_updates`
  - runs `capture-realtime stm vehicle_positions`
  - runs `load-realtime-silver stm trip_updates`
  - runs `load-realtime-silver stm vehicle_positions`
  - runs `build-gold-marts stm`

Operational rules:

- Bronze durable storage remains R2-first through `BRONZE_STORAGE_BACKEND=s3`
- the orchestration commands keep the existing DB lineage and R2 object key behavior intact
- `run-realtime-cycle stm` attempts both realtime endpoints every cycle
- if one endpoint fails and the other succeeds, the command reports a partial failure explicitly and exits non-zero
- Gold is rebuilt after any successful realtime endpoint load so downstream BI stays current with the latest successful data

## Continuous realtime worker

The repo also now includes one minimal long-running worker entrypoint:

- `run-realtime-worker stm`

It is intended for container or cloud deployment and:

- loops forever
- runs one realtime cycle per loop
- logs each cycle clearly
- exits non-zero on fatal startup/configuration issues
- keeps running across per-cycle endpoint failures so one bad pull does not corrupt later cycles

Worker environment variables:

- `REALTIME_POLL_SECONDS`
  - default: `30`
  - controls how often one full realtime cycle starts
- `REALTIME_STARTUP_DELAY_SECONDS`
  - default: `0`
  - optional startup delay before the first cycle

## Deployment artifacts

The repo ships one static batch workflow and one container path for the
realtime worker.

### GitHub Actions static workflow

The included workflow file is:

- `.github/workflows/daily-static-pipeline.yml`

Current behavior:

- triggers once per day at `06:00 UTC`
- `06:00 UTC` corresponds to `2:00 AM Eastern` while EDT is in effect
- GitHub Actions cron is UTC-based, so this may need a seasonal UTC adjustment
  during EST if the desired local run time remains `2:00 AM Eastern`
- supports manual runs through `workflow_dispatch`
- uses `timeout-minutes: 30`
- uses `concurrency` to avoid overlapping static runs
- keeps GitHub permissions narrowed to `contents: read`
- runs:
  - `uv sync --locked`
  - `python -m transit_ops.cli init-db`
  - `python -m transit_ops.cli seed-core`
  - `python -m transit_ops.cli run-static-pipeline stm`

Exact GitHub Actions secrets required after you push the repo:

- `NEON_DATABASE_URL`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

`STM_API_KEY` is not required for the daily static workflow because it does not
capture GTFS-RT feeds.

### Realtime worker container

The included container path is:

- `Dockerfile`

Current container behavior:

- builds from `python:3.12-slim`
- installs the project with `uv sync --locked --no-dev`
- runs as a non-root `appuser`
- excludes `.env`, local Bronze data, Git history, docs, tests, and common log
  files from the build context through `.dockerignore`
- uses:
  - `ENTRYPOINT ["python", "-m", "transit_ops.cli"]`
  - `CMD ["run-realtime-worker", "stm"]`

Example local build:

```bash
docker build -t transit-ops-worker .
```

Example bounded local smoke test:

```bash
docker run --rm --env-file .env transit-ops-worker run-realtime-worker stm --max-cycles 1
```

The realtime worker still uses true start-to-start cadence timing in container
mode because it reuses the same CLI and orchestration path as local execution.

### Hosted realtime worker status

Hosted realtime deployment is not yet achieved from the current repository
environment.

What is already proven:

- the Docker image builds locally
- bounded worker container runs succeed locally
- the worker keeps its true start-to-start cadence in containerized execution

What is still missing:

- one authenticated long-running container host or platform CLI that is already
  available from this environment
- or one checked-in deployment manifest for an existing container platform

The next manual step to get the worker hosted is to choose and authenticate one
simple long-running container host, then deploy the existing Dockerized worker
there with these runtime secrets:

- `NEON_DATABASE_URL`
- `STM_API_KEY`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

The current hosted worker runtime should also set:

- `REALTIME_POLL_SECONDS=30`
- `REALTIME_STARTUP_DELAY_SECONDS=0`

## Freshness and delay expectations

The static and realtime automation paths have different delay expectations:

- static GTFS is intended to run once per day through GitHub Actions
- the included GitHub Actions workflow currently schedules the static pipeline daily at `06:00 UTC`
- that currently lines up with `2:00 AM Eastern` while EDT is in effect
- because GitHub Actions cron is UTC-based, the schedule may need a seasonal
  UTC adjustment during EST if the desired local run time remains `2:00 AM Eastern`
- realtime is intended to run continuously through the worker container
- the default worker cadence is one full realtime cycle every `30` seconds

For live data, the practical delay is:

- one polling interval
- plus the actual time to capture both GTFS-RT endpoints
- plus the Silver loads
- plus the Gold rebuild

In practice, that means the current default operating target is roughly
sub-minute to low-minute freshness, not instant streaming. If one realtime
endpoint fails, the cycle reports the partial failure explicitly instead of
pretending both feeds are fresh.

## Intentionally deferred

The following work is intentionally out of scope for this slice:

- dashboard assets and frontend UI
- Power BI dashboard implementation
- Neon Data API exposure
- public packaging work under `transit.yesid.dev`

## Why provider manifests exist

Provider manifests keep provider metadata and feed definitions out of the CLI
and away from hardcoded STM constants. They provide one small extension point
for:

- provider metadata
- GTFS / GTFS-RT feed definitions
- refresh cadence metadata
- auth metadata shape
- future provider expansion without changing the database schema

This is intentionally a small YAML registry, not a plugin framework.

## Why STM is the only active provider in V1

V1 stays STM-only on purpose:

- it keeps the portfolio story concrete
- it avoids building a fake multi-provider platform too early
- it keeps ingestion and reporting design grounded in one real provider

The code is provider-ready within GTFS / GTFS-RT, but STM is the only manifest
the repo actively ships today.

## How future providers can be added

Future GTFS providers can be added by:

1. creating a new manifest under `config/providers/`
2. using the same validated manifest structure
3. reusing the registry and CLI inspection commands
4. wiring later ingestion slices against the validated manifest data

No database schema changes are required just to register another GTFS provider.

## Install and run

1. Copy `.env.example` to `.env` and fill in:

- `NEON_DATABASE_URL`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`
- `STM_API_KEY` if you plan to run live GTFS-RT capture
2. Install dependencies:

```bash
uv sync
```

3. Inspect the current configuration:

```bash
uv run transit-ops show-config
```

4. Inspect provider manifests:

```bash
uv run python -m transit_ops.cli list-providers
uv run python -m transit_ops.cli show-provider stm
```

5. Test the Neon connection:

```bash
uv run transit-ops db-test
```

6. Initialize the database schemas and tables:

```bash
uv run transit-ops init-db
```

7. Seed STM provider metadata:

```bash
uv run transit-ops seed-core
```

8. Run one Bronze static STM ingestion:

```bash
uv run python -m transit_ops.cli ingest-static stm
```

9. Run one Bronze realtime STM capture:

```bash
uv run python -m transit_ops.cli capture-realtime stm trip_updates
uv run python -m transit_ops.cli capture-realtime stm vehicle_positions
```

10. Load the latest Bronze static STM archive into Silver:

```bash
uv run python -m transit_ops.cli load-static-silver stm
```

11. Load the latest Bronze realtime STM snapshots into Silver:

```bash
uv run python -m transit_ops.cli load-realtime-silver stm trip_updates
uv run python -m transit_ops.cli load-realtime-silver stm vehicle_positions
```

12. Rebuild the current Gold marts and KPI-ready tables:

```bash
uv run python -m transit_ops.cli build-gold-marts stm
```

13. Run the one-shot orchestration commands:

```bash
uv run python -m transit_ops.cli run-static-pipeline stm
uv run python -m transit_ops.cli run-realtime-cycle stm
```

14. Run the continuous realtime worker:

```bash
uv run python -m transit_ops.cli run-realtime-worker stm
```

15. The module entrypoint also works:

```bash
uv run python -m transit_ops.cli --help
```
