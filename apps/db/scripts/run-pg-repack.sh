#!/usr/bin/env bash
# Run a conservative pg_repack maintenance pass against the configured database.
#
# slice-9.1.1m: the previous DEFAULT_TABLES named silver.trip_updates /
# silver.trip_update_stop_time_updates / silver.vehicle_positions — all DROPPED by
# migration 0014, so every live/dry run failed with "relations do not exist"
# (exit 21). The list below is the 7 current churn tables, mirroring the
# canonical sets in maintenance.py: REALTIME_SILVER_TABLES minus the 29GB
# silver.rt_trip_update_stop_times, plus the gold.latest_* live tables and
# gold.trip_delay_summary_5m (the only live warm rollup). The two hot gold.fact_*
# tables are carved out of the CI default (see below); the dead
# gold.vehicle/occupancy_summary_5m sinks were dropped in migration 0061.
#
# silver.rt_trip_update_stop_times (~29GB, ~252M largely-LIVE rows at 14d
# retention) is DELIBERATELY EXCLUDED from the CI default: a weekly WAN-attached
# full-table rewrite of it is a multi-hour, 2x-disk job whose value post-burndown
# is low. It is repacked from inside the postgres container via the on-VM runbook,
# or via manual dispatch with an explicit PG_REPACK_TABLES.
#
# 2026-06-22: gold.fact_vehicle_snapshot + gold.fact_trip_delay_snapshot are ALSO
# excluded from the CI default. They are the highest-churn gold facts (the
# realtime worker appends to them every ~30s), and pg_repack's brief ACCESS
# EXCLUSIVE swap at the end of a WAN-orchestrated run repeatedly lost the lock
# race against the live writes (--wait-timeout 60 --no-kill-backend), dying
# mid-swap and leaving orphaned repack.log_* tables + repack_trigger triggers
# behind — a 6.7GB disk leak + a write-tax on the two hottest tables (cleaned
# 2026-06-22 via DROP EXTENSION pg_repack CASCADE). Repack these on-box via the
# on-VM runbook (low lock latency, no WAN), or via manual dispatch with an
# explicit PG_REPACK_TABLES during a quiet window. The append+daily-prune bloat
# on these is modest and autovacuum-managed between runbook passes.

set -euo pipefail

DEFAULT_TABLES=$'silver.rt_trip_updates\nsilver.rt_vehicle_positions\nsilver.rt_entities\nsilver.rt_feed_snapshots\ngold.latest_vehicle_snapshot\ngold.latest_trip_delay_snapshot\ngold.trip_delay_summary_5m'

if [[ -z "${DATABASE_URL:-}" ]]; then
  echo "DATABASE_URL is required" >&2
  exit 2
fi

if ! command -v pg_repack >/dev/null 2>&1; then
  echo "pg_repack command not found; install the pg_repack client before running this guardrail" >&2
  exit 127
fi

# pg_repack's CREATE INDEX phase can spawn parallel maintenance workers that each
# allocate a DSM segment; on the small-/dev/shm A1 VM that reproduces the 0017
# parallel-VACUUM crash ("could not resize shared memory segment"). Force serial
# index builds for every repack connection. Caller may override PGOPTIONS.
export PGOPTIONS="${PGOPTIONS:--c max_parallel_maintenance_workers=0}"

PG_REPACK_DRY_RUN="${PG_REPACK_DRY_RUN:-true}"
PG_REPACK_JOBS="${PG_REPACK_JOBS:-2}"
PG_REPACK_WAIT_TIMEOUT="${PG_REPACK_WAIT_TIMEOUT:-60}"
PG_REPACK_TABLES="${PG_REPACK_TABLES:-$DEFAULT_TABLES}"
PG_REPACK_SIZE_REPORT="${PG_REPACK_SIZE_REPORT:-}"

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

# --- Before/after bloat report -------------------------------------------------
# Captures pg_total_relation_size for every target table into the report file so
# a real execute run leaves an auditable receipt of reclaimed bytes. The whole
# feature is skipped (with a notice) when psql is unavailable or no report path is
# configured — the guardrail itself must never fail just because reporting can't
# run.
size_report_enabled=false
if [[ -n "$PG_REPACK_SIZE_REPORT" ]]; then
  if command -v psql >/dev/null 2>&1; then
    size_report_enabled=true
  else
    echo "psql not found; skipping before/after size report capture" >&2
  fi
else
  echo "PG_REPACK_SIZE_REPORT unset; skipping before/after size report capture"
fi

capture_sizes() {
  local label="$1"
  {
    echo "== ${label} =="
    for table in "${tables[@]}"; do
      psql "$DATABASE_URL" -X -q -At -c \
        "SELECT '${table}', COALESCE(pg_total_relation_size(to_regclass('${table}'))::text, 'MISSING'), COALESCE(pg_size_pretty(pg_total_relation_size(to_regclass('${table}'))), '-')"
    done
  } >>"$PG_REPACK_SIZE_REPORT"
}

# Orphaned repack objects (repack.log_* tables + repack_trigger triggers) left by
# a mid-run disconnect silently tax every write on hot tables and grow disk, so a
# leftover count > 0 after an execute run must fail LOUD with the cleanup hint.
count_repack_leftovers() {
  psql "$DATABASE_URL" -X -q -At -c \
    "SELECT (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'repack' AND c.relkind = 'r' AND c.relname LIKE 'log_%') + (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname LIKE '%repack_trigger%')" \
    2>/dev/null || true
}

echo "Running pg_repack guardrail against configured DATABASE_URL."
echo "Mode: $mode"
echo "Tables: ${tables[*]}"

if [[ "$size_report_enabled" == true ]]; then
  capture_sizes "before"
fi

# Run the repack WITHOUT aborting on a non-zero exit. A mid-run disconnect (the
# exact failure that leaves orphaned repack.log_* tables / repack_trigger
# triggers behind) returns non-zero, and under `set -euo pipefail` that would
# abort the script before the post-run leftover sweep below could ever run —
# i.e. the cleanup detection would be skipped in precisely the scenario it
# exists to catch. Capture the exit code instead and run the after-size capture
# + leftover detection UNCONDITIONALLY, then surface the repack failure (or a
# dedicated leftover code) on exit.
set +e
"${cmd[@]}"
repack_rc=$?
set -e

if [[ "$mode" == "execute" ]]; then
  if [[ "$size_report_enabled" == true ]]; then
    capture_sizes "after"
  fi
  if command -v psql >/dev/null 2>&1; then
    leftovers="$(count_repack_leftovers)"
    if [[ "${leftovers:-0}" -gt 0 ]]; then
      echo "ERROR: detected ${leftovers} orphaned repack objects (repack.log_* tables and/or repack_trigger triggers)." >&2
      echo "These tax every write on hot tables — clean them with:" >&2
      echo "  DROP EXTENSION pg_repack CASCADE; CREATE EXTENSION pg_repack;" >&2
      exit 3
    fi
  fi
fi

exit "$repack_rc"
