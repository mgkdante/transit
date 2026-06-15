#!/usr/bin/env bash
# Restore-proof drill: download the newest R2 backup, restore it into a local
# throwaway PG16 cluster (slice-h initdb harness pattern), and smoke-assert
# the result. Run from db/ on the dev box (local .env must carry bronze creds
# unless RESTORE_DUMP_FILE points at an already-downloaded dump).
#
# Env knobs:
#   RESTORE_WORKDIR      workdir + socket + pgdata (default /tmp/transit-restore-proof)
#   PG_BIN               PostgreSQL 16 binaries (default /usr/lib/postgresql/16/bin)
#   RESTORE_PORT         cluster port (default 55434)
#   RESTORE_JOBS         pg_restore parallel jobs (default 4)
#   RESTORE_DUMP_FILE    reuse an existing dump file, skip the R2 download
#   RESTORE_MIN_FREE_GB  free-space guard on the workdir parent (default 30)
#   KEEP_RESTORE_WORKDIR=1  leave the cluster running for the gated pytest run
#
# Smoke assertions ride psql -v ON_ERROR_STOP=1: each check divides by a
# boolean cast to int, so a false condition becomes 1/0 and aborts the drill.

set -euo pipefail

RESTORE_WORKDIR="${RESTORE_WORKDIR:-/tmp/transit-restore-proof}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
RESTORE_PORT="${RESTORE_PORT:-55434}"
RESTORE_JOBS="${RESTORE_JOBS:-4}"
RESTORE_MIN_FREE_GB="${RESTORE_MIN_FREE_GB:-30}"
RESTORE_DB_NAME="transit_restore"

for tool in initdb pg_ctl createdb pg_restore psql; do
  if [[ ! -x "$PG_BIN/$tool" ]]; then
    echo "$PG_BIN/$tool not found; install PostgreSQL 16 server/client tools" >&2
    exit 127
  fi
done

started_epoch=$(date +%s)

workdir_parent=$(dirname "$RESTORE_WORKDIR")
mkdir -p "$workdir_parent"
free_gb=$(df -P -k "$workdir_parent" | awk 'NR==2 {print int($4/1048576)}')
if (( free_gb < RESTORE_MIN_FREE_GB )); then
  echo "insufficient free space on $workdir_parent: ${free_gb}GB < ${RESTORE_MIN_FREE_GB}GB" >&2
  exit 1
fi

mkdir -p "$RESTORE_WORKDIR" "$RESTORE_WORKDIR/sock"

cleanup() {
  if [[ "${KEEP_RESTORE_WORKDIR:-0}" == "1" ]]; then
    echo "KEEP_RESTORE_WORKDIR=1: cluster left running at $RESTORE_WORKDIR"
    echo "stop it later with: $PG_BIN/pg_ctl -D $RESTORE_WORKDIR/pgdata stop -m fast"
    return 0
  fi
  if [[ -f "$RESTORE_WORKDIR/pgdata/postmaster.pid" ]]; then
    "$PG_BIN/pg_ctl" -D "$RESTORE_WORKDIR/pgdata" stop -m fast >/dev/null 2>&1 || true
  fi
  rm -rf "$RESTORE_WORKDIR"
}
trap cleanup EXIT

download_started=$(date +%s)
if [[ -n "${RESTORE_DUMP_FILE:-}" ]]; then
  dump_file="$RESTORE_DUMP_FILE"
  echo "reusing existing dump file $dump_file"
else
  dump_file="$RESTORE_WORKDIR/latest.dump"
  echo "downloading newest backup to $dump_file"
  uv run python -m transit_ops.cli download-latest-backup --dest "$dump_file"
fi
download_seconds=$(( $(date +%s) - download_started ))

if [[ ! -f "$dump_file" ]]; then
  echo "dump file $dump_file does not exist" >&2
  exit 1
fi

