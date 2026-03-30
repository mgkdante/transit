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
- `STATIC_DATASET_RETENTION_COUNT=1`
- `SILVER_REALTIME_RETENTION_DAYS=2`
- `PROVIDER_TIMEZONE=America/Toronto`
- `STM_PROVIDER_ID=stm`

## Observed hosted execution

Hosted Railway logs showed:

- successful worker startup
- successful realtime capture of `trip_updates`
- successful realtime Silver load of `trip_updates`
- successful realtime capture of `vehicle_positions`
- successful realtime Silver load of `vehicle_positions`
- successful `refresh-gold-realtime`
- successful `prune-silver-storage`
- successful `prune-gold-storage`
- successful end-to-end worker cycles

Observed hosted timing samples at 60s cadence (deployment `bdd6e737`, initial Slice 2 baseline, 2026-03-27):

- cycle 1:
  - `cycle_duration_seconds = 4.637`
  - `computed_sleep_seconds = 55.363`
  - `effective_start_to_start_seconds = null` (first cycle)
- cycle 2:
  - `cycle_duration_seconds = 4.153`
  - `effective_start_to_start_seconds = 60.001`
- cycle 3:
  - `cycle_duration_seconds = 4.628`
  - `effective_start_to_start_seconds = 60.001`

Stable-state 60s baseline (cycles 456–515, 2026-03-27):

- cycle duration range: 6.561–8.442s (grew from initial ~4–5s as Gold fact tables filled the 2-day window)
- `effective_start_to_start_seconds`: 60.000–60.004s
- `computed_sleep_seconds`: 51.5–53.4s
- 60 cycles observed, zero failures, zero overruns

Typical step breakdown per cycle at stable state:

- `capture_trip_updates`: ~0.8–1.4s
- `load_trip_updates_to_silver`: ~1.8–2.2s
- `capture_vehicle_positions`: ~0.4–0.6s
- `load_vehicle_positions_to_silver`: ~0.3–0.6s
- `refresh_gold_realtime`: ~0.24s
- `prune_silver_storage`: ~0.03s
- `prune_gold_storage`: ~0.02s
- total: ~6.5–8.5s stable-state

## 30s pilot results (Slice 6)

`REALTIME_POLL_SECONDS` was updated from `60` to `30` on the Railway service.
Railway redeployed automatically (deployment `fb45c113`, 2026-03-27).

Observed 30s pilot (cycles 1–19):

- cycle duration range: 6.407–8.051s (identical profile to 60s stable-state)
- `effective_start_to_start_seconds`: 30.000–30.005s
- `computed_sleep_seconds`: 21.9–23.6s
- minimum sleep headroom: 21.9s
- 19 cycles observed, zero failures, zero overruns

**Decision: 30s is production-ready. `REALTIME_POLL_SECONDS=30` kept.**

Rollback steps (if needed in future):

1. Railway dashboard → service `realtime-worker` → Variables → set `REALTIME_POLL_SECONDS=60`
2. Railway redeploys automatically on variable change
3. Confirm next cycle logs show `requested_poll_seconds: 60.0`
4. Total rollback time: ~2 minutes

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
- keep the worker on the lightweight realtime Gold refresh path rather than
  putting the heavy full `build-gold-marts` back into the hot loop
- do not increase cadence beyond 30s without re-running a quota analysis (currently 57.6% of STM daily limit)
- do not remove `prune-gold-storage` from the realtime cycle — it bounds
  `gold.fact_*` table growth at 2 days (`GOLD_FACT_RETENTION_DAYS`)
