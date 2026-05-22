#!/usr/bin/env bash
set -euo pipefail

CACHE_ROOT="${HOME}/.codex/plugins/cache/workflow-overlord/workflow-overlord"
PLUGIN_ROOT="$(find "$CACHE_ROOT" -mindepth 1 -maxdepth 1 -type d 2>/dev/null | sort -V | tail -n 1)"
[ -n "${PLUGIN_ROOT:-}" ] || {
  echo "[workflow-overlord:codex-wrapper] workflow-overlord plugin cache not found at $CACHE_ROOT" >&2
  exit 2
}

export WORKFLOW_OVERLORD_TOOL=codex
exec bash "$PLUGIN_ROOT/hooks/session-end.sh"
