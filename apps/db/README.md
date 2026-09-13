# transit-ops

Python 3.12 pipeline that captures provider feeds, preserves raw Bronze objects,
loads normalized Silver tables, builds Gold reporting data, and publishes the
versioned `/v1` snapshot contract. The web app reads snapshots; it never reads
PostgreSQL directly.

## Domain boundaries

| Area                                                   | Owner                                                                                   |
| --- | --- |
| Provider identity, endpoints, bounds, and capabilities | [`config/providers/*.yaml`](config/providers/README.md) through `ProviderRegistry`      |
| Durable raw source data                                | `transit_ops.ingestion` and Bronze R2                                                   |
| Shared S3 connection configuration                     | `transit_ops.s3`; each storage domain selects and validates its own bucket             |
| Normalized relational data                             | `transit_ops.silver`                                                                    |
| Reporting facts, marts, and retained rollups           | `transit_ops.gold`                                                                      |
| Public files and publication gates                     | [`transit_ops.snapshots`](src/transit_ops/snapshots/README.md)                              |
| Database lifecycle                                     | Alembic under `transit_ops/db/migrations`                                               |
| VM services                                            | [`docker-compose.yml`](docker-compose.yml): Postgres, worker, pruner, health, and Caddy |

`stm.yaml` and `octranspo.yaml` are active manifests. `sto.yaml` remains an
inactive template. Active-provider scheduling and publication come from the
registry; `seed-core` records every manifest so inactive state remains explicit.

The [source-factory rebuild](src/transit_ops/source_factory/README.md) is a
guarded disaster-recovery path, not a normal ingestion shortcut. It plans by default and requires separate worker, Oracle
target, and destructive-R2 confirmations before execution.

Drain ingestion, Gold/daily builders, replayers, publishers and pruners before a
source reset. Reset preserves retained daily state transactionally but does not
acquire the writers' day locks; it is not safe to overlap with active repair.

Capture failures preserve their original exception. Recording the failed run,
removing its temporary download, and deleting an uploaded orphan are independent
best-effort steps owned by `ingestion.common.finish_failed_capture`. A database
outage cannot suppress cleanup. Cleanup warnings identify the run and orphan key;
failure messages are redacted before storage. If cleanup itself fails, the warning
requires operator follow-up; successful cleanup is never assumed.

Downloads compute SHA-256 while writing the response to a temporary file. The
checksum identifies the streamed bytes; it is not a separate disk readback or
durability check. A write or close failure prevents a successful artifact.

## Service counts

`gold.scheduled_running_trips_at(provider_id, as_of)` resolves timed trip spans
against the current static edition and its dated calendar exceptions. GTFS times
are elapsed seconds from local noon minus 12 hours, including seconds, offsets
beyond 24 hours and daylight-saving transitions. `gold.non_responding_current`
counts distinct scheduled-running trip IDs absent from the latest vehicle
snapshot, excluding metro. This is a current reporting gap, not evidence of
cancellation or a count of missing passengers. The network builder derives its
total and route breakdown from one view read.

`gold.route_cancellation_daily` groups repeated feed reports by trip identifier
and service date. An observed trip-day counts as cancelled if any report marks
it cancelled. The public field names are retained for compatibility:

| Field | Meaning |
| --- | --- |
| `total_trip_days` | Distinct trip-days reported in the feed |
| `delivered_trip_days` | Reported trip-days minus those marked cancelled |
| `scheduled_trip_days` | Active trips in the applicable static schedule |
| `silent_trip_days` | `max(scheduled_trip_days - total_trip_days, 0)` |
| `service_completeness_pct` | `min(100, 100 * delivered_trip_days / scheduled_trip_days)` |

This compares counts without matching scheduled trip identities. Added trips can
hide missing scheduled trips, and a count shortfall cannot identify which trip
was absent. Unknown or zero scheduled denominators produce null percentages.
Network and receipt comparisons sum counts over rows with a known schedule;
they do not average route percentages. Cancellation rate keeps its separate
denominator of reported trip-days. Live fleet coverage separately measures the
share of vehicles in service with a known status.

## Daily delay means and recovery

Five-minute summaries retain the integer sum of known delays within ±3,600 seconds.
Their usable count is `delay_observation_count - outlier_count`. Hourly summaries
pool that sum and count; the daily view divides their totals without rounding
intermediate means. Snapshot builders convert seconds to minutes and round once
to one decimal place using the shared half-away rule. OTP keeps its separate
known-delay denominator.