expected_head=$(uv run alembic heads | awk 'NR==1 {print $1}')
# The head is embedded into smoke SQL below (psql -c does not interpolate
# psql variables), so insist on the safe revision-id alphabet first.
if [[ ! "$expected_head" =~ ^[A-Za-z0-9_]+$ ]]; then
  echo "could not determine a safe repo alembic head (got: '$expected_head')" >&2
  exit 1
fi

restore_started=$(date +%s)
"$PG_BIN/initdb" -D "$RESTORE_WORKDIR/pgdata" -U postgres -A trust >/dev/null
"$PG_BIN/pg_ctl" -D "$RESTORE_WORKDIR/pgdata" -l "$RESTORE_WORKDIR/pg.log" \
  -o "-p $RESTORE_PORT -k $RESTORE_WORKDIR/sock -c listen_addresses='' -c fsync=off -c full_page_writes=off -c shared_buffers=512MB" \
  -w start
"$PG_BIN/createdb" -h "$RESTORE_WORKDIR/sock" -p "$RESTORE_PORT" -U postgres "$RESTORE_DB_NAME"
"$PG_BIN/pg_restore" --no-owner --no-privileges --jobs="$RESTORE_JOBS" \
  -h "$RESTORE_WORKDIR/sock" -p "$RESTORE_PORT" -U postgres \
  -d "$RESTORE_DB_NAME" "$dump_file"
restore_seconds=$(( $(date +%s) - restore_started ))

psql_smoke() {
  "$PG_BIN/psql" -v ON_ERROR_STOP=1 -h "$RESTORE_WORKDIR/sock" -p "$RESTORE_PORT" \
    -U postgres -d "$RESTORE_DB_NAME" -At "$@" >/dev/null
}

smoke_started=$(date +%s)
echo "smoke: alembic head must equal repo head $expected_head"
psql_smoke -c "SELECT 1/(version_num = '$expected_head')::int FROM alembic_version"
echo "smoke: core.providers seeded"
psql_smoke -c "SELECT 1/(count(*) >= 1)::int FROM core.providers"
echo "smoke: gold.vehicle_summary_5m non-empty (365d warm rollups)"
psql_smoke -c "SELECT 1/(count(*) > 0)::int FROM gold.vehicle_summary_5m"
echo "smoke: silver.i3_alerts non-empty"
psql_smoke -c "SELECT 1/(count(*) > 0)::int FROM silver.i3_alerts"
echo "smoke: silver.rt_trip_update_stop_times present but EMPTY (exclusion proof)"
psql_smoke -c "SELECT 1/((SELECT count(*) FROM silver.rt_trip_update_stop_times) = 0)::int"
echo "smoke: postgis extension restored"
psql_smoke -c "SELECT 1/(count(*) = 1)::int FROM pg_extension WHERE extname = 'postgis'"
echo "restored table counts by schema:"
"$PG_BIN/psql" -v ON_ERROR_STOP=1 -h "$RESTORE_WORKDIR/sock" -p "$RESTORE_PORT" \
  -U postgres -d "$RESTORE_DB_NAME" -At \
  -c "SELECT table_schema, count(*) FROM information_schema.tables WHERE table_schema IN ('core','raw','silver','gold') GROUP BY 1 ORDER BY 1"
smoke_seconds=$(( $(date +%s) - smoke_started ))

total_seconds=$(( $(date +%s) - started_epoch ))
echo "RTO download_seconds=$download_seconds restore_seconds=$restore_seconds smoke_seconds=$smoke_seconds total_seconds=$total_seconds"
echo "restore proof green: head $expected_head matched; excluded table restored empty"
echo "run the gated pytest contract against this cluster (needs KEEP_RESTORE_WORKDIR=1):"
echo "  export TRANSIT_RESTORE_PROOF_DATABASE_URL=\"postgresql+psycopg://postgres@:$RESTORE_PORT/$RESTORE_DB_NAME?host=$RESTORE_WORKDIR/sock\""
echo "  uv run pytest tests/test_restore_proof_real_db.py -v"
