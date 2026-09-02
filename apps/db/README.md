# transit-ops

Python 3.12 pipeline that captures provider feeds, preserves raw Bronze objects,
loads normalized Silver tables, builds Gold reporting data, and publishes the
versioned `/v1` snapshot contract. The web app reads snapshots; it never reads
PostgreSQL directly.

## Domain boundaries

| Area | Owner |
| --- | --- |
| Provider identity, endpoints, bounds, and capabilities | [`config/providers/*.yaml`](config/providers/README.md) through `ProviderRegistry` |
| Durable raw source data | `transit_ops.ingestion` and Bronze R2 |
| Normalized relational data | `transit_ops.silver` |
| Reporting facts, marts, and retained rollups | `transit_ops.gold` |
| Public files and publication gates | `transit_ops.snapshots` |
| Database lifecycle | Alembic under `transit_ops/db/migrations` |
| VM services | [`docker-compose.yml`](docker-compose.yml): Postgres, worker, pruner, health, and Caddy |

`stm.yaml` and `octranspo.yaml` are active manifests. `sto.yaml` remains an
inactive template. Active-provider scheduling and publication come from the
registry; `seed-core` records every manifest so inactive state remains explicit.

The source-factory rebuild is a guarded disaster-recovery path, not a normal
ingestion shortcut. It plans by default and requires separate worker, Oracle
target, and destructive-R2 confirmations before execution.

## Setup and checks

Run Python commands from this directory. Start with the repository-root
[`../../.env.example`](../../.env.example), and configure only the path being
run.

```bash
cd apps/db
uv sync --locked
uv run transit-ops --help
uv run ruff check src tests
env -u TRANSIT_TEST_DATABASE_URL COLUMNS=200 uv run pytest tests
uv run mypy src/transit_ops/snapshots/publish.py
```

Real-database tests use `TRANSIT_TEST_DATABASE_URL` and must target a disposable
Postgres 16 + PostGIS database. Without it, those tests skip and the offline
suite remains safe.

## Database lifecycle

Migrations form one append-only Alembic chain. Add a new revision instead of
editing an applied revision. `init-db` upgrades to the single head; CI also
replays the entire chain on an empty disposable database before running the
real-database suite.

```bash
uv run alembic heads
DATABASE_URL='<explicit target>' uv run transit-ops init-db
DATABASE_URL='<same target>' uv run transit-ops seed-core
```

Remote migrations require `DATABASE_URL` in the process environment. An
implicit remote URL loaded from `.env` is refused. Production migration,
rotation, recreation, and restart operations remain owner-gated.

The Compose Postgres host port binds to loopback by default. External SQL access
uses the TLS, SCRAM, HBA, and least-privilege contracts in
[`infra/postgres-serving-access`](infra/postgres-serving-access/README.md);
`transit-reporting` is Gold-only, while `transit-db` is read-only across the data
schemas and is SSH-tunnel-first.

## Data and failure invariants

- Bronze is the durable replay source. Realtime Silver is intentionally thin;
  `replay-realtime-silver` reloads a bounded `[start, end)` Bronze window
  idempotently, after which Gold is rebuilt separately.
- Capture records are ordered by capture time. When a feed omits its timestamp,
  ingestion uses completion time so the snapshot freshness signal stays
  non-null and monotonic. Retention resolves per-endpoint keep boundaries and
  preserves the latest snapshot; a rare ID/time inversion may under-delete but
  must never over-delete retained data.
- Alert language tags are observed before normalization and Silver coalescing.
  Silver retains the last explicit English text for a content version when a
  later observation omits it, while coverage is measured only from the
  pre-coalescing observations. Newer measurement timestamps cannot be replaced
  by older ones.
- A capture is marked successful only after its Bronze object and database
  lineage are durable. Endpoint failures remain visible in run telemetry;
  partial cycles do not erase successful captures.
- Realtime publication is best-effort after capture and normalization. The
  dedicated pruner runs independently, isolates Silver and Gold failures, and
  drains deletions in bounded batches.

Do not invent one-off replay procedures. Use the owned CLI paths and retained
raw inputs so lineage, idempotency, and failure telemetry remain intact.

## Retention defaults

| Data | Default |
| --- | ---: |
| Silver static datasets | 1 current dataset |
| Bronze static | 30 days |
| Bronze realtime | 90 days |
| Bronze i3 alerts | 30 days |
| Silver realtime | 1 day |
| Silver closed i3 history | 90 days |
| Gold detail facts | 14 days |
| Gold warm rollups | 730 days |
| Logical database backups | 14 copies |

Gold detail facts 14 days is the fixed storage boundary; longer reporting
horizons come from retained warm rollups.

[`../../.env.example`](../../.env.example) and `Settings` are the executable
configuration contract. A retention change must update both, Compose defaults,
tests, and this table together.

## Existing Postgres volumes

`POSTGRES_PASSWORD` initializes an empty Postgres data directory. Changing the
environment value does not rotate the role password already stored in a volume.

For disposable local data, stop the stack and remove only its confirmed
`postgres_data` volume. Never use volume deletion for retained or production
data.

For retained data, obtain owner approval:

1. Load the new password into the shell without placing it in history:

   ```bash
   read -rsp 'New Postgres password: ' POSTGRES_PASSWORD
   export POSTGRES_PASSWORD
   printf '\n'
   ```

   This only satisfies Compose interpolation. Operational invariant:
   `No service is recreated before the database role changes.`
2. Keep Postgres running and stop its clients:

   ```bash
   docker compose stop worker pruner health
   ```

3. Rotate the role inside Postgres:

   ```bash
   docker compose exec postgres psql -U "${POSTGRES_USER:-transit}" -d "${POSTGRES_DB:-transit}"
   \password
   ```

4. Persist the same password in the runtime secret source, then recreate the
   clients without deleting `postgres_data`:

   ```bash
   docker compose up -d --force-recreate postgres worker pruner health
   ```

5. Verify health and worker access with the new credential. The credential
   invariant is `The old password must fail.` Retain the private-bind, network,
   firewall, and HBA receipts.

## Recovery

`recover` is dry-run by default. Execution requires the action ID twice:

```bash
uv run transit-ops recover restart-worker
uv run transit-ops recover restart-worker --execute --confirm restart-worker
```

The action IDs are `restart-worker`, `restart-health`, `restart-pipeline`, and
`reboot-vm`. Pipeline pause/resume scripts also change GitHub schedules and VM
services, so they are operator actions. Backups stream from the worker to
private Bronze R2; [`scripts/restore-backup-proof.sh`](scripts/restore-backup-proof.sh)
restores the newest backup into a local throwaway cluster and checks the schema,
critical data, exclusions, and PostGIS before any recovery claim.
