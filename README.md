# Transit

Transit is an independent civic dashboard for exploring transit service with
inspectable data, charts and maps. It captures GTFS and GTFS-Realtime feeds,
normalizes them in Postgres, and publishes versioned snapshots for the citizen
web app. The UI supports Montréal (STM) and Ottawa (OC Transpo); the published
provider catalog controls which are available. Coverage varies by agency, and
missing data remains unknown.

[Public dashboard](https://transit.yesid.dev) · [Source](https://github.com/mgkdante/transit)

| Domain | Responsibility | Command owner |
| --- | --- | --- |
| `apps/db` | Python ingestion, normalization and snapshot publication | [pyproject.toml](apps/db/pyproject.toml) |
| `apps/data-proxy` | Cloudflare Worker serving versioned snapshots | [package.json](apps/data-proxy/package.json) |
| `apps/web` | SvelteKit dashboard consuming snapshots, without direct DB access | [package.json](apps/web/package.json) |

The pipeline keeps archived source responses in Bronze, normalized records in
Silver, and derived data in Gold. Capture/load receipts identify completed work;
daily rollups retain separate completion dates for each metric family. Static,
live and historic snapshots form the public contract. Repeated source bytes can
still represent a new observation, so content identity and capture time remain
distinct. Corrections and explicit recovery can revisit affected history.

## Contribute

[CONTRIBUTING.md](CONTRIBUTING.md) covers setup, checks and browser tests. The
development preview reads public snapshots and needs no database, credentials or
Cloudflare account.

**Analytics:** Transit measures visits with cookieless Plausible.
Measurement is off unless `PUBLIC_PLAUSIBLE_DOMAIN` is set.
Production receives it from the repository variable at deploy, never from `wrangler.toml`.
Forks and local runs send nothing.

## Work on the Python pipeline

Use Python from [.python-version](.python-version) and the uv pin in
[setup-py](.github/actions/setup-py/action.yml). From `apps/db`, run:

```sh
uv sync --locked
uv run transit-ops --help
uv run ruff check src tests
uv run mypy
uv run pytest tests
uv run alembic heads
```

With `TRANSIT_TEST_DATABASE_URL` unset, real-database tests skip. The suite also
contains operational cases requiring Bash, POSIX processes or other runtime
access; a native Windows run does not prove those Linux cases. Mypy checks the
configured paths. `alembic heads` inspects migration history without applying it.

For pipeline configuration, copy [.env.example](.env.example) to `apps/db/.env`.
Local Bronze and snapshot storage are the defaults. Live feed capture requires
the relevant provider credentials; publication to remote storage needs explicit
configuration. Never point test or migration commands at production by accident.

To test against any disposable local PostgreSQL with PostGIS, set
`TRANSIT_TEST_DATABASE_URL=postgresql+psycopg://transit_ci:transit_ci@127.0.0.1:5432/transit_ci`
(adjust the password and port) and
`TRANSIT_TEST_DATABASE_DISPOSABLE=I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE`.
The [target guard](apps/db/src/transit_ops/db/target_safety.py) requires an approved
local role/database pair; tests can change its contents. From `apps/db`, set
`DATABASE_URL` to that same URL for `uv run alembic upgrade head`, then run
`uv run pytest tests`. The [backend workflow](.github/workflows/ci.yml) provisions
its own disposable PostGIS service on the hosted Linux runner.
Operational Bash scripts and container verification belong on the supported Linux
host; local Docker is not part of the Windows/WSL contributor workflow.

## Operate

Deployment requires the configured accounts, explicit targets and protected
workflow checks. A local build or dry run does not establish production adoption.
The [security workflow](.github/workflows/secret-scan.yml) scans for secrets.

Operators use the supported Linux host with its configured database, object
storage and account access. These are the executable owners of the operating
procedures; inspect their inputs and target before running them:

| Operation | Entry point and result |
| --- | --- |
| Runtime and resource settings | [Compose services](apps/db/docker-compose.yml), [settings](apps/db/src/transit_ops/settings.py) and [environment template](.env.example) own worker cadence, retention, pruning batches and storage targets. Worker, pruner and health services receive separate environment settings. |
| Publish and verify | [Daily static pipeline](.github/workflows/daily-static-pipeline.yml) and [daily warm rollups](.github/workflows/daily-warm-rollups.yml) own ordered ingestion/build/publication. The historic publication gate and public proof receipts accompany the workflow artifacts. |
| Recover publication | [Historic recovery](.github/workflows/historic-publish-recovery.yml) owns the explicit migration, archive sync, publish and public-proof sequence. It is a deliberate recovery operation, not an ordinary dashboard request. |
| Back up and prove restoration | From `apps/db` on the host, [backup-postgres.sh](apps/db/scripts/backup-postgres.sh) streams a logical backup to configured Bronze S3/R2 storage. [restore-backup-proof.sh](apps/db/scripts/restore-backup-proof.sh) restores into a separate temporary local cluster and checks the expected migration revision; it does not restore over production. Migration history before 0093 is squashed; restoring a pre-0093 backup requires the pre-squash chain at commit `5c998b09`. |
| Pause, resume and cut over | [Pause](apps/db/scripts/pause-pipeline.sh) and [resume](apps/db/scripts/resume-pipeline.sh) change GitHub schedules and the local Compose worker while leaving Postgres running. [Cutover validation](apps/db/scripts/validate-oracle-cutover.sh) checks the selected deployment target. |

Retain the actual deployed source, image, migration revision, configuration and
publication/restore receipts when operating a release. Repository checks prove
the candidate; live freshness, recovery and resource use require host evidence.

Transit source uses the [MIT License](LICENSE). [NOTICE](NOTICE) records separate
terms and attribution for design, GSAP, fonts, maps and provider data. Transit is
not affiliated with the transit agencies. Maintainer workflow instructions live
in [AGENTS.md](AGENTS.md); private workflow access is unnecessary for this setup.
