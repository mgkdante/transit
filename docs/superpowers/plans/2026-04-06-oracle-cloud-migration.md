# Oracle Cloud Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate transit-ops from Neon PostgreSQL + Railway ($150+/month) to a self-hosted PostgreSQL on Oracle Cloud Free ARM VM ($0/month) with a health monitoring API.

**Architecture:** Five Docker Compose services on one Oracle ARM VM: postgres (data), worker (existing pipeline), health-api (FastAPI monitoring), cloudflared (Cloudflare Tunnel for Power BI), and caddy (reverse proxy + auto-HTTPS). PostgreSQL is never exposed to the internet.

**Tech Stack:** Python 3.12, FastAPI, psutil, httpx, Docker Compose, Caddy 2, Cloudflare Tunnel, PostgreSQL 16

**Spec:** `docs/superpowers/specs/2026-04-06-oracle-cloud-migration-design.md`

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `docker-compose.yml` | Full stack: postgres, worker, health-api, cloudflared, caddy |
| `Caddyfile` | Reverse proxy routing for `transit.yesid.dev` |
| `Dockerfile.health` | Health API container image |
| `src/transit_ops/health/__init__.py` | Package init |
| `src/transit_ops/health/app.py` | FastAPI app with `/health` endpoint |
| `src/transit_ops/health/checks.py` | Individual component check functions |
| `infra/setup-vm.sh` | One-time Oracle VM bootstrap |
| `infra/deploy.sh` | Pull, rebuild, restart containers |
| `infra/teardown.sh` | Graceful shutdown |

### Modified files

| File | Change |
|------|--------|
| `src/transit_ops/settings.py` | Add `DATABASE_URL` with fallback to `NEON_DATABASE_URL` |
| `src/transit_ops/db/connection.py` | Update docstring, use generic property name |
| `src/transit_ops/cli.py` | Update Neon references in help text |
| `.env.example` | Add `DATABASE_URL`, update comments |
| `pyproject.toml` | Add `health` dependency group (fastapi, uvicorn, psutil, httpx) |
| `scripts/pause-pipeline.sh` | Replace Railway/Neon with docker-compose commands |
| `scripts/resume-pipeline.sh` | Replace Railway/Neon with docker-compose commands |
| `.github/workflows/daily-static-pipeline.yml` | `NEON_DATABASE_URL` → `DATABASE_URL` |
| `.github/workflows/daily-warm-rollups.yml` | `NEON_DATABASE_URL` → `DATABASE_URL` |

---

## Task 1: Settings — Add DATABASE_URL Fallback

**Files:**
- Modify: `src/transit_ops/settings.py`
- Test: `tests/test_settings.py`

- [ ] **Step 1: Write failing test for DATABASE_URL fallback**

Create `tests/test_settings.py`:

```python
import os

from transit_ops.settings import Settings


def test_database_url_prefers_database_url_over_neon():
    settings = Settings(
        DATABASE_URL="postgresql://transit:pw@localhost:5432/transit_ops",
        NEON_DATABASE_URL="postgresql://neon:pw@neon.host:5432/neondb",
    )
    assert "localhost" in settings.effective_database_url
    assert "neon.host" not in settings.effective_database_url


def test_database_url_falls_back_to_neon():
    settings = Settings(
        DATABASE_URL=None,
        NEON_DATABASE_URL="postgresql://neon:pw@neon.host:5432/neondb",
    )
    assert "neon.host" in settings.effective_database_url


def test_database_url_none_when_neither_set():
    settings = Settings(DATABASE_URL=None, NEON_DATABASE_URL=None)
    assert settings.effective_database_url is None


def test_sqlalchemy_database_url_uses_effective():
    settings = Settings(
        DATABASE_URL="postgresql://transit:pw@localhost:5432/transit_ops",
        NEON_DATABASE_URL=None,
    )
    assert settings.sqlalchemy_database_url is not None
    assert "postgresql+psycopg" in settings.sqlalchemy_database_url
    assert "localhost" in settings.sqlalchemy_database_url
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_settings.py -v`
Expected: FAIL — `Settings` has no `DATABASE_URL` field or `effective_database_url` property

- [ ] **Step 3: Add DATABASE_URL field and effective_database_url property**

In `src/transit_ops/settings.py`, add the new field after `NEON_DATABASE_URL`:

```python
DATABASE_URL: str | None = None
NEON_DATABASE_URL: str | None = None
```

Add the property after `NEON_DATABASE_URL`:

```python
@property
def effective_database_url(self) -> str | None:
    """Return DATABASE_URL if set, otherwise fall back to NEON_DATABASE_URL."""
    return self.DATABASE_URL or self.NEON_DATABASE_URL
```

Update `sqlalchemy_database_url` to use `effective_database_url` instead of `NEON_DATABASE_URL`:

