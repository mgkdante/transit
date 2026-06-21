# Transit

**Turborepo (bun + turbo) — apps under `apps/`:**
- **`apps/db`** — the GTFS / GTFS-RT analytics **pipeline** (STM feeds → Bronze on R2 → Silver/Gold in Postgres), uv-managed. Run pipeline commands from `apps/db` (e.g. `cd apps/db && uv run pytest tests -v`).
- **`apps/web`** — the public **citizen web app** (SvelteKit deployed as a Cloudflare Worker; live map + analytics fed by R2 snapshots of the gold marts). **Live at `transit.yesid.dev`.**
- **`apps/data-proxy`** — the Cloudflare Worker serving the public `/v1` snapshot contract at `transit.yesid.dev/data/*`.

> The legacy Power BI + ArcGIS reporting layer was retired (2026-05-30); the `apps/web` citizen app replaces it.

This repo is the codebase and local artifact store for the project. Long-form business context, architecture notes, runtime decisions, and workflow state now live in the Transit Notion workspace. The repo should stay useful to an engineer opening it cold, but it is no longer the canonical place for that prose.

## Notion Home

[Transit Notion Home](https://www.notion.so/themlabs/Transit-3663e8630690809891abd71e03b57254?source=copy_link)

Start there for business context, architecture, runtime notes, and workflow state.

## Reporting — Citizen Web App

The public reporting surface is a free, anonymous **SvelteKit web app** (live map + analytics) at `transit.yesid.dev`, fed by a versioned `/v1` R2 snapshot of the Gold marts. It reads only the `/v1` contract (edge-cached), never the database. It surfaces live STM network activity — active vehicles, route coverage, trip-delay KPIs, occupancy, alerts, and data freshness. Static schedule data refreshes daily; realtime vehicle and trip data on a 30-second cadence through the worker. Design is locked (see the Notion **Source of Truth** bundle); the slice-9.2 foundation is **live** at `transit.yesid.dev` (`apps/web`).

## What This Project Is

Transit is a portfolio project focused on end-to-end analytics engineering:

- GTFS static schedule ingestion
- GTFS-Realtime capture for TripUpdates and VehiclePositions
- Bronze / Silver / Gold data modeling with lineage
- Near-real-time orchestration and retention management
- Health monitoring for runtime, database, pipeline, refresh, and Bronze storage checks
- A free public citizen web app (live map + analytics) over a versioned R2 snapshot of Gold

This is not a SaaS app, not a multi-tenant platform, and not a consumer-facing realtime product.

## Architecture At A Glance

```text
STM GTFS static ZIP   -> Bronze (R2/S3) -> Silver (Postgres) -> Gold dims/maps      -> /v1 R2 snapshot -> web app
STM GTFS-RT protobuf  -> Bronze (R2/S3) -> Silver (Postgres) -> Gold facts/current  -> /v1 R2 snapshot -> web app
STM i3 alerts JSON    -> Bronze (R2/S3) -> Silver (Postgres) -> Gold alerts/history -> /v1 R2 snapshot -> web app
                                                                 -> Warm rollups     -> /v1 R2 snapshot
```

Stack: Python 3.12, Postgres/PostGIS, Cloudflare R2/S3-compatible Bronze storage, Docker Compose, Caddy, GitHub Actions, and a SvelteKit web app on Cloudflare.

The Oracle Always Free A1 host is now the production runtime for the database, realtime worker, health service, and GitHub Actions `DATABASE_URL` jobs. The host exposes hardened PostgreSQL paths: TLS/SCRAM app-owner access for automation, TLS/SCRAM `transit-reporting` access scoped to Gold for the reporting snapshot publisher and `transit.yesid.dev`, and SSH-first TLS/SCRAM `transit-db` access for operator SQL analysis.

Operationally:

- Bronze stores raw artifacts plus lineage
- Silver stores normalized GTFS and GTFS-RT tables
- Gold serves dimensions, operational facts, map marts, clean reporting marts, alert history, and warm rollups for the web app / reporting consumers
- the health API reports runtime readiness and freshness signals
- the citizen web app reads from Gold/reporting surfaces only, via the `/v1` R2 snapshot

Notion is the source of truth for the deeper architecture breakdown, runtime behavior, and workflow history.

## Current Scope

- STM/Montréal is the only active provider in V1
- Daily GTFS static ingestion
- 30-second GTFS-RT cycle
- Durable Bronze archive through Cloudflare R2 today, with an S3-compatible code path
- Silver normalization in Postgres
- Gold serving tables and warm rollups
- The citizen web app at `transit.yesid.dev` (slice-9.2 foundation live)

Provider-ready means the schema and manifests are structured so additional GTFS/GTFS-RT/GIS/i3-style providers can be added later, but STM/Montréal is the only active provider today.

## Quick Start

Prerequisites: Python 3.12, [`uv`](https://github.com/astral-sh/uv), a Postgres connection string, Cloudflare R2 or S3-compatible credentials, and an STM API key for realtime capture. Run pipeline commands from `apps/db`. (For the web app: `bun install` at the repo root, then `cd apps/web`.)

```bash
cd apps/db
cp ../../.env.example ../../.env
uv sync
uv run transit-ops db-test
uv run transit-ops init-db
uv run transit-ops seed-core
uv run python -m transit_ops.cli run-static-pipeline stm
uv run python -m transit_ops.cli run-realtime-cycle stm
uv run python -m transit_ops.cli run-realtime-worker stm
```

Required environment variables:

| Variable | Required for |
|----------|--------------|
| `DATABASE_URL` | All database-backed operations |
| `BRONZE_S3_ACCESS_KEY` / `BRONZE_S3_SECRET_KEY` | Bronze R2/S3 storage |
| `STM_API_KEY` | Realtime GTFS-RT capture |

See `.env.example` for the full variable list including Bronze storage options, health-check settings, retention windows, and cadence overrides.

## Health API

The health service is a small FastAPI app for operational checks:

```bash
uv run uvicorn transit_ops.health.app:create_app --factory --host 0.0.0.0 --port 8000
```

Container builds can use:

```bash
docker build -f Dockerfile.health -t transit-ops-health .
docker run --rm --env-file .env -p 8000:8000 transit-ops-health
```

Core endpoints:

- `GET /health/live`
- `GET /health`

## Local Runtime Stack

The Oracle-ready local stack runs Postgres, the realtime worker, the health API, and Caddy.

Run:

```bash
docker compose up -d postgres health caddy
docker compose up -d worker
```

Caddy proxies health traffic to the health service. Local defaults serve the proxy over HTTP through `CADDY_SITE_ADDRESS=:80` and host port `CADDY_HTTP_PORT=8080`. The Compose file also publishes container port 443 to `CADDY_HTTPS_PORT=8443` for later VM/TLS configuration.

## Oracle Production Status

The current Oracle VM baseline is:

- OCI Canada Southeast / Montréal on Pay As You Go with the budget guardrail enabled
- `VM.Standard.A1.Flex`, 4 OCPU, 24 GB RAM, Ubuntu 24.04 ARM, 200 GB boot volume
- SSH admin access restricted at both OCI NSG and UFW to the operator public `/32`
- SSH password login and root login disabled; fail2ban and unattended upgrades active
- Docker Engine and Compose installed from Docker's official Ubuntu repository
- Docker Compose runs Postgres, the realtime worker, the health API, and Caddy on the Oracle host
- ports 80 and 443 remain loopback-only for the current staging shape
- public TCP 5432 is open through OCI NSG and UFW only for hardened PostgreSQL paths

GitHub Actions uses the Oracle app-owner `DATABASE_URL`; the daily static pipeline and warm-rollup workflows are active after manual Oracle-backed proof runs. The reporting snapshot publisher and `transit.yesid.dev` use the dedicated `transit-reporting` role against Gold/reporting surfaces. Operator SQL exploration uses `transit-db`, preferably through an SSH tunnel with Postgres TLS still required. Exact instance identifiers, public IP, firewall evidence, rebuild reports, and workflow run links live in Notion under the `upgrading` roadmap.

The PostgreSQL serving-access helpers live in `infra/postgres-serving-access/`. They render the TLS-only `pg_hba.conf` shape, apply the dedicated `transit-reporting` and `transit-db` grants, and verify current user, TLS, allowed schema reads, denied forbidden schemas, denied writes, and the expected temp-table policy.

## Pipeline Control

To pause the pipeline:

```bash
bash scripts/pause-pipeline.sh
```

To resume it:

```bash
bash scripts/resume-pipeline.sh
```

To validate the Oracle cutover without changing runtime state:

```bash
HEALTH_BASE_URL=https://transit.example.com \
DATABASE_URL="$DATABASE_URL" \
bash scripts/validate-oracle-cutover.sh
```

If health is intentionally internal-only, run the same validator through SSH:

```bash
HEALTH_BASE_URL=http://127.0.0.1:8080 \
HEALTH_SSH_TARGET=ubuntu@db.transit.yesid.dev \
DATABASE_URL="$DATABASE_URL" \
bash scripts/validate-oracle-cutover.sh
```

The app database contract is `DATABASE_URL`. Oracle VM Postgres stays running during pause/resume; the scripts only disable GitHub Actions schedules and stop or start the Compose worker.

Weekly `pg_repack` maintenance runs through `.github/workflows/weekly-pg-repack.yml`. The scheduled Sunday run (08:00 UTC / 04:00 Montreal) now **executes** a table-scoped repack with `--no-kill-backend` over the 10 current churn tables; manual dispatch defaults to dry-run (`dry_run=false` to execute, optional `tables` to scope). The 29GB `silver.rt_trip_update_stop_times` is excluded from the defaults and repacked from inside the postgres container via the on-VM runbook. The `pg_repack` extension is created by migration `0040`. If a run dies mid-flight it can leave orphaned repack triggers/log tables that tax every write — the job fails loudly and prints the cleanup, which is `DROP EXTENSION pg_repack CASCADE; CREATE EXTENSION pg_repack;`.

## Retention Proof Reports

The expected retention defaults are: static dataset count 1, Bronze raw static/i3 30 days, Bronze raw realtime 90 days, Silver realtime 1 day, Gold detail facts 14 days, and Gold aggregate/reporting marts 730 days.

To generate a local non-destructive proof report:

```bash
uv run python -m transit_ops.cli retention-proof-report stm --report-path artifacts/retention-proof.json
```

To validate static feeds separately:

```bash
uv run python -m transit_ops.cli validate-static-feeds stm --report-path artifacts/static-feeds.json
```

The retention proof report also embeds the static validation result. These commands are proof/reporting only: they must not ingest feeds, seed provider rows, delete storage, or mutate DB/R2 state. If local `DATABASE_URL` or R2 credentials are missing, sections may report `unavailable` dry-run status. That is an honest local proof state, not hidden success.

## Repo Navigation

```text
.github/workflows/                  CI: daily static pipeline + warm rollup build + web + data-proxy
package.json · turbo.json           Root bun + turbo workspace
apps/db/                            Pipeline (run commands from here; uv-managed)
  src/transit_ops/
    ingestion/                      Feed capture and R2/S3 archiving
    silver/                         GTFS and GTFS-RT normalization
    gold/                           Mart builders, reporting aggregates, warm rollups
    health/                         Operational health API
    db/migrations/                  Alembic migrations
    orchestration.py                Static pipeline, realtime cycle, worker
  config/providers/                 Provider manifests
  scripts/                          Pipeline control helpers
  infra/postgres-serving-access/    Hardened reader grants
  Dockerfile / Dockerfile.health    Worker + health API containers
apps/web/                           Citizen web app (SvelteKit → Cloudflare Worker, live)
apps/data-proxy/                    Cloudflare Worker serving /v1 at transit.yesid.dev/data/*
packages/                           (reserved for future shared workspace packages)
```

For workflow and canonical context, start with this README's Notion Home link and then [AGENTS.md](AGENTS.md) for the tool contract.
