# Transit Ops

A provider-ready GTFS / GTFS-RT analytics pipeline using STM feeds, normalized into Neon Postgres, and surfaced through a live Power BI operations dashboard.

This repo is the codebase and local artifact store for the project. Long-form business context, architecture notes, runtime decisions, workflow state, and Power BI semantic-model knowledge now live in the Transit Notion workspace. The repo should stay useful to an engineer opening it cold, but it is no longer the canonical place for that prose.

## Notion Home

[Transit Notion Home](https://www.notion.so/themlabs/Transit-3663e8630690809891abd71e03b57254?source=copy_link)

This is the human-facing home for the project's canonical context and workflow state. If you are reading the repo fresh, start there for business context, architecture, runtime notes, slices, sessions, and Power BI semantic knowledge.

## Live Dashboard

[View the live Power BI operations dashboard](https://app.powerbi.com/view?r=eyJrIjoiZGYwNTM0NWQtZWQ5Zi00MjdiLTg3NGUtNjQ5ZjBlYzdkMTYxIiwidCI6IjdkM2IyOGRjLWY4MTYtNDk4OC1iOGZkLTczNjJkNDEzMzg5YiJ9)

The dashboard shows live STM network activity: active vehicles, route coverage, trip delay KPIs, and data freshness. It reads from the Gold layer in Neon Postgres. Static schedule data refreshes daily. Realtime vehicle and trip data refresh on a 30-second cadence via the continuously running worker.

## What this project is

Transit is a portfolio project focused on end-to-end analytics engineering:

- GTFS static schedule ingestion
- GTFS-Realtime capture for TripUpdates and VehiclePositions
- Bronze / Silver / Gold data modeling with lineage
- Near-real-time orchestration and retention management
- Power BI reporting on top of curated Gold-layer data

This is not a SaaS app, not a multi-tenant platform, and not a consumer-facing realtime product.

## Architecture at a glance

```text
STM GTFS static ZIP      ->  Bronze (Cloudflare R2)  ->  Silver (Neon)  ->  Gold dims    ->  Power BI
STM GTFS-RT protobuf     ->  Bronze (Cloudflare R2)  ->  Silver (Neon)  ->  Gold facts   ->  Power BI
                                                                          ->  Warm rollups ->  Power BI
```

Stack: Python 3.12, Neon Postgres, Cloudflare R2, Railway, GitHub Actions, Power BI

Operationally:

- Bronze stores raw artifacts plus lineage
- Silver stores normalized GTFS and GTFS-RT tables
- Gold serves dimensions, snapshots, KPI views, and warm rollups for BI
- Power BI reads from Gold only

Notion is the source of truth for the deeper architecture breakdown, runtime behavior, and workflow history.

## Current scope

- STM bus network only in V1
- Daily GTFS static ingestion
- 30-second GTFS-RT cycle
- Bronze archive in Cloudflare R2
- Silver normalization in Postgres
- Gold serving tables and warm rollups
- Live Power BI dashboard

Provider-ready means the schema and manifests are structured so additional GTFS providers can be added later, but STM is the only active provider today.

## Power BI artifacts

The repo keeps local `.pbix` working files in `powerbi/`:

- `powerbi/transit-ops-v1.pbix`
- `powerbi/transit-ops-v2.pbix`

The textual dashboard knowledge pack that used to live beside those files has been migrated out of the repo. Field definitions, DAX semantics, validation notes, and portfolio framing now live in the Transit Notion workspace.

## Quick start

Prerequisites: Python 3.12, [`uv`](https://github.com/astral-sh/uv), a Postgres connection string, Cloudflare R2 credentials, and an STM API key for realtime capture.

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
|----------|-------------|
| `NEON_DATABASE_URL` | All operations |
| `BRONZE_S3_ACCESS_KEY` / `BRONZE_S3_SECRET_KEY` | Bronze R2 storage |
| `STM_API_KEY` | Realtime GTFS-RT capture |

See `.env.example` for the full variable list including Bronze storage options and cadence overrides.

To pause the pipeline:

```bash
export RAILWAY_TOKEN=<token>
bash scripts/pause-pipeline.sh
```

To resume it:

```bash
bash scripts/resume-pipeline.sh
```

## Repo navigation

```text
.github/workflows/                  Daily static pipeline + warm rollup build
config/providers/                   Provider manifests
src/transit_ops/
  bronze/                           Feed capture and R2 archiving
  silver/                           GTFS and GTFS-RT normalization
  gold/                             Mart builders, KPI views, warm rollups
  db/migrations/                    Alembic migrations
  orchestration/                    Static pipeline, realtime cycle, worker
scripts/                            Pipeline control helpers
powerbi/                            Local `.pbix` working files
Dockerfile                          Realtime worker container
```

For workflow and canonical context, start with this README's Notion Home link and then [AGENTS.md](AGENTS.md) for the tool contract.