Daily rows follow provider-local capture dates and include a partial current day.
A missing sum from any contributing usable hour makes the daily mean unknown.
Empty usable populations also produce null. Receipt rankings are withheld when
an eligible route's mean is unknown, rather than selecting from an incomplete
comparison.

Closed-day delay metrics use the same capture clock: route/stop percentiles,
route/stop delay spines, stop delay by shift, repeat-offender daily rows and
delay/crowding co-observations. Each day converts its two local midnights to UTC
separately, including 23-hour and 25-hour DST days. Cancellation, scheduled service
and service span retain their service-day populations; headway retains its existing
D7 policy. Shared fact date fields keep their original meaning.

`gold.rollups.build_daily_rollups` runs the fifteen daily kinds from the shared
repair catalog and returns ordered stage receipts. Its caller supplies the seeded
provider's closed, retained source dates in `DailyRollupCalendars`; normal warm
builds collect those capture, feed and occupancy calendars before the five-minute
stage. Each kind keeps its own watermark. Normal build order puts scheduled trips
before cancellation; explicit repair retains its separate order and transactions.
The existing warm-build result fields remain the reporting interface.

The capture-day calendar uses one indexed presence probe per retained day. The
writer checks day state and source presence again after acquiring coordination,
then checks the actual UTC retention cutoff before and after materialization.
Explicit repair shares one complete recorded-cohort proof across the requested
metrics for each day. Their rows and watermarks change in one transaction;
expiry, missing proof or failure preserves that day's previous state. An empty
day requires recorded empty captures; missing source is not proof of emptiness.

Existing daily watermarks are not rewritten automatically. Preview a correction
over a fully retained range that includes both the old and new row dates:

```bash
uv run transit-ops rebuild-warm-rollups stm \
  --from 2026-09-03 --to 2026-09-04 \
  --kinds route_percentile_daily,stop_percentile_daily,route_delay_spine,stop_delay_spine,stop_delay_shift_daily,repeat_offender_daily_spine,route_delay_by_crowding_daily \
  --dry-run
```

Use current reviewed dates, then refresh reporting and inspect published snapshots
after executing the approved range. Older history is not certified by a code
change alone. Late/replayed Gold corrections mark existing daily metrics dirty
in the fact transaction. Ordinary builds refuse dirty days in their requested
window and report remaining dirty history in `daily_delay_state`. Explicit repair
can require bounded Silver-only restoration because Silver expires before Gold.
Source resets preserve daily state while retaining its metric tables, including
the internal per-day coordination row; that row is not a metric.

All publishers read a repeatable database snapshot. Each provider/tier has one
nonblocking transaction lane, also used by historic collection. An overlapping
publisher fails before building or writing; the realtime cycle records that
failure and continues. The lane releases on commit or rollback. Historic
publication refuses visible dirty daily history before storage reads or uploads,
even with `--force`; it preserves the prior published generation. A correction
committed after the publication snapshot belongs to the next publication. Historic
root activation is conditional, but remote activation and the later database
commit remain separate operations.

Live children upload before the manifest, but readers can still see mixed mutable
files during an upload. The common generation timestamp identifies build start,
not atomic visibility or upstream age. Historic `publish_generation_id` uses a
UTC-day label; immutable content hashes distinguish corrections within that day.

Daily headways exclude a reported start when an earlier retained usable observation
identifies the same explicit service date, trip, route and direction. Earlier-day
starts never enter the current day's gap calculation. Missing or mixed service-date
observations keep the existing fallback; absent retained context does not prove a
true first start. Existing watermarked days require a controlled explicit rebuild.

Revision 0087 adds nullable state without a historical fact scan. Its checks apply
to new writes; validation of retained rows is separate. Existing counters, rows,
legacy hourly means, and watermarks remain intact. Ordinary warm builds skip
watermarked five-minute periods, so they cannot recover the missing state alone.

```bash
uv run transit-ops recover-delay-sums stm --from 2026-09-01 --until 2026-09-05
uv run transit-ops recover-delay-sums stm --from 2026-09-01 --until 2026-09-05 --execute
```

These are UTC bounds with an exclusive end. The default previews recoverable and
unknown rows. Execution commits one hour at a time, reusing the normal period
locks and batching writes by table. `gold.delay_sums` reconciles retained facts
against five-minute statistics, then reconciles those buckets against the stored
hour, including its historical rounded mean and any already known additive state.
Only missing state is filled. Changed target rows are skipped and counted for
retry. Repeating a completed range does not rebuild its metrics or watermarks.