```python
@property
def sqlalchemy_database_url(self) -> str | None:
    """Return a SQLAlchemy-compatible URL for psycopg."""
    raw_url = self.effective_database_url
    if not raw_url:
        return None

    parts = urlsplit(raw_url)
    if parts.scheme in {"postgresql", "postgres"}:
        return urlunsplit(
            ("postgresql+psycopg", parts.netloc, parts.path, parts.query, parts.fragment)
        )
    return raw_url
```

Update `redacted_database_url` to use `effective_database_url`:

```python
@property
def redacted_database_url(self) -> str | None:
    """Mask the credential portion of the configured database URL."""
    raw_url = self.effective_database_url
    if not raw_url:
        return None

    parts = urlsplit(raw_url)
    host = parts.hostname or ""
    port = f":{parts.port}" if parts.port else ""
    masked_netloc = host + port
    return urlunsplit((parts.scheme, masked_netloc, parts.path, parts.query, parts.fragment))
```

Update `display_dict` to show both fields:

```python
def display_dict(self) -> dict[str, str | None]:
    return {
        "APP_ENV": self.APP_ENV,
        "LOG_LEVEL": self.LOG_LEVEL,
        "DATABASE_URL": self.redacted_database_url,
        "NEON_DATABASE_URL": "(fallback)" if self.NEON_DATABASE_URL and not self.DATABASE_URL else None,
        ...
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_settings.py -v`
Expected: All 4 tests PASS

- [ ] **Step 5: Commit**

```bash
git add tests/test_settings.py src/transit_ops/settings.py
git commit -m "feat: add DATABASE_URL with fallback to NEON_DATABASE_URL"
```

---

## Task 2: Update Connection Layer and CLI References

**Files:**
- Modify: `src/transit_ops/db/connection.py`
- Modify: `src/transit_ops/cli.py`

- [ ] **Step 1: Update connection.py error message and docstring**

In `src/transit_ops/db/connection.py`, change:

```python
def require_database_url(settings: Settings) -> str:
    """Return a SQLAlchemy-compatible database URL or raise a clear error."""

    if not settings.sqlalchemy_database_url:
        raise ValueError("DATABASE_URL (or NEON_DATABASE_URL) is required for database commands.")
    return settings.sqlalchemy_database_url


def make_engine(settings: Settings) -> Engine:
    """Create a SQLAlchemy engine for PostgreSQL."""

    return create_engine(
        require_database_url(settings),
        pool_pre_ping=True,
    )


def test_connection(settings: Settings) -> None:
    """Run a minimal connectivity check against the configured database."""

    engine = make_engine(settings)
    with engine.connect() as connection:
        connection.execute(text("SELECT 1"))
```

- [ ] **Step 2: Update cli.py references**

In `src/transit_ops/cli.py`, update line 54:

```python
raise typer.BadParameter("DATABASE_URL (or NEON_DATABASE_URL) is required for init-db.")
```

Update the `db_test` docstring at line 177:

```python
@app.command("db-test")
def db_test() -> None:
    """Run a simple connectivity test against PostgreSQL."""
```

- [ ] **Step 3: Run existing tests to verify nothing broke**

Run: `uv run pytest tests/ -v --timeout=30`
Expected: All existing tests still pass

- [ ] **Step 4: Commit**

```bash
git add src/transit_ops/db/connection.py src/transit_ops/cli.py
git commit -m "refactor: generalize Neon references to PostgreSQL"
```

---

## Task 3: Health API — Check Functions

**Files:**
- Create: `src/transit_ops/health/__init__.py`
- Create: `src/transit_ops/health/checks.py`
- Test: `tests/test_health_checks.py`

- [ ] **Step 1: Create health package init**

Create `src/transit_ops/health/__init__.py`:

```python
```

(Empty file — package marker only.)

- [ ] **Step 2: Write failing tests for health check functions**

Create `tests/test_health_checks.py`:

