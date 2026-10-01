#!/usr/bin/env bash
# Keep --no-deps to avoid recreating PostgreSQL; -T supports cron without a TTY.

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