Upgrade schema and writers together. Run bounded recovery and inspect its unknown
counts before publishing corrected snapshots; review any changed receipt ranking.
Older Bronze replay may recover additional history, but this command does not
infer exact sums from rounded means. Validate the three new constraints separately
after recovery using `ALTER TABLE ... VALIDATE CONSTRAINT`: `ck_trip_delay_5m_usable_sum`,
`ck_route_delay_hourly_usable_count`, and `ck_route_delay_hourly_usable_sum`.
Production execution still follows the explicit target and deployment procedure.

A default zero introduced by an older migration does not prove that an hour was
empty. Recovery requires coherent empty statistics or a reconciled source cohort.

Five-minute summaries include only intervals closed when the job started. The
`gold.delay_periods` module owns their locks, invalidation and atomic replacement.
Realtime fact writes invalidate the affected interval in their transaction.
Replacing an existing summary requires `gold.delay_cohorts` to verify capture
metadata, entity coverage and matching Silver/Gold trip keys. Missing evidence
preserves the old summary and fails the job so recovery remains visible.
`gold.delay_hours` folds the same statistics for ordinary reporting and repairs;
child watermarks retain retry evidence even when a corrected interval becomes empty.

Preview a premature-interval repair within the fully retained fact window:

```bash
uv run transit-ops repair-delay-periods stm \
  --from 2026-09-04T11:55:00+0000 --until 2026-09-04T12:00:00+0000
```

Use current dates, aligned to five-minute UTC intervals. Add `--execute` to apply
verified replacements and refresh their hourly parents. This regroups retained
Gold values; it does not reconstruct missing stop-time data. Run exact-sum
recovery after the repair and inspect remaining unknown means before publication.

## Setup and checks

Run Python commands from this directory. The executable workspace contract is
the Python 3.12 line from repository-root [`.python-version`](../../.python-version)
and uv 0.11.15 from the shared setup action and both Python runtime images. CI
prints the selected 3.12 patch; deployment images separately pin and assert
Python 3.12.14. Project metadata stays compatible with `>=3.12,<3.13`. Start
with the repository-root [`../../.env.example`](../../.env.example), whose local
defaults cannot select a remote storage target. Configure only the path being
run; CI and production jobs select remote storage explicitly.

```bash
cd apps/db
cp ../../.env.example .env
uv sync --locked
uv run transit-ops --help
uv run ruff check src tests
env -u TRANSIT_TEST_DATABASE_URL COLUMNS=200 uv run pytest tests
uv run mypy
```

`uv run mypy` checks the publisher, shared S3 setup, Gold readers, delay lifecycle,
scoped replay and realtime retention in strict mode. Its scope is configured in
`pyproject.toml`.

Real-database verification is supported on Linux and WSL with a local amd64
Docker daemon and requires Python 3.12 and Docker Compose v2. It owns its
disposable Postgres 16 + PostGIS target from creation through cleanup:

```bash
bash scripts/run-real-db-tests.sh
```

The command uses a dynamic loopback port. It attempts cleanup on handled exits
and returns success only after proving its generated data volume is absent;
SIGKILL, host loss, and Docker daemon loss cannot guarantee cleanup. Without
that command, real-database tests skip and the offline suite remains safe.

Protected CI also builds the worker, health, and production Postgres recipes and
probes only their version commands:

```bash
bash scripts/verify-runtime-images.sh
```

The script never starts an application process. It prints Docker Engine and
Compose versions, then Python, uv, PostgreSQL, PostGIS, pg_repack, and Caddy
versions from ephemeral containers. It removes only its unique local worker,
health, and Postgres verification tags on handled exits.

The Python, PostgreSQL, and Caddy base images are pinned by readable tag and OCI
index digest. Debian Bookworm apt patch packages intentionally remain moving so
image rebuilds receive security servicing; the verifier prints the resolved
explicit package versions. The host Docker Engine and Compose installation are
also moving CI substrates whose effective versions are printed, not fixed by
this repository. Production image adoption and VM recreation remain separately
owner-gated.

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

## Operator health proxy

Compose keeps Caddy on loopback by default. The default operator health endpoint
is `http://127.0.0.1:8080`; the mapped host port `8443` is meaningful only when
`CADDY_SITE_ADDRESS` enables TLS, because the default `:80` site serves HTTP
only. Treat a non-loopback `CADDY_BIND_ADDRESS` as a deliberate, reviewed
exposure change.

For remote checks, keep the loopback bind and use the existing SSH mode in the
cutover validator. The URL is resolved on the remote host when
`HEALTH_SSH_TARGET` is set:

