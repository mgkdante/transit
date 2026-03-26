# Hosted Realtime Worker

## Current status

Hosted realtime deployment is now achieved on Railway.

## Hosted target

- project: `transit-ops`
- environment: `production`
- service: `realtime-worker`
- deployment id:
  - `ba53c28b-6304-42c3-9887-8f29a2d9bd0e`

## Runtime path

- Railway CLI was installed locally with:
  - `npm install -g @railway/cli`
- Railway auth is valid for:
  - `Yesid Otalora (contact@yesid.dev)`
- Railway created and linked the project with:
  - `railway init --name transit-ops --json`
- the worker service was created with:
  - `railway add --service realtime-worker --json`
- the repo was linked to the worker service with:
  - `railway service link realtime-worker`
- Railway deployed from the existing repo with:
  - `railway up -s realtime-worker -e production -d -m "Deploy realtime worker from transit repo"`
- Railway build logs reported:
  - `Using Detected Dockerfile`
- the container runtime command remains:
  - `python -m transit_ops.cli run-realtime-worker stm`

## Configured variables

Runtime secrets configured on the Railway service:

- `NEON_DATABASE_URL`
- `STM_API_KEY`
- `BRONZE_S3_ACCESS_KEY`
- `BRONZE_S3_SECRET_KEY`

Required non-secret runtime configuration:

- `APP_ENV=production`
- `LOG_LEVEL=INFO`
- `BRONZE_STORAGE_BACKEND=s3`
- `BRONZE_S3_ENDPOINT=https://eccfb9bedd87d413eaf4cac6ae2285d3.r2.cloudflarestorage.com`
- `BRONZE_S3_BUCKET=transit-raw`
- `BRONZE_S3_REGION=auto`
- `REALTIME_POLL_SECONDS=30`
- `REALTIME_STARTUP_DELAY_SECONDS=0`
- `PROVIDER_TIMEZONE=America/Toronto`
- `STM_PROVIDER_ID=stm`

## Observed hosted execution

Hosted Railway logs showed:

- successful worker startup
- successful realtime capture of `trip_updates`
- successful realtime Silver load of `trip_updates`
- successful realtime capture of `vehicle_positions`
- successful realtime Silver load of `vehicle_positions`
- successful `build-gold-marts`
- successful end-to-end worker cycles

Observed hosted timing samples:

- cycle 1:
  - `cycle_duration_seconds = 7.802`
  - `computed_sleep_seconds = 22.198`
- cycle 3:
  - `cycle_duration_seconds = 6.119`
  - `effective_start_to_start_seconds = 30.0`

Observed hosted Bronze/R2 facts from logs and post-deploy verification:

- `storage_backend = "s3"` in hosted capture results
- latest verified hosted object keys:
  - `stm/trip_updates/captured_at_utc=2026-03-26/20260326T152030483339Z__bff871ddd40e__trip_updates.pb`
  - `stm/vehicle_positions/captured_at_utc=2026-03-26/20260326T152034583051Z__cf00fed4f0d7__vehicle_positions.pb`
- both latest hosted Bronze objects were confirmed to exist in R2
- latest verified hosted snapshot ids:
  - `trip_updates = 37`
  - `vehicle_positions = 38`

## What not to change for ongoing hosting

- do not change the Bronze storage strategy away from R2
- do not change the DB schema
- do not replace the current Dockerfile/CLI worker path unless Railway truly
  requires it later
