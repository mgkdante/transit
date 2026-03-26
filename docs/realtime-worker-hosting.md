# Hosted Realtime Worker

## Current status

Hosted realtime deployment is not yet achieved from the current repository
environment.

What is already proven:

- the GitHub Actions static workflow runs successfully
- the Docker image builds successfully
- bounded realtime worker container runs succeed locally
- the worker keeps its true `30` second start-to-start cadence in containerized
  execution

## Exact blocker

The current environment does not expose one simple authenticated long-running
container host for this repo.

What was checked:

- `gh` is available and authenticated, but GitHub Actions is only being used for
  the daily static batch workflow
- `docker` is available locally, which proves the image and local runtime path
- no authenticated or installed long-running container-host CLI was available
  from the inspected environment for platforms such as Fly.io, Railway, Render,
  or a similar always-on container host
- no pre-existing deployment manifest for a hosted container runtime is checked
  into this repo

## Exact next manual step

Choose and authenticate one simple long-running container host, then deploy the
existing Dockerized worker there without changing the worker entrypoint.

The current container path is already ready to reuse:

- image build:
  - `docker build -t transit-ops-worker .`
- runtime command:
  - `python -m transit_ops.cli run-realtime-worker stm`

Required runtime secrets:

- `NEON_DATABASE_URL`
- `STM_API_KEY`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

Required non-secret runtime configuration:

- `REALTIME_POLL_SECONDS=30`
- `REALTIME_STARTUP_DELAY_SECONDS=0`

## What not to change for first hosting

- do not change the Bronze storage strategy away from R2
- do not change the DB schema
- do not rework the worker into a second deployment system unless the selected
  platform truly requires it