```bash
HEALTH_BASE_URL=http://127.0.0.1:8080 \
HEALTH_SSH_TARGET=<ssh-target> \
bash scripts/validate-oracle-cutover.sh
```

## Data and failure invariants

- Static capture records source bytes without promoting them to the current
  dataset. Its optional `dataset_version_id` can be null until Silver loads.
  Silver owns materialization and promotion; Gold refreshes separately.
  Identical source bytes retry unfinished processing: Silver and Gold after a
  failed Silver load, or Gold alone after its own failure. A completed
  unchanged dataset skips both. Empty route data cannot replace a usable
  dataset.
- Daily static publication requires every provider's static processing to
  succeed. A failure retains all existing published static snapshots; pending
  updates retry on the next scheduled or manual run. GIS-only best-effort
  failures do not block publication. Silver and Gold are separate transactions,
  so successful Silver data can await its matching Gold refresh.
- Bronze is the durable replay source. Realtime Silver is intentionally thin;
  `replay-realtime-silver` verifies a bounded `[start, end)` archive window,
  restores incomplete Silver snapshots and refreshes only those Gold snapshots.
  Complete Silver inputs retain their row-count proof for retrying failed Gold work.
- Capture records are ordered by capture time. When a feed omits its timestamp,
  ingestion uses completion time so the snapshot freshness signal stays
  non-null. Silver retention selects expired captures by timestamp, preserving
  the newest capture per endpoint even when replay inserts an older feed later.
  It deletes through the selected snapshot keys in bounded child-first batches
  and skips captures locked by cooperating loaders until a later prune cycle.
- Alert language tags are observed before normalization and Silver coalescing.
  Silver retains the last explicit English text for a content version when a
  later observation omits it, while coverage is measured only from the
  pre-coalescing observations. Newer measurement timestamps cannot be replaced
  by older ones.
- A capture is marked successful only after its Bronze object and database
  lineage are stored. Endpoint failures remain visible in run telemetry;
  partial cycles do not erase successful captures.
- Realtime publication is best-effort after capture and normalization. The
  dedicated pruner runs independently, isolates Silver and Gold failures, and
  drains deletions in bounded batches.
- Bundled historic point publication builds the Hotspots plan first and reuses
  its materialized provider-local name index for Repeat Offenders. Standalone
  builders still resolve their own provider context.

Realtime Silver retention and archive pruning require a managed,
non-autocommit `READ COMMITTED` transaction. The CLI supplies it. Archive batches
lock candidates and recheck their references before deleting storage objects;
Silver and Gold references preserve their archives. Busy captures are deferred.
The newest capture per endpoint survives expiration, while a known-empty Gold
serving marker can outlive its Raw source. Object deletion and database commit
remain separate: rolling back the database cannot restore an already deleted
object.

Static Silver loading pins its source object in the caller's non-autocommit
transaction before opening the ZIP, then holds that lock through materialization.
Pruning skips that busy object; if pruning wins first, loading refuses the lost
source before reading storage. Size and checksum verification still precede
dataset registration and all Silver writes. The pin locks existing source
metadata. Ending the transaction releases it, including on load failure.

Static GTFS inventory reuses ordered columns, logical row counts and raw-member
SHA-256 from completed typed CSV reads. Unknown or tolerantly skipped members
retain the separate metadata scan. The loader caches those completed facts,
never CSV rows or decompressed members.

Archive pruning resolves each object's recorded `local` or `s3` backend and
deletes in backend-specific batches. Unknown, unavailable or mismatched stores
retain their metadata for retry. Legacy alert snapshots without a backend use
only an ingestion object with matching provider, run and path. Dry runs count
eligible metadata without opening storage clients. A backend name still uses
its current configured directory or bucket; changing that destination requires
an archive migration plan.

Do not invent one-off replay procedures. Use the owned CLI paths and retained
raw inputs so lineage, idempotency, and failure telemetry remain intact.

Replay verifies each archive's recorded checksum and length before writing.
Its storage scope resolves each capture's backend and closes shared resources.
Gold projection validates the selected populations in one transaction, preserves
unrelated history, and uses the current static dataset identified in its result.
It repairs selected currently served captures without promoting another capture
or filling an empty live lane; ordinary realtime refresh owns live advancement.

```bash
uv run transit-ops replay-realtime-silver stm \
  --since 2026-09-03T11:50:00Z --until 2026-09-03T11:55:00Z --silver-only
```

Use current recovery bounds. `--silver-only` restores source rows while retaining
existing Gold values and their original static derivation. It is useful after a
backup restore that omitted realtime stop times. Omit the flag when the selected
Gold projections also need rebuilding against the current static dataset; that
does not establish historical static identity. Silver commits before Gold, so a
failed Gold stage can retry from the same verified window. After source recovery,
repair affected rollups and inspect exact-mean availability before publication.

