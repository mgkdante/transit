#!/usr/bin/env bash
set -euo pipefail

ACTION="${1:-}"
TARGET="${2:-}"
COMPOSE_ENV_FILE="${COMPOSE_ENV_FILE:-.env}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.yml}"

usage() {
  echo "Usage: bash infra/pipeline-control.sh pause|resume worker" >&2
}

compose() {
  docker compose --env-file "$COMPOSE_ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

case "$ACTION:$TARGET" in
  pause:worker)
    echo "[2/3] Pausing Compose worker service..."
    compose stop worker
    ;;
  resume:worker)
    echo "[2/3] Resuming Compose worker service..."
    compose up -d worker
    ;;
  *)
    usage
    exit 2
    ;;
esac