```python
from datetime import UTC, datetime, timedelta
from unittest.mock import MagicMock, patch

from transit_ops.health.checks import (
    check_pipeline_freshness,
    check_vm,
    compute_aggregate_status,
)


def test_check_vm_returns_metrics():
    result = check_vm()
    assert "cpu_percent" in result
    assert "memory_percent" in result
    assert "disk_percent" in result
    assert "uptime_hours" in result
    assert isinstance(result["cpu_percent"], float)
    assert isinstance(result["memory_percent"], float)
    assert isinstance(result["disk_percent"], float)


def test_aggregate_status_healthy():
    components = {
        "postgresql": {"status": "up"},
        "realtime_worker": {"status": "running"},
        "vm": {"cpu_percent": 10.0},
        "pipeline_freshness": {"freshness_status": "fresh"},
        "stm_api": {"trip_updates_reachable": True, "vehicle_positions_reachable": True},
        "github_actions": {"daily_static_pipeline": "success", "daily_warm_rollups": "success"},
    }
    assert compute_aggregate_status(components) == "healthy"


def test_aggregate_status_degraded_when_stm_down():
    components = {
        "postgresql": {"status": "up"},
        "realtime_worker": {"status": "running"},
        "vm": {"cpu_percent": 10.0},
        "pipeline_freshness": {"freshness_status": "stale"},
        "stm_api": {"trip_updates_reachable": False, "vehicle_positions_reachable": True},
        "github_actions": {"daily_static_pipeline": "success", "daily_warm_rollups": "success"},
    }
    assert compute_aggregate_status(components) == "degraded"


def test_aggregate_status_unhealthy_when_pg_down():
    components = {
        "postgresql": {"status": "down"},
        "realtime_worker": {"status": "running"},
        "vm": {"cpu_percent": 10.0},
        "pipeline_freshness": {"freshness_status": "fresh"},
        "stm_api": {"trip_updates_reachable": True, "vehicle_positions_reachable": True},
        "github_actions": {"daily_static_pipeline": "success", "daily_warm_rollups": "success"},
    }
    assert compute_aggregate_status(components) == "unhealthy"


def test_aggregate_status_unhealthy_when_worker_down():
    components = {
        "postgresql": {"status": "up"},
        "realtime_worker": {"status": "down"},
        "vm": {"cpu_percent": 10.0},
        "pipeline_freshness": {"freshness_status": "down"},
        "stm_api": {"trip_updates_reachable": True, "vehicle_positions_reachable": True},
        "github_actions": {"daily_static_pipeline": "success", "daily_warm_rollups": "success"},
    }
    assert compute_aggregate_status(components) == "unhealthy"
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `uv run pytest tests/test_health_checks.py -v`
Expected: FAIL — module `transit_ops.health.checks` does not exist

- [ ] **Step 4: Implement check functions**

Create `src/transit_ops/health/checks.py`:

```python
from __future__ import annotations

import logging
import time
from datetime import UTC, datetime

import psutil
from sqlalchemy import text
from sqlalchemy.engine import Engine

logger = logging.getLogger(__name__)


def check_postgresql(engine: Engine) -> dict:
    """Check PostgreSQL connectivity, connections, and database size."""
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
            row = conn.execute(
                text(
                    "SELECT count(*) AS conn_count FROM pg_stat_activity "
                    "WHERE datname = current_database()"
                )
            ).mappings().one()
            connection_count = row["conn_count"]

            row = conn.execute(
                text("SELECT pg_database_size(current_database()) AS db_size")
            ).mappings().one()
            database_size_mb = round(row["db_size"] / (1024 * 1024), 1)

            rows = conn.execute(
                text("SELECT schema_name FROM information_schema.schemata WHERE schema_name IN ('core', 'raw', 'silver', 'gold') ORDER BY schema_name")
            ).all()
            schemas = [r[0] for r in rows]

            row = conn.execute(text("SELECT extract(epoch FROM current_timestamp - pg_postmaster_start_time()) AS uptime")).mappings().one()
            uptime_seconds = round(row["uptime"])

        return {
            "status": "up",
            "uptime_seconds": uptime_seconds,
            "connection_count": connection_count,
            "database_size_mb": database_size_mb,
            "schemas": schemas,
        }
    except Exception as exc:
        logger.warning("PostgreSQL health check failed: %s", exc)
        return {"status": "down", "error": str(exc)}


def check_realtime_worker(engine: Engine) -> dict:
    """Check worker status by querying Gold snapshot freshness."""
    try:
        with engine.connect() as conn:
            row = conn.execute(
                text(
                    "SELECT max(captured_at_utc) AS last_captured "
                    "FROM gold.latest_vehicle_snapshot"
                )
            ).mappings().one()
            last_captured = row["last_captured"]

            if last_captured is None:
                return {"status": "down", "last_cycle_utc": None, "last_cycle_status": "unknown", "cycles_today": 0, "failed_cycles_today": 0}

            age_seconds = (datetime.now(UTC) - last_captured).total_seconds()
            if age_seconds < 120:
                status = "running"
            elif age_seconds < 300:
                status = "stale"
            else:
                status = "down"

            return {
                "status": status,
                "last_cycle_utc": last_captured.isoformat(),
                "last_cycle_status": "succeeded" if age_seconds < 120 else "stale",
                "cycles_today": 0,
                "failed_cycles_today": 0,
            }
    except Exception as exc:
        logger.warning("Worker health check failed: %s", exc)
        return {"status": "down", "error": str(exc)}


def check_vm() -> dict:
    """Check VM resource usage via psutil."""
    boot_time = psutil.boot_time()
    uptime_hours = round((time.time() - boot_time) / 3600, 1)

    return {
        "cpu_percent": psutil.cpu_percent(interval=0.1),
        "memory_percent": round(psutil.virtual_memory().percent, 1),
        "disk_percent": round(psutil.disk_usage("/").percent, 1),
        "uptime_hours": uptime_hours,
    }