Realtime cycles pass the captured snapshot ID to Silver and carry the resulting
typed receipt into Gold. SourceFactory uses the same handoff. Gold records every
selected successful input in history; `gold.realtime_serving_state` separately
orders live advancement by capture time, then raw ID. A valid empty feed retains
its identity, so a delayed older input cannot repopulate or rewind it. I3 uses
its existing observation boundary to skip strictly older alert captures without
changing newer SCD state.

Migration 0089 seeds consistent nonempty serving caches and leaves legacy empty
lanes unknown with a fixed initialization cutoff. Workers and SourceFactory
initialize lanes before fresh capture. Standalone `refresh-gold-realtime`
verifies the latest available archived inputs before projection; an explicit
`--bootstrap-from-archive` may initialize unknown lanes only from the newest
successful capture with a verifiable archive. It cannot force a known lane
backward. Existing partial Silver requires bounded replay with `--silver-only`.
Full `build-gold-marts` rebuilds dimensions/history while preserving live caches
and serving markers; it does not bootstrap live data.

Facts, serving caches, markers and rollup invalidation commit together. Live
projection retries serialization/deadlock failures at most three times. This
does not add a durable capture backlog: interrupted input receipts still need
explicit retry or replay. Drain legacy cache writers during the schema/writer
cutover, because older code does not maintain the new marker. Local migration
checks do not establish production adoption.

## Database sessions

Compose sets `PGAPPNAME` to `transit-worker`, `transit-pruner`, or `transit-health`.
PostgreSQL exposes that client-provided label as `application_name` in
`pg_stat_activity`, making service connections easier to identify during diagnosis.
Explicit connection parameters can override the label; it is not an identity or
permission check.

## Retention defaults

| Data                     |           Default |
| --- | ---: |
| Silver static datasets   | 1 current dataset |
| Bronze static            |           30 days |
| Bronze realtime          |           90 days |
| Bronze i3 alerts         |           30 days |
| Silver realtime          |             1 day |
| Silver closed i3 history |           90 days |
| Gold detail facts        |           14 days |
| Gold warm rollups        |          730 days |
| Logical database backups |         14 copies |

Gold detail facts use `GOLD_FACT_RETENTION_DAYS` (14 by default); longer reporting
horizons come from retained warm rollups. The mutable repeat-offender summary
reports that configured fact window. Immutable repeat-offender history uses
14 closed local dates, while its week/month ladders use 7/30 days. These periods
are separate contracts; changing fact retention does not redefine historical windows.

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
restores the newest backup into a local throwaway cluster and checks its recorded
revision, critical data, exclusions, PostGIS, and enabled durability settings.

```bash
bash scripts/restore-backup-proof.sh
```

| Setting | Default and purpose |
| --- | --- |
| `RESTORE_WORKDIR` | `/tmp/transit-restore-proof`; must not exist, with an existing parent |
| `PG_BIN` | `/usr/lib/postgresql/16/bin`; PostgreSQL 16 with the backup's extensions available |
| `RESTORE_PORT` / `RESTORE_JOBS` | `55434` / `4`; Unix socket port and parallel restore jobs |
| `RESTORE_DUMP_FILE` | Unset downloads the newest backup; set to reuse a local dump |
| `RESTORE_MIN_FREE_GB` | `30`; required free space on the workdir filesystem |
| `RESTORE_EXPECTED_REVISION` | Unset checks the unique repository head; set to the backup's recorded source revision when it differs |
| `KEEP_RESTORE_WORKDIR` | `0`; `1` retains files and the running cluster for the gated checks |

The workdir is created exclusively with private permissions. Its complete Unix
socket path must fit 107 bytes; commas and control characters are unsupported.
Stop failure or changed directory ownership preserves files and fails the drill.
`KEEP_RESTORE_WORKDIR=1` reports whether the cluster is actually running, including
on failure. On success it prints the connection and revision exports needed for
`uv run pytest tests/test_restore_proof_real_db.py -v`, plus the stop command.
The script and gated tests use the same `RESTORE_EXPECTED_REVISION`; setting it
does not apply migrations or excuse a mismatch with the restored source.

RTO output separates download, restore, smoke, and total elapsed seconds. Fsync
and full-page writes remain enabled. A successful local drill proves this backup
under the recorded host/runtime conditions; it does not establish production
cutover time or replace the source-revision and exclusion checks.
