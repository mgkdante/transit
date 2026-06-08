#!/usr/bin/env bash
# Run a conservative pg_repack maintenance pass against the configured database.

set -euo pipefail

DEFAULT_TABLES=$'silver.trip_updates\nsilver.trip_update_stop_time_updates\nsilver.vehicle_positions\ngold.fact_vehicle_snapshot\ngold.fact_trip_delay_snapshot\ngold.vehicle_summary_5m\ngold.trip_delay_summary_5m'

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

if ! command -v pg_repack >/dev/null 2>&1; then
  echo "pg_repack command not found; install the pg_repack client before running this guardrail" >&2
  exit 127
fi

PG_REPACK_DRY_RUN="${PG_REPACK_DRY_RUN:-true}"
PG_REPACK_JOBS="${PG_REPACK_JOBS:-2}"
PG_REPACK_WAIT_TIMEOUT="${PG_REPACK_WAIT_TIMEOUT:-60}"
PG_REPACK_TABLES="${PG_REPACK_TABLES:-$DEFAULT_TABLES}"

if ! [[ "$PG_REPACK_JOBS" =~ ^[1-9][0-9]*$ ]]; then
  echo "PG_REPACK_JOBS must be a positive integer" >&2
  exit 2
fi

if ! [[ "$PG_REPACK_WAIT_TIMEOUT" =~ ^[1-9][0-9]*$ ]]; then
  echo "PG_REPACK_WAIT_TIMEOUT must be a positive integer" >&2
  exit 2
fi

normalized_tables="$(tr '\n\t' ' ' <<<"$PG_REPACK_TABLES")"
read -r -a tables <<<"$normalized_tables"

if [[ "${#tables[@]}" -eq 0 ]]; then
  echo "PG_REPACK_TABLES must name at least one table" >&2
  exit 2
fi

cmd=(
  pg_repack
  --dbname "$DATABASE_URL"
  --no-kill-backend
  --wait-timeout "$PG_REPACK_WAIT_TIMEOUT"
  --jobs "$PG_REPACK_JOBS"
)

case "${PG_REPACK_DRY_RUN,,}" in
  1 | true | yes | on)
    cmd+=(--dry-run)
    mode="dry-run"
    ;;
  0 | false | no | off)
    mode="execute"
    ;;
  *)
    echo "PG_REPACK_DRY_RUN must be true or false" >&2
    exit 2
    ;;
esac

for table in "${tables[@]}"; do
  cmd+=(--table "$table")
done

echo "Running pg_repack guardrail against configured DATABASE_URL."
echo "Mode: $mode"
echo "Tables: ${tables[*]}"

"${cmd[@]}"