def check_pipeline_freshness(engine: Engine) -> dict:
    """Check age of latest Gold snapshots."""
    try:
        with engine.connect() as conn:
            vehicle_row = conn.execute(
                text("SELECT max(captured_at_utc) AS ts FROM gold.latest_vehicle_snapshot")
            ).mappings().one()
            trip_row = conn.execute(
                text("SELECT max(captured_at_utc) AS ts FROM gold.latest_trip_delay_snapshot")
            ).mappings().one()

        now = datetime.now(UTC)
        vehicle_age = None
        trip_age = None

        if vehicle_row["ts"]:
            vehicle_age = round((now - vehicle_row["ts"]).total_seconds())
        if trip_row["ts"]:
            trip_age = round((now - trip_row["ts"]).total_seconds())

        max_age = max(a for a in [vehicle_age, trip_age] if a is not None) if any(a is not None for a in [vehicle_age, trip_age]) else None

        if max_age is None:
            freshness_status = "down"
        elif max_age < 120:
            freshness_status = "fresh"
        elif max_age < 300:
            freshness_status = "stale"
        else:
            freshness_status = "down"

        return {
            "latest_vehicle_snapshot_age_seconds": vehicle_age,
            "latest_trip_delay_snapshot_age_seconds": trip_age,
            "freshness_status": freshness_status,
        }
    except Exception as exc:
        logger.warning("Pipeline freshness check failed: %s", exc)
        return {"freshness_status": "down", "error": str(exc)}


async def check_stm_api(settings) -> dict:
    """Check STM GTFS-RT endpoint reachability."""
    import httpx

    results = {}
    endpoints = {
        "trip_updates_reachable": settings.STM_RT_TRIP_UPDATES_URL,
        "vehicle_positions_reachable": settings.STM_RT_VEHICLE_POSITIONS_URL,
    }
    async with httpx.AsyncClient(timeout=10.0) as client:
        for key, url in endpoints.items():
            if not url:
                results[key] = False
                continue
            try:
                headers = {}
                if settings.STM_API_KEY:
                    headers["apiKey"] = settings.STM_API_KEY
                resp = await client.head(url, headers=headers)
                results[key] = resp.status_code < 400
            except Exception:
                results[key] = False

    results["last_check_utc"] = datetime.now(UTC).isoformat()
    return results


async def check_github_actions(github_token: str | None, repo: str = "mgkdante/transit") -> dict:
    """Check latest GitHub Actions workflow run status."""
    import httpx

    if not github_token:
        return {
            "daily_static_pipeline": "unknown",
            "daily_warm_rollups": "unknown",
            "last_check_utc": datetime.now(UTC).isoformat(),
        }

    results = {}
    workflows = {
        "daily_static_pipeline": "Daily Static Pipeline",
        "daily_warm_rollups": "Daily Warm Rollups",
    }
    headers = {"Authorization": f"Bearer {github_token}", "Accept": "application/vnd.github+json"}

    async with httpx.AsyncClient(timeout=10.0) as client:
        for key, name in workflows.items():
            try:
                resp = await client.get(
                    f"https://api.github.com/repos/{repo}/actions/workflows",
                    headers=headers,
                )
                resp.raise_for_status()
                workflow_id = None
                for wf in resp.json().get("workflows", []):
                    if wf["name"] == name:
                        workflow_id = wf["id"]
                        break

                if not workflow_id:
                    results[key] = "unknown"
                    continue

                runs_resp = await client.get(
                    f"https://api.github.com/repos/{repo}/actions/workflows/{workflow_id}/runs",
                    headers=headers,
                    params={"per_page": 1},
                )
                runs_resp.raise_for_status()
                runs = runs_resp.json().get("workflow_runs", [])
                if runs:
                    results[key] = runs[0].get("conclusion", "unknown") or "in_progress"
                else:
                    results[key] = "unknown"
            except Exception:
                results[key] = "unknown"

    results["last_check_utc"] = datetime.now(UTC).isoformat()
    return results


def compute_aggregate_status(components: dict) -> str:
    """Compute overall health status from component results."""
    pg_status = components.get("postgresql", {}).get("status")
    worker_status = components.get("realtime_worker", {}).get("status")
    freshness_status = components.get("pipeline_freshness", {}).get("freshness_status")

    if pg_status == "down" or worker_status == "down" or freshness_status == "down":
        return "unhealthy"

    stm_trip = components.get("stm_api", {}).get("trip_updates_reachable", True)
    stm_vehicle = components.get("stm_api", {}).get("vehicle_positions_reachable", True)
    gh_static = components.get("github_actions", {}).get("daily_static_pipeline", "success")
    gh_rollups = components.get("github_actions", {}).get("daily_warm_rollups", "success")

    if (
        worker_status == "stale"
        or freshness_status == "stale"
        or not stm_trip
        or not stm_vehicle
        or gh_static not in ("success", "unknown")
        or gh_rollups not in ("success", "unknown")
    ):
        return "degraded"

    return "healthy"
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_health_checks.py -v`
Expected: All 5 tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/transit_ops/health/__init__.py src/transit_ops/health/checks.py tests/test_health_checks.py
git commit -m "feat: add health check functions for all pipeline components"
```

