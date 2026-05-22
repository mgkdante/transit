#!/usr/bin/env bash
# pause-pipeline.sh
# Stops all automated pipeline activity:
#   - Disables daily GH Actions workflows
#   - Sets PIPELINE_PAUSED=true on Railway (worker idles instead of cycling)
#   - Hands database compute off to the configured database adapter
#
# Usage:
#   bash scripts/pause-pipeline.sh
#
# For database adapter actions, export the adapter-specific credentials first.

set -euo pipefail

REPO="mgkdante/transit"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Adapter contract lives at scripts/lib/database-compute.sh.
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/database-compute.sh"

echo "==> Pausing pipeline..."

scheduler_ok=true
worker_flag_ok=true
database_compute_ok=true

# --- 1. GitHub Actions ---
echo ""
echo "[1/3] Disabling GitHub Actions workflows..."
if gh workflow disable "Daily Static Pipeline" --repo "$REPO" 2>&1; then
  echo "      Daily Static Pipeline: disabled"
else
  echo "      ERROR: failed to disable Daily Static Pipeline"
  scheduler_ok=false
fi

if gh workflow disable "Daily Warm Rollups" --repo "$REPO" 2>&1; then
  echo "      Daily Warm Rollups: disabled"
else
  echo "      ERROR: failed to disable Daily Warm Rollups"
  scheduler_ok=false
fi

# --- 2. Railway env var (soft stop) ---
echo ""
echo "[2/3] Setting PIPELINE_PAUSED=true on Railway (soft stop)..."
if command -v railway &>/dev/null; then
  if railway variables set PIPELINE_PAUSED=true 2>&1; then
    echo "      PIPELINE_PAUSED=true set on Railway"
  else
    echo "      WARNING: railway variables set failed (trial expired or not linked — set manually in Railway dashboard)"
    worker_flag_ok=false
  fi
else
  echo "      WARNING: railway CLI not found — set PIPELINE_PAUSED=true manually in Railway dashboard"
  worker_flag_ok=false
fi

# --- 3. Database compute adapter ---
echo ""
if ! pause_database_compute; then
  database_compute_ok=false
fi

echo ""
if $scheduler_ok && $worker_flag_ok && $database_compute_ok; then
  echo "Done. Pipeline is paused."
  echo "  - GH Actions: disabled (no daily static or warm rollup runs)"
  echo "  - Railway worker: PIPELINE_PAUSED=true (idles on next start)"
  echo "  - Database compute: delegated to adapter '$(database_compute_adapter_name)'"
  exit_code=0
else
  echo "Pipeline pause completed with issues."
  if $scheduler_ok; then
    echo "  - GH Actions: disabled"
  else
    echo "  - GH Actions: one or more workflow disables failed"
  fi
  if $worker_flag_ok; then
    echo "  - Railway worker: PIPELINE_PAUSED=true"
  else
    echo "  - Railway worker: PIPELINE_PAUSED=true not confirmed"
  fi
  if $database_compute_ok; then
    echo "  - Database compute: adapter '$(database_compute_adapter_name)' completed"
  else
    echo "  - Database compute: adapter '$(database_compute_adapter_name)' reported failure"
  fi
  exit_code=1
fi
echo ""
echo "To resume: bash scripts/resume-pipeline.sh"
exit "$exit_code"
