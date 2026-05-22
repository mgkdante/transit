# Oracle Cloud Migration Design Spec

**Date:** 2026-04-06
**Status:** Approved
**Scope:** Phase 1 — Migrate transit-ops from Neon PostgreSQL + Railway to self-hosted PostgreSQL on Oracle Cloud Free ARM VM

---

## Problem

Neon PostgreSQL costs ~$150/month because the always-on realtime worker (30-second cadence) keeps compute running 24/7, burning through the 100 CU-hour/month free allowance by day 16. Railway adds ~$5-10/month for the Docker worker. The pipeline's data volume (millions of realtime rows in Silver over a 2-day window, ~7-10 GB steady state) rules out most free database tiers.

## Solution

Self-host everything on a single Oracle Cloud Always Free ARM VM using Docker Compose. Oracle provides 4 ARM OCPUs, 24 GB RAM, and 200 GB disk — genuinely free forever.

## Architecture

```
Oracle Cloud ARM VM (1 OCPU / 6 GB RAM / 200 GB disk)
├── docker-compose.yml
│   ├── postgres       postgres:16, internal network only, volume-mounted data
│   ├── worker         existing transit-ops Dockerfile, 30s cadence
│   ├── health-api     FastAPI, exposes /health JSON endpoint
│   └── caddy          reverse proxy, auto-HTTPS for transit.yesid.dev
├── /var/transit-ops/
│   ├── pg-data/       PostgreSQL data volume
│   └── .env           secrets (R2 creds, STM API key, PG password)
└── DNS: transit.yesid.dev → VM public IP
```

**External services (unchanged):**
- Cloudflare R2 — Bronze object storage
- GitHub Actions — daily static pipeline + warm rollup cron
- Power BI — reads from Gold layer via PostgreSQL connection
- STM API — GTFS-RT feeds

## Container Architecture

### Networks

| Network | Members | External access |
|---------|---------|-----------------|
| `internal` | postgres, worker, health-api, cloudflared | No |
| `web` | health-api, caddy | Yes (ports 80, 443) |

PostgreSQL is never exposed to the internet. Only the health-api bridges both networks.

### Services

**postgres** — `postgres:16` (arm64)
- Volume: `pg-data:/var/lib/postgresql/data`
- Healthcheck: `pg_isready`
- Restart: `unless-stopped`
- Env: `POSTGRES_DB=transit_ops`, `POSTGRES_USER=transit`, `POSTGRES_PASSWORD=${PG_PASSWORD}`

**worker** — existing `Dockerfile` (Python 3.12-slim)
- Depends on: postgres (healthy)
- Env: `DATABASE_URL=postgresql://transit:${PG_PASSWORD}@postgres:5432/transit_ops`, `REALTIME_POLL_SECONDS=30` + R2 creds + STM key
- Restart: `unless-stopped`
- Entrypoint: `python -m transit_ops.cli run-realtime-worker stm`

**health-api** — new `Dockerfile.health` (FastAPI + psutil)
- Depends on: postgres (healthy)
- Port: 8080 (internal only, proxied by Caddy)
- Env: `DATABASE_URL` + `GITHUB_TOKEN` (for GH Actions status checks)
- Restart: `unless-stopped`

**cloudflared** — `cloudflare/cloudflared:latest`
- Joins `internal` network (reaches postgres directly)
- Runs `cloudflared tunnel` with a pre-configured tunnel token
- Exposes `postgres:5432` via Cloudflare Tunnel for Power BI Gateway access
- Restart: `unless-stopped`

**caddy** — `caddy:2`
- Ports: 80, 443 (host-mapped)
- Caddyfile: `transit.yesid.dev { reverse_proxy health-api:8080 }`
- Volume: `caddy-data:/data` (cert storage)

### Power BI Connection

PostgreSQL stays completely unexposed to the internet. Power BI connects through a **Cloudflare Tunnel**:

- A `cloudflared` container in docker-compose joins the `internal` network
- The tunnel exposes `postgres:5432` as a private Cloudflare Tunnel origin (e.g., `transit.yesid.dev/db`)
- Power BI's On-Premises Data Gateway connects through the tunnel with standard PostgreSQL credentials
- No ports opened on the VM, no IP whitelisting needed
- Cloudflare Tunnel is free

## Health API Design

### Endpoint

`GET transit.yesid.dev/health`

### Response

```json
{
  "timestamp": "2026-04-06T12:00:00Z",
  "status": "healthy | degraded | unhealthy",
  "components": {
    "postgresql": {
      "status": "up | down",
      "uptime_seconds": 86400,
      "connection_count": 3,
      "database_size_mb": 4200,
      "schemas": ["core", "raw", "silver", "gold"]
    },
    "realtime_worker": {
      "status": "running | stale | down",
      "last_cycle_utc": "2026-04-06T11:59:30Z",
      "last_cycle_status": "succeeded",
      "cycles_today": 2880,
      "failed_cycles_today": 2
    },
    "vm": {
      "cpu_percent": 12.5,
      "memory_percent": 34.0,
      "disk_percent": 8.2,
      "uptime_hours": 720
    },
    "pipeline_freshness": {
      "latest_vehicle_snapshot_age_seconds": 28,
      "latest_trip_delay_snapshot_age_seconds": 28,
      "freshness_status": "fresh | stale | down"
    },
    "stm_api": {
      "trip_updates_reachable": true,
      "vehicle_positions_reachable": true,
      "last_check_utc": "2026-04-06T11:59:30Z"
    },
    "github_actions": {
      "daily_static_pipeline": "success | failure | unknown",
      "daily_warm_rollups": "success | failure | unknown",
      "last_check_utc": "2026-04-06T06:15:00Z"
    }
  }
}
```