---

## Task 4: Health API — FastAPI App

**Files:**
- Create: `src/transit_ops/health/app.py`
- Modify: `pyproject.toml`

- [ ] **Step 1: Add health dependency group to pyproject.toml**

In `pyproject.toml`, add after the `[dependency-groups]` dev entry:

```toml
[dependency-groups]
dev = [
  "pytest>=8.3,<9.0",
  "ruff>=0.11,<0.12",
]
health = [
  "fastapi>=0.115,<1.0",
  "uvicorn>=0.34,<1.0",
  "psutil>=6.0,<7.0",
  "httpx>=0.28,<1.0",
]
```

- [ ] **Step 2: Install health deps**

Run: `uv sync --group health`
Expected: Installs fastapi, uvicorn, psutil, httpx

- [ ] **Step 3: Create the FastAPI app**

Create `src/transit_ops/health/app.py`:

```python
from __future__ import annotations

import asyncio
import logging
import os
import time
from datetime import UTC, datetime

from fastapi import FastAPI
from fastapi.responses import JSONResponse

from transit_ops.db.connection import make_engine
from transit_ops.health.checks import (
    check_github_actions,
    check_pipeline_freshness,
    check_postgresql,
    check_realtime_worker,
    check_stm_api,
    check_vm,
    compute_aggregate_status,
)
from transit_ops.settings import get_settings

logger = logging.getLogger(__name__)

app = FastAPI(title="Transit Ops Health API", docs_url=None, redoc_url=None)

_gh_cache: dict | None = None
_gh_cache_time: float = 0.0
GH_CACHE_TTL_SECONDS = 900  # 15 minutes


@app.get("/health")
async def health():
    settings = get_settings()
    engine = make_engine(settings)

    pg = check_postgresql(engine)
    worker = check_realtime_worker(engine)
    vm = check_vm()
    freshness = check_pipeline_freshness(engine)

    stm = await check_stm_api(settings)

    global _gh_cache, _gh_cache_time
    if _gh_cache is None or (time.time() - _gh_cache_time) > GH_CACHE_TTL_SECONDS:
        github_token = os.environ.get("GITHUB_TOKEN")
        _gh_cache = await check_github_actions(github_token)
        _gh_cache_time = time.time()

    components = {
        "postgresql": pg,
        "realtime_worker": worker,
        "vm": vm,
        "pipeline_freshness": freshness,
        "stm_api": stm,
        "github_actions": _gh_cache,
    }

    status = compute_aggregate_status(components)
    status_code = 200 if status == "healthy" else 503 if status == "unhealthy" else 200

    return JSONResponse(
        content={
            "timestamp": datetime.now(UTC).isoformat(),
            "status": status,
            "components": components,
        },
        status_code=status_code,
    )


@app.get("/")
async def root():
    return {"service": "transit-ops-health", "endpoint": "/health"}
```

- [ ] **Step 4: Test locally**

Run: `uv run uvicorn transit_ops.health.app:app --host 0.0.0.0 --port 8080`
Then: `curl http://localhost:8080/health` (will fail on PG but should return JSON with error)

- [ ] **Step 5: Commit**

```bash
git add src/transit_ops/health/app.py pyproject.toml uv.lock
git commit -m "feat: add FastAPI health API app with /health endpoint"
```

---

## Task 5: Dockerfile.health

**Files:**
- Create: `Dockerfile.health`

- [ ] **Step 1: Create Dockerfile.health**

```dockerfile
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    UV_LINK_MODE=copy \
    PATH="/app/.venv/bin:$PATH"

WORKDIR /app

RUN pip install --no-cache-dir uv

COPY pyproject.toml uv.lock alembic.ini ./
COPY config ./config
COPY src ./src

RUN uv sync --locked --no-dev --group health \
    && adduser --disabled-password --gecos "" --home /app appuser \
    && chown -R appuser:appuser /app

USER appuser

EXPOSE 8080

CMD ["uvicorn", "transit_ops.health.app:app", "--host", "0.0.0.0", "--port", "8080"]
```

- [ ] **Step 2: Test Docker build**

