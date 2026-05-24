# Transit Ops

A provider-ready GTFS / GTFS-RT analytics pipeline using STM feeds, raw Bronze storage, normalized Postgres tables, and a live Power BI operations dashboard.

This repo is the codebase and local artifact store for the project. Long-form business context, architecture notes, runtime decisions, workflow state, and Power BI semantic-model knowledge now live in the Transit Notion workspace. The repo should stay useful to an engineer opening it cold, but it is no longer the canonical place for that prose.

## Notion Home

[Transit Notion Home](https://www.notion.so/themlabs/Transit-3663e8630690809891abd71e03b57254?source=copy_link)

Start there for business context, architecture, runtime notes, slices, sessions, and Power BI semantic knowledge.

## Live Dashboard

[View the live Power BI operations dashboard](https://app.powerbi.com/view?r=eyJrIjoiZGYwNTM0NWQtZWQ5Zi00MjdiLTg3NGUtNjQ5ZjBlYzdkMTYxIiwidCI6IjdkM2IyOGRjLWY4MTYtNDk4OC1iOGZkLTczNjJkNDEzMzg5YiJ9)

The dashboard shows live STM network activity: active vehicles, route coverage, trip delay KPIs, and data freshness. It reads from the Gold layer in Postgres. Static schedule data refreshes daily. Realtime vehicle and trip data refresh on a 30-second cadence through the worker.

## What This Project Is

Transit is a portfolio project focused on end-to-end analytics engineering:

- GTFS static schedule ingestion
- GTFS-Realtime capture for TripUpdates and VehiclePositions
- Bronze / Silver / Gold data modeling with lineage
- Near-real-time orchestration and retention management
- Health monitoring for runtime, database, pipeline, refresh, and Bronze storage checks
- Power BI reporting on top of curated Gold-layer data

This is not a SaaS app, not a multi-tenant platform, and not a consumer-facing realtime product.

## Architecture At A Glance

```text
STM GTFS static ZIP   -> Bronze (R2/S3) -> Silver (Postgres) -> Gold dims      -> Power BI
STM GTFS-RT protobuf  -> Bronze (R2/S3) -> Silver (Postgres) -> Gold facts     -> Power BI
                                                                 -> Warm rollups -> Power BI
```

Stack: Python 3.12, Postgres, Cloudflare R2/S3-compatible Bronze storage, Docker Compose, Caddy, GitHub Actions, Power BI.

The Oracle Always Free A1 host is now the production runtime for the database, realtime worker, health service, and GitHub Actions `DATABASE_URL` jobs. The host exposes hardened PostgreSQL paths: TLS/SCRAM app-owner access for automation and TLS/SCRAM `powerbi_reader` access scoped to Gold for Power BI.

Operationally:

- Bronze stores raw artifacts plus lineage
- Silver stores normalized GTFS and GTFS-RT tables
- Gold serves dimensions, snapshots, KPI views, and warm rollups for BI
- the health API reports runtime readiness and freshness signals
- Power BI reads from Gold only

Notion is the source of truth for the deeper architecture breakdown, runtime behavior, and workflow history.

## Current Scope

- STM bus network only in V1
- Daily GTFS static ingestion
- 30-second GTFS-RT cycle
- Durable Bronze archive through Cloudflare R2 today, with an S3-compatible code path
- Silver normalization in Postgres
- Gold serving tables and warm rollups
- Live Power BI dashboard

Provider-ready means the schema and manifests are structured so additional GTFS providers can be added later, but STM is the only active provider today.

## Power BI Artifacts

The repo keeps local `.pbix` working files in `powerbi/`:

- `powerbi/transit-ops-v1.pbix`
- `powerbi/transit-ops-v2.pbix`

The textual dashboard knowledge pack that used to live beside those files has been migrated out of the repo. Field definitions, DAX semantics, validation notes, and portfolio framing now live in the Transit Notion workspace.

## Quick Start

Prerequisites: Python 3.12, [`uv`](https://github.com/astral-sh/uv), a Postgres connection string, Cloudflare R2 or S3-compatible credentials, and an STM API key for realtime capture.

```bash
cp .env.example .env
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

GitHub Actions uses the Oracle app-owner `DATABASE_URL`; the daily static pipeline and warm-rollup workflows are active after manual Oracle-backed proof runs. Power BI uses the dedicated `powerbi_reader` role when repointed to the Oracle host. Exact instance identifiers, public IP, firewall evidence, rebuild reports, workflow run links, and handoff notes live in Notion under roadmap `upgrading` and its child slices.

The public PostgreSQL access helpers live in `infra/postgres-public-access/`. They render the TLS-only `pg_hba.conf` shape, apply the dedicated `powerbi_reader` grants, and verify that Power BI access is TLS-backed, read-only, and scoped to Gold.

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
POWERBI_REPORT_URL="https://app.powerbi.com/view?r=report-id-example" \
DATABASE_URL="$DATABASE_URL" \
bash scripts/validate-oracle-cutover.sh
```

The app database contract is `DATABASE_URL`. Oracle VM Postgres does not use an external database compute API, so the default database-compute adapter is `none`.

The legacy Neon compute adapter remains in `scripts/lib/` only as a decommission target and should not be used for current production operations.

## Repo Navigation

```text
.github/workflows/                  Daily static pipeline + warm rollup build
config/providers/                   Provider manifests
src/transit_ops/
  bronze/                           Feed capture and R2/S3 archiving
  silver/                           GTFS and GTFS-RT normalization
  gold/                             Mart builders, KPI views, warm rollups
  health/                           Operational health API
  db/migrations/                    Alembic migrations
  orchestration/                    Static pipeline, realtime cycle, worker
scripts/                            Pipeline control helpers
powerbi/                            Local `.pbix` working files
Dockerfile                          Realtime worker container
Dockerfile.health                   Health API container
```

For workflow and canonical context, start with this README's Notion Home link and then [AGENTS.md](AGENTS.md) for the tool contract.
