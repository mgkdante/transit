#!/usr/bin/env bash
# Nightly logical Postgres backup: the worker image streams pg_dump straight
# to Bronze R2 (transit_ops.cli backup-database). Run from db/ on the VM.
#
# Cron line (VM crontab, UTC — clears 06:00 static, 07:00 rollups, Sun 08:00
# pg_repack; confirm `timedatectl` says UTC before installing):
#   30 9 * * * cd <VM_REPO_PATH>/db && bash scripts/backup-postgres.sh >> /var/log/transit-backup.log 2>&1
#
# The compose invocation MUST keep --no-deps (a bare `docker compose run`
# recreates the postgres service mid-flight) and -T (cron has no TTY).
# `compose run worker` inherits the worker env_file plus DATABASE_URL from
# docker-compose.yml, so no extra environment is needed here.

set -euo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "docker command not found; install docker before running backups" >&2
  exit 127
fi

BACKUP_LOCK_FILE="${BACKUP_LOCK_FILE:-/tmp/transit-backup.lock}"
COMPOSE_PROJECT="${COMPOSE_PROJECT:-transit}"

exec 9>"$BACKUP_LOCK_FILE"
if ! flock -n 9; then
  echo "another transit backup is already running; skipping" >&2
  exit 75
fi

echo "transit backup start $(date -u +%Y-%m-%dT%H:%M:%SZ)"

status=0
docker compose -p "$COMPOSE_PROJECT" run --rm --no-deps -T worker backup-database || status=$?

echo "transit backup finish $(date -u +%Y-%m-%dT%H:%M:%SZ) exit=$status"
exit "$status"
