#!/usr/bin/env bash
# resume-pipeline.sh
# Restores all automated pipeline activity:
#   - Re-enables daily GH Actions workflows
#   - Sets PIPELINE_PAUSED=false on Railway (worker resumes cycling)
#   - Hands database compute off to the configured database adapter
#
# Usage:
#   bash scripts/resume-pipeline.sh
#
# For database adapter actions, export the adapter-specific credentials first.

set -euo pipefail

REPO="mgkdante/transit"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Adapter contract lives at scripts/lib/database-compute.sh.
# shellcheck source=/dev/null
source "$SCRIPT_DIR/lib/database-compute.sh"

echo "==> Resuming pipeline..."

scheduler_ok=true
worker_flag_ok=true
database_compute_ok=true

# --- 1. GitHub Actions ---
echo ""
echo "[1/3] Enabling GitHub Actions workflows..."
if gh workflow enable "Daily Static Pipeline" --repo "$REPO" 2>&1; then
  echo "      Daily Static Pipeline: enabled"
else
  echo "      ERROR: failed to enable Daily Static Pipeline"
  scheduler_ok=false
fi

if gh workflow enable "Daily Warm Rollups" --repo "$REPO" 2>&1; then
  echo "      Daily Warm Rollups: enabled"
else
  echo "      ERROR: failed to enable Daily Warm Rollups"
  scheduler_ok=false
fi

# --- 2. Railway env var (remove soft stop) ---
echo ""
echo "[2/3] Setting PIPELINE_PAUSED=false on Railway..."
if command -v railway &>/dev/null; then
  if railway variables set PIPELINE_PAUSED=false 2>&1; then
    echo "      PIPELINE_PAUSED=false set on Railway"
  else
    echo "      WARNING: railway variables set failed (trial expired or not linked — set manually in Railway dashboard)"
    worker_flag_ok=false
  fi
else
  echo "      WARNING: railway CLI not found — set PIPELINE_PAUSED=false manually in Railway dashboard"
  worker_flag_ok=false
fi

# --- 3. Database compute adapter ---
echo ""
if ! resume_database_compute; then
  database_compute_ok=false
fi

echo ""
if $scheduler_ok && $worker_flag_ok && $database_compute_ok; then
  echo "Done. Pipeline is resumed."
  echo "  - GH Actions: enabled (daily static at 06:00 UTC, warm rollups at 07:00 UTC)"
  echo "  - Railway worker: PIPELINE_PAUSED=false (cycles every 30s)"
  echo "  - Database compute: delegated to adapter '$(database_compute_adapter_name)'"
  exit_code=0
else
  echo "Pipeline resume completed with issues."
  if $scheduler_ok; then
    echo "  - GH Actions: enabled"
  else
    echo "  - GH Actions: one or more workflow enables failed"
  fi
  if $worker_flag_ok; then
    echo "  - Railway worker: PIPELINE_PAUSED=false"
  else
    echo "  - Railway worker: PIPELINE_PAUSED=false not confirmed"
  fi
  if $database_compute_ok; then
    echo "  - Database compute: adapter '$(database_compute_adapter_name)' completed"
  else
    echo "  - Database compute: adapter '$(database_compute_adapter_name)' reported failure"
  fi
  exit_code=1
fi
echo ""
echo "To pause again: bash scripts/pause-pipeline.sh"
exit "$exit_code"