Run: `docker build -f Dockerfile.health -t transit-ops-health .`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add Dockerfile.health
git commit -m "feat: add Dockerfile for health API container"
```

---

## Task 6: Docker Compose + Caddyfile

**Files:**
- Create: `docker-compose.yml`
- Create: `Caddyfile`

- [ ] **Step 1: Create Caddyfile**

```
transit.yesid.dev {
    reverse_proxy health-api:8080
}
```

- [ ] **Step 2: Create docker-compose.yml**

```yaml
services:
  postgres:
    image: postgres:16
    restart: unless-stopped
    volumes:
      - pg-data:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: transit_ops
      POSTGRES_USER: transit
      POSTGRES_PASSWORD: ${PG_PASSWORD}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U transit -d transit_ops"]
      interval: 10s
      timeout: 5s
      retries: 5
    networks:
      - internal

  worker:
    build: .
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://transit:${PG_PASSWORD}@postgres:5432/transit_ops
      REALTIME_POLL_SECONDS: "30"
      REALTIME_STARTUP_DELAY_SECONDS: "10"
      APP_ENV: production
      LOG_LEVEL: INFO
      PROVIDER_TIMEZONE: America/Toronto
      STM_PROVIDER_ID: stm
      STM_API_KEY: ${STM_API_KEY}
      BRONZE_STORAGE_BACKEND: s3
      BRONZE_S3_ENDPOINT: ${BRONZE_S3_ENDPOINT}
      BRONZE_S3_BUCKET: ${BRONZE_S3_BUCKET}
      BRONZE_S3_ACCESS_KEY: ${BRONZE_S3_ACCESS_KEY}
      BRONZE_S3_SECRET_KEY: ${BRONZE_S3_SECRET_KEY}
      BRONZE_S3_REGION: auto
    networks:
      - internal

  health-api:
    build:
      context: .
      dockerfile: Dockerfile.health
    restart: unless-stopped
    depends_on:
      postgres:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://transit:${PG_PASSWORD}@postgres:5432/transit_ops
      GITHUB_TOKEN: ${GITHUB_TOKEN:-}
      STM_API_KEY: ${STM_API_KEY:-}
      STM_RT_TRIP_UPDATES_URL: ${STM_RT_TRIP_UPDATES_URL:-}
      STM_RT_VEHICLE_POSITIONS_URL: ${STM_RT_VEHICLE_POSITIONS_URL:-}
    networks:
      - internal
      - web

  cloudflared:
    image: cloudflare/cloudflared:latest
    restart: unless-stopped
    command: tunnel run
    environment:
      TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}
    networks:
      - internal

  caddy:
    image: caddy:2
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy-data:/data
      - caddy-config:/config
    depends_on:
      - health-api
    networks:
      - web

networks:
  internal:
    driver: bridge
  web:
    driver: bridge

volumes:
  pg-data:
  caddy-data:
  caddy-config:
```

- [ ] **Step 3: Validate compose file syntax**

Run: `docker compose config --quiet`
Expected: No errors (may warn about missing env vars — that's fine)

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml Caddyfile
git commit -m "feat: add docker-compose stack with postgres, worker, health-api, cloudflared, caddy"
```

---

## Task 7: Update .env.example

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: Update .env.example**

Replace the full file content:

```bash
# Runtime environment for the local CLI.
APP_ENV=local

# Standard Python logging level.
LOG_LEVEL=INFO

# PostgreSQL connection string.
# For local docker-compose: postgresql://transit:<PG_PASSWORD>@localhost:5432/transit_ops
# For Oracle VM: set via docker-compose.yml environment block.
# Legacy: NEON_DATABASE_URL is still supported as a fallback.
DATABASE_URL=
NEON_DATABASE_URL=

# Default provider timezone for STM and local reporting assumptions.
PROVIDER_TIMEZONE=America/Toronto

# STM provider identifier used across core tables.
STM_PROVIDER_ID=stm

# STM API key is required for live STM GTFS-RT capture.
STM_API_KEY=

# Optional overrides for provider-manifest feed URLs.
STM_STATIC_GTFS_URL=
STM_RT_TRIP_UPDATES_URL=
STM_RT_VEHICLE_POSITIONS_URL=

# Durable Bronze storage uses Cloudflare R2 via the S3-compatible backend.
BRONZE_STORAGE_BACKEND=s3
BRONZE_LOCAL_ROOT=./data/bronze
BRONZE_S3_ENDPOINT=https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com
BRONZE_S3_BUCKET=transit-raw
BRONZE_S3_ACCESS_KEY=
BRONZE_S3_SECRET_KEY=
BRONZE_S3_REGION=auto

# Realtime worker cadence. Default 300s (5 min) for local dev.
# Production docker-compose overrides to 30s.
REALTIME_POLL_SECONDS=300
REALTIME_STARTUP_DELAY_SECONDS=0

# Silver retention controls.
STATIC_DATASET_RETENTION_COUNT=1
SILVER_REALTIME_RETENTION_DAYS=2

# --- Docker Compose / Oracle VM ---
# PostgreSQL password for the docker-compose postgres service.
PG_PASSWORD=

# Cloudflare Tunnel token for Power BI database access.
CLOUDFLARE_TUNNEL_TOKEN=

# GitHub personal access token for health API (GH Actions status checks).
GITHUB_TOKEN=
```

- [ ] **Step 2: Commit**

```bash
git add .env.example
git commit -m "docs: update .env.example for Oracle VM docker-compose stack"
```

---

## Task 8: Update Pause/Resume Scripts

**Files:**
- Modify: `scripts/pause-pipeline.sh`
- Modify: `scripts/resume-pipeline.sh`

- [ ] **Step 1: Rewrite pause-pipeline.sh**