### Component Check Methods

| Component | Method |
|-----------|--------|
| PostgreSQL | `SELECT 1` + `pg_stat_activity` + `pg_database_size()` |
| Realtime worker | Query `gold.latest_vehicle_snapshot` for `max(captured_at)` — if recent, worker is alive |
| VM | Python `psutil` — CPU, memory, disk |
| Pipeline freshness | `NOW() - max(captured_at)` from Gold latest tables |
| STM API | HTTP HEAD to GTFS-RT endpoints |
| GitHub Actions | `gh api` / GitHub REST API for latest workflow run status (cached, checked every 15 min) |

### Aggregate Status Logic

- **healthy** — all components up, freshness < 2 minutes
- **degraded** — one non-critical component down (GH Actions, STM API) or freshness 2-5 minutes
- **unhealthy** — PostgreSQL down, worker down, or freshness > 5 minutes

## Code Changes to transit-ops

### Minimal — connection string only

- Add `DATABASE_URL` as a setting alongside `NEON` + `_DATABASE_URL` (fallback chain: `DATABASE_URL` → `NEON` + `_DATABASE_URL`)
- Update docstrings/comments referencing "Neon" where they should say "PostgreSQL"
- No changes to SQLAlchemy models, migrations, orchestration, or pipeline logic

### New files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Full stack definition |
| `Caddyfile` | Reverse proxy config |
| `Dockerfile.health` | Health API container |
| `src/transit_ops/health/` | FastAPI health check app |
| `infra/setup-vm.sh` | One-time VM bootstrap script |
| `infra/deploy.sh` | Pull + rebuild + restart |
| `infra/teardown.sh` | Graceful stop |

## Maintenance & Operations

### No automated backups

R2 Bronze is the lineage anchor. Silver and Gold are derived and rebuildable by re-running the pipeline. A pg_dump backup would be a slower copy of data that can be regenerated.

### Recovery Playbook

| Scenario | Recovery |
|----------|----------|
| Worker crashes | Auto-restarts via `unless-stopped` restart policy |
| PostgreSQL crashes | Auto-restarts. Data persists in `pg-data` volume |
| Full VM dies | Provision new ARM instance → `setup-vm.sh` → `deploy.sh` → `init-db` → `seed-core` → `run-static-pipeline`. Silver/Gold rebuild from STM feeds within ~1 hour |
| Disk filling up | Retention pruning runs every cycle. Fallback: `docker system prune` |

### Maintenance Scripts

| Script | Purpose | Trigger |
|--------|---------|---------|
| `infra/setup-vm.sh` | Install Docker, docker-compose, configure firewall, create directories | Manual (once) |
| `infra/deploy.sh` | Git pull, rebuild containers, `docker-compose up -d` | Manual or GH Actions |
| `infra/teardown.sh` | Graceful stop: drain worker, stop all containers | Manual |

### GitHub Actions Changes

- Update `NEON` + `_DATABASE_URL` secret → `DATABASE_URL` pointing to Oracle VM's PostgreSQL (public IP + restricted port)
- Same change in both `daily-static-pipeline.yml` and `daily-warm-rollups.yml`

### Pause/Resume Scripts

- Remove Railway-specific commands from `scripts/pause-pipeline.sh` and `scripts/resume-pipeline.sh`
- Replace with `docker-compose stop worker` / `docker-compose start worker` or continue using `PIPELINE_PAUSED` env var

## Phase 2 (Future — after yesid.dev ships)

Build a SvelteKit dashboard page at `transit.yesid.dev/health` that consumes the health JSON endpoint. This is a frontend concern only — the API from Phase 1 provides all the data.

## Cost

| Service | Monthly cost |
|---------|-------------|
| Oracle Cloud ARM VM | $0 (Always Free) |
| Cloudflare R2 | $0 (free tier) |
| GitHub Actions | $0 (public repo) |
| Caddy + Let's Encrypt | $0 |
| DNS (transit.yesid.dev) | $0 (subdomain of existing domain) |
| **Total** | **$0/month** |

## Risks

| Risk | Mitigation |
|------|-----------|
| Oracle ARM capacity ("out of host capacity") | Use OCI CLI retry script, try less popular regions (Osaka, Sao Paulo, Johannesburg) |
| Oracle reclaims idle instances (CPU < 20% p95 over 7 days) | 30-second worker keeps CPU active. Monitor with health API. |
| Oracle changes Always Free policy | Low probability. If it happens, migrate to Xata (15 GB free PG) + another compute provider |
| Self-managed PG data loss | Acceptable — R2 Bronze is the source of truth, pipeline rebuilds everything |
| Power BI connection to VM | Cloudflare Tunnel — PG never exposed publicly, tunnel is free |
