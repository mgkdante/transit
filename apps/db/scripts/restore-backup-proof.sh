#!/usr/bin/env bash
set -euo pipefail

RESTORE_WORKDIR="${RESTORE_WORKDIR:-/tmp/transit-restore-proof}"
PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
RESTORE_PORT="${RESTORE_PORT:-55434}"
RESTORE_JOBS="${RESTORE_JOBS:-4}"
RESTORE_MIN_FREE_GB="${RESTORE_MIN_FREE_GB:-30}"
KEEP_RESTORE_WORKDIR="${KEEP_RESTORE_WORKDIR:-0}"
RESTORE_DB_NAME="transit_restore"

fail() {
  printf '%s\n' "$2" >&2
  exit "$1"
}

validate_integer() {
  local name="$1" value="${!1}" minimum="$2" maximum="$3"
  [[ "$value" =~ ^[0-9]{1,10}$ ]] || fail 64 "$name must be an integer"
  value=$((10#$value))
  (( value >= minimum && value <= maximum )) || fail 64 "$name must be between $minimum and $maximum"
  printf -v "$name" '%d' "$value"
}

validate_integer RESTORE_PORT 1 65535
validate_integer RESTORE_JOBS 1 2147483647
validate_integer RESTORE_MIN_FREE_GB 0 2147483647
[[ "$KEEP_RESTORE_WORKDIR" == 0 || "$KEEP_RESTORE_WORKDIR" == 1 ]] || fail 64 "KEEP_RESTORE_WORKDIR must be 0 or 1"
[[ "$RESTORE_WORKDIR" == /* ]] || fail 64 "RESTORE_WORKDIR must be absolute"
[[ ! "$RESTORE_WORKDIR" =~ [[:cntrl:]] && "$RESTORE_WORKDIR" != *,* ]] || fail 64 "RESTORE_WORKDIR cannot contain controls or commas"
[[ ! -e "$RESTORE_WORKDIR" && ! -L "$RESTORE_WORKDIR" ]] || fail 64 "RESTORE_WORKDIR already exists; refusing to take ownership"
workdir_parent=$(cd -- "$(dirname -- "$RESTORE_WORKDIR")" && pwd -P)
RESTORE_WORKDIR="$workdir_parent/$(basename -- "$RESTORE_WORKDIR")"
socket_dir="$RESTORE_WORKDIR/sock"
socket_bytes=$(printf '%s' "$socket_dir/.s.PGSQL.$RESTORE_PORT" | wc -c)
(( socket_bytes <= 107 )) || fail 64 "RESTORE_WORKDIR produces a Unix socket path longer than 107 bytes"

for tool in initdb pg_ctl createdb pg_restore psql; do
  [[ -x "$PG_BIN/$tool" ]] || fail 127 "$PG_BIN/$tool not found; install PostgreSQL 16 server/client tools"
done
command -v python3 >/dev/null || fail 127 "python3 is required"
unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGPASSWORD PGPASSFILE \
  PGSERVICE PGSERVICEFILE PGOPTIONS PGSSLMODE PGREQUIRESSL PGTARGETSESSIONATTRS \
  PGSYSCONFDIR PGDATA

started_epoch=$(date +%s)
expected_head="${RESTORE_EXPECTED_REVISION:-}"
if [[ -z "$expected_head" ]]; then
  heads_output=$(uv run alembic heads)
  expected_head=$(printf '%s\n' "$heads_output" | awk 'NF {print $1}')
fi
[[ "$expected_head" =~ ^[A-Za-z0-9_]+$ ]] || fail 64 "expected revision must be one safe revision ID; repository head must be unique"
[[ -z "${RESTORE_DUMP_FILE:-}" || -f "$RESTORE_DUMP_FILE" ]] || fail 64 "RESTORE_DUMP_FILE must name an existing file"
free_gb=$(df -P -k "$workdir_parent" | awk 'NR==2 {print int($4/1048576)}')
[[ "$free_gb" =~ ^[0-9]+$ ]] || fail 1 "could not determine free space on $workdir_parent"
(( free_gb >= RESTORE_MIN_FREE_GB )) || fail 1 "insufficient free space on $workdir_parent: ${free_gb}GB < ${RESTORE_MIN_FREE_GB}GB"

umask 077
mkdir -m 700 -- "$RESTORE_WORKDIR" || fail 1 "RESTORE_WORKDIR could not be created exclusively; no ownership acquired"
workdir_identity=$(stat -c '%d:%i' -- "$RESTORE_WORKDIR")
cluster_started=false

owns_workdir() {
  [[ -d "$RESTORE_WORKDIR" && ! -L "$RESTORE_WORKDIR" \
    && "$(stat -c '%d:%i' -- "$RESTORE_WORKDIR")" == "$workdir_identity" ]]
}

cleanup() {
  local status="$1" running=false restore_url
  trap - EXIT
  trap '' INT TERM
  if ! owns_workdir; then
    fail 70 "restore workdir ownership changed; directory preserved and cleanup refused"
  fi
  if [[ "$KEEP_RESTORE_WORKDIR" == 1 ]]; then
    if [[ "$cluster_started" == true || -f "$RESTORE_WORKDIR/pgdata/postmaster.pid" ]]; then
      if "$PG_BIN/pg_ctl" -D "$RESTORE_WORKDIR/pgdata" status >/dev/null 2>&1; then
        running=true
      fi
    fi
    printf 'KEEP_RESTORE_WORKDIR=1: files preserved at %s; ' "$RESTORE_WORKDIR"
    if "$running"; then
      printf 'cluster is running\n'
      printf 'stop it later with: %q -D %q -w -t 30 stop -m fast\n' "$PG_BIN/pg_ctl" "$RESTORE_WORKDIR/pgdata"
    else
      printf 'cluster is not running\n'
      (( status != 0 )) || status=1
    fi
    if (( status == 0 )); then
      restore_url=$(python3 -c 'import sys; from urllib.parse import urlencode; print(f"postgresql+psycopg://postgres@:{sys.argv[1]}/transit_restore?" + urlencode({"host": sys.argv[2]}))' "$RESTORE_PORT" "$socket_dir")
      printf '  export RESTORE_EXPECTED_REVISION=%q\n' "$expected_head"
      printf '  export TRANSIT_RESTORE_PROOF_DATABASE_URL=%q\n' "$restore_url"
      printf '  uv run pytest tests/test_restore_proof_real_db.py -v\n'
    fi
  else
    if [[ "$cluster_started" == true || -f "$RESTORE_WORKDIR/pgdata/postmaster.pid" ]]; then
      if ! "$PG_BIN/pg_ctl" -D "$RESTORE_WORKDIR/pgdata" -w -t 30 stop -m fast; then
        fail 70 "restore cluster stop failed; owned directory preserved at $RESTORE_WORKDIR"
      fi
      [[ ! -f "$RESTORE_WORKDIR/pgdata/postmaster.pid" ]] || fail 70 "restore cluster PID remains after stop; owned directory preserved"
    fi
    owns_workdir || fail 70 "restore workdir ownership changed; directory preserved"
    rm -rf -- "$RESTORE_WORKDIR"
  fi
  if (( status == 0 )); then
    printf 'restore proof green: source revision %s matched; excluded table restored empty\n' "$expected_head"
  fi
  exit "$status"
}
trap 'cleanup "$?"' EXIT
trap 'exit 130' INT
trap 'exit 143' TERM
mkdir -m 700 -- "$socket_dir" "$RESTORE_WORKDIR/pgdata"

download_started=$(date +%s)
if [[ -n "${RESTORE_DUMP_FILE:-}" ]]; then
  dump_file="$RESTORE_DUMP_FILE"
  printf 'reusing existing dump file %s\n' "$dump_file"
else
  dump_file="$RESTORE_WORKDIR/latest.dump"
  printf 'downloading newest backup to %s\n' "$dump_file"
  uv run python -m transit_ops.cli download-latest-backup --dest "$dump_file"
fi
download_seconds=$(( $(date +%s) - download_started ))
[[ -f "$dump_file" ]] || fail 1 "dump file $dump_file does not exist"

restore_started=$(date +%s)
"$PG_BIN/initdb" -D "$RESTORE_WORKDIR/pgdata" -U postgres -A trust --encoding=UTF8 >/dev/null
socket_config="${socket_dir//\\/\\\\}"
socket_config="${socket_config//\'/\'\'}"
printf "\nport = %s\nlisten_addresses = ''\nunix_socket_directories = '%s'\nshared_buffers = '512MB'\nfsync = on\nfull_page_writes = on\n" \
  "$RESTORE_PORT" "$socket_config" >> "$RESTORE_WORKDIR/pgdata/postgresql.conf"
"$PG_BIN/pg_ctl" -D "$RESTORE_WORKDIR/pgdata" -l "$RESTORE_WORKDIR/pg.log" -w start
cluster_started=true
"$PG_BIN/createdb" -h "$socket_dir" -p "$RESTORE_PORT" -U postgres "$RESTORE_DB_NAME"
"$PG_BIN/pg_restore" --exit-on-error --no-owner --no-privileges --jobs="$RESTORE_JOBS" \
  -h "$socket_dir" -p "$RESTORE_PORT" -U postgres -d "$RESTORE_DB_NAME" "$dump_file"
restore_seconds=$(( $(date +%s) - restore_started ))

psql_smoke() {
  "$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$RESTORE_PORT" \
    -U postgres -d "$RESTORE_DB_NAME" -At "$@" >/dev/null
}

smoke_started=$(date +%s)
printf 'smoke: source revision must equal %s\n' "$expected_head"
psql_smoke -c "SELECT 1/(COUNT(*) = 1 AND COALESCE(MIN(version_num) = '$expected_head', FALSE))::int FROM alembic_version"
psql_smoke -c "SELECT 1/(current_setting('fsync') = 'on' AND current_setting('full_page_writes') = 'on' AND current_setting('server_encoding') = 'UTF8')::int"
echo "smoke: core.providers seeded"
psql_smoke -c "SELECT 1/(count(*) >= 1)::int FROM core.providers"
echo "smoke: gold.trip_delay_summary_5m non-empty"
psql_smoke -c "SELECT 1/(count(*) > 0)::int FROM gold.trip_delay_summary_5m"
echo "smoke: silver.i3_alerts non-empty"
psql_smoke -c "SELECT 1/(count(*) > 0)::int FROM silver.i3_alerts"
echo "smoke: silver.rt_trip_update_stop_times present but EMPTY"
psql_smoke -c "SELECT 1/((SELECT count(*) FROM silver.rt_trip_update_stop_times) = 0)::int"
echo "smoke: postgis extension restored"
psql_smoke -c "SELECT 1/(count(*) = 1)::int FROM pg_extension WHERE extname = 'postgis'"
echo "restored table counts by schema:"
"$PG_BIN/psql" -X -v ON_ERROR_STOP=1 -h "$socket_dir" -p "$RESTORE_PORT" \
  -U postgres -d "$RESTORE_DB_NAME" -At \
  -c "SELECT table_schema, count(*) FROM information_schema.tables WHERE table_schema IN ('core','raw','silver','gold') GROUP BY 1 ORDER BY 1"
smoke_seconds=$(( $(date +%s) - smoke_started ))
total_seconds=$(( $(date +%s) - started_epoch ))
echo "RTO download_seconds=$download_seconds restore_seconds=$restore_seconds smoke_seconds=$smoke_seconds total_seconds=$total_seconds"