```bash
#!/usr/bin/env bash
# pause-pipeline.sh
# Stops all automated pipeline activity:
#   - Disables daily GH Actions workflows
#   - Stops the realtime worker container (docker-compose)
#
# Usage:
#   bash scripts/pause-pipeline.sh

set -euo pipefail

REPO="mgkdante/transit"
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Pausing pipeline..."

# --- 1. GitHub Actions ---
echo ""
echo "[1/2] Disabling GitHub Actions workflows..."
gh workflow disable "Daily Static Pipeline" --repo "$REPO" 2>&1 && \
  echo "      Daily Static Pipeline: disabled" || \
  echo "      Daily Static Pipeline: already disabled or error (skipping)"

gh workflow disable "Daily Warm Rollups" --repo "$REPO" 2>&1 && \
  echo "      Daily Warm Rollups: disabled" || \
  echo "      Daily Warm Rollups: already disabled or error (skipping)"

# --- 2. Docker Compose worker ---
echo ""
echo "[2/2] Stopping realtime worker container..."
if command -v docker &>/dev/null; then
  docker compose -f "$COMPOSE_DIR/docker-compose.yml" stop worker 2>&1 && \
    echo "      Worker container: stopped" || \
    echo "      WARNING: docker compose stop failed — stop manually with: docker compose stop worker"
else
  echo "      WARNING: docker not found — stop the worker manually on the VM"
fi

echo ""
echo "Done. Pipeline is paused."
echo "  - GH Actions: disabled (no daily static or warm rollup runs)"
echo "  - Worker: stopped (no realtime cycles)"
echo ""
echo "To resume: bash scripts/resume-pipeline.sh"
```

- [ ] **Step 2: Rewrite resume-pipeline.sh**

```bash
#!/usr/bin/env bash
# resume-pipeline.sh
# Restores all automated pipeline activity:
#   - Re-enables daily GH Actions workflows
#   - Starts the realtime worker container (docker-compose)
#
# Usage:
#   bash scripts/resume-pipeline.sh

set -euo pipefail

REPO="mgkdante/transit"
COMPOSE_DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Resuming pipeline..."

# --- 1. GitHub Actions ---
echo ""
echo "[1/2] Enabling GitHub Actions workflows..."
gh workflow enable "Daily Static Pipeline" --repo "$REPO" 2>&1 && \
  echo "      Daily Static Pipeline: enabled" || \
  echo "      Daily Static Pipeline: already enabled or error (skipping)"

gh workflow enable "Daily Warm Rollups" --repo "$REPO" 2>&1 && \
  echo "      Daily Warm Rollups: enabled" || \
  echo "      Daily Warm Rollups: already enabled or error (skipping)"

# --- 2. Docker Compose worker ---
echo ""
echo "[2/2] Starting realtime worker container..."
if command -v docker &>/dev/null; then
  docker compose -f "$COMPOSE_DIR/docker-compose.yml" start worker 2>&1 && \
    echo "      Worker container: started" || \
    echo "      WARNING: docker compose start failed — start manually with: docker compose start worker"
else
  echo "      WARNING: docker not found — start the worker manually on the VM"
fi

echo ""
echo "Done. Pipeline is resumed."
echo "  - GH Actions: enabled (daily static at 06:00 UTC, warm rollups at 07:00 UTC)"
echo "  - Worker: started (cycles every 30s)"
echo ""
echo "To pause again: bash scripts/pause-pipeline.sh"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/pause-pipeline.sh scripts/resume-pipeline.sh
git commit -m "refactor: update pause/resume scripts for docker-compose (remove Railway/Neon)"
```

---

## Task 9: Update GitHub Actions Workflows

**Files:**
- Modify: `.github/workflows/daily-static-pipeline.yml`
- Modify: `.github/workflows/daily-warm-rollups.yml`

- [ ] **Step 1: Update daily-static-pipeline.yml**

Change the env block in the job from:

```yaml
NEON_DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}
```

to:

```yaml
DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [ ] **Step 2: Update daily-warm-rollups.yml**

Same change — replace:

```yaml
NEON_DATABASE_URL: ${{ secrets.NEON_DATABASE_URL }}
```

with:

```yaml
DATABASE_URL: ${{ secrets.DATABASE_URL }}
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/daily-static-pipeline.yml .github/workflows/daily-warm-rollups.yml
git commit -m "chore: update GH Actions workflows to use DATABASE_URL secret"
```

---

## Task 10: Infrastructure Scripts

**Files:**
- Create: `infra/setup-vm.sh`
- Create: `infra/deploy.sh`
- Create: `infra/teardown.sh`

- [ ] **Step 1: Create infra/setup-vm.sh**

```bash
#!/usr/bin/env bash
# setup-vm.sh
# One-time bootstrap for Oracle Cloud ARM VM.
# Run as root or with sudo on a fresh Ubuntu 22.04+ ARM instance.
#
# Usage:
#   sudo bash infra/setup-vm.sh

set -euo pipefail

echo "==> Oracle VM bootstrap starting..."

# --- 1. System updates ---
echo "[1/5] Updating system packages..."
apt-get update -qq && apt-get upgrade -y -qq

# --- 2. Install Docker ---
echo "[2/5] Installing Docker..."
if ! command -v docker &>/dev/null; then
  curl -fsSL https://get.docker.com | sh
  systemctl enable docker
  systemctl start docker
  echo "      Docker installed."
else
  echo "      Docker already installed."
fi

# --- 3. Add deploy user ---
echo "[3/5] Setting up deploy user..."
if ! id -u transit &>/dev/null 2>&1; then
  useradd -m -s /bin/bash transit
  usermod -aG docker transit
  echo "      User 'transit' created and added to docker group."
else
  usermod -aG docker transit
  echo "      User 'transit' already exists, ensured docker group."
fi

# --- 4. Create project directory ---
echo "[4/5] Creating project directory..."
PROJECT_DIR="/opt/transit-ops"
mkdir -p "$PROJECT_DIR"
chown transit:transit "$PROJECT_DIR"
echo "      $PROJECT_DIR created."

# --- 5. Firewall (iptables — Oracle Linux/Ubuntu) ---
echo "[5/5] Configuring firewall rules..."
# Allow HTTP and HTTPS for Caddy
iptables -I INPUT -p tcp --dport 80 -j ACCEPT 2>/dev/null || true
iptables -I INPUT -p tcp --dport 443 -j ACCEPT 2>/dev/null || true
# Save rules if iptables-persistent is available
if command -v netfilter-persistent &>/dev/null; then
  netfilter-persistent save
fi
echo "      Ports 80 and 443 opened."

echo ""
echo "==> Bootstrap complete."
echo ""
echo "Next steps:"
echo "  1. Switch to transit user:  sudo su - transit"
echo "  2. Clone the repo:          git clone https://github.com/mgkdante/transit.git $PROJECT_DIR"
echo "  3. Create .env file:        cp $PROJECT_DIR/.env.example $PROJECT_DIR/.env && nano $PROJECT_DIR/.env"
echo "  4. Deploy:                  bash $PROJECT_DIR/infra/deploy.sh"
echo ""
echo "Also configure Oracle Cloud Security Lists to allow inbound TCP 80 and 443."
```

- [ ] **Step 2: Create infra/deploy.sh**

```bash
#!/usr/bin/env bash
# deploy.sh
# Pull latest code, rebuild containers, and restart the stack.
#
# Usage:
#   bash infra/deploy.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Deploying transit-ops..."

cd "$PROJECT_DIR"

# --- 1. Pull latest code ---
echo "[1/4] Pulling latest code..."
git pull --ff-only

# --- 2. Rebuild containers ---
echo "[2/4] Building containers..."
docker compose build

# --- 3. Start/restart stack ---
echo "[3/4] Starting stack..."
docker compose up -d

# --- 4. Run migrations ---
echo "[4/4] Running database migrations..."
docker compose exec worker python -m transit_ops.cli init-db
docker compose exec worker python -m transit_ops.cli seed-core

echo ""
echo "==> Deploy complete. Stack status:"
docker compose ps
```

- [ ] **Step 3: Create infra/teardown.sh**

```bash
#!/usr/bin/env bash
# teardown.sh
# Gracefully stop all containers.
#
# Usage:
#   bash infra/teardown.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

echo "==> Stopping transit-ops stack..."

cd "$PROJECT_DIR"

# Stop worker first to let current cycle complete
echo "[1/2] Stopping worker (waiting for current cycle to finish)..."
docker compose stop -t 30 worker

echo "[2/2] Stopping remaining services..."
docker compose down

echo ""
echo "==> Stack stopped. Data volume (pg-data) is preserved."
echo "    To remove all data: docker compose down -v"
```

- [ ] **Step 4: Make scripts executable**

Run: `chmod +x infra/setup-vm.sh infra/deploy.sh infra/teardown.sh`

- [ ] **Step 5: Commit**

```bash
git add infra/setup-vm.sh infra/deploy.sh infra/teardown.sh
git commit -m "feat: add VM infrastructure scripts (setup, deploy, teardown)"
```

---

## Task 11: Local Validation

- [ ] **Step 1: Run full test suite**

Run: `uv run pytest tests/ -v`
Expected: All tests pass (settings + health checks)

- [ ] **Step 2: Run ruff**

Run: `uv run ruff check src/ tests/`
Expected: No lint errors

- [ ] **Step 3: Verify docker-compose builds both images**

Run: `docker compose build`
Expected: Both `worker` and `health-api` images build successfully

- [ ] **Step 4: Test local stack (optional — requires .env with PG_PASSWORD)**

Run:
```bash
echo "PG_PASSWORD=localdev123" > .env.local
docker compose --env-file .env.local up postgres -d
docker compose --env-file .env.local run --rm worker python -m transit_ops.cli db-test
docker compose --env-file .env.local down
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "chore: local validation pass — all tests green, lint clean, compose builds"
```
