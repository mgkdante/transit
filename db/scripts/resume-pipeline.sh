#!/usr/bin/env bash
# resume-pipeline.sh
# Restores all automated pipeline activity:
#   - Re-enables daily GH Actions workflows
#   - Resumes the Compose worker through infra/pipeline-control.sh
#   - Leaves Postgres running; there is no external database compute API
#
# Usage:
#   bash scripts/resume-pipeline.sh

set -euo pipefail

REPO="mgkdante/transit"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Resuming pipeline..."

scheduler_ok=true
worker_control_ok=true

# --- 1. GitHub Actions ---
echo ""
echo "[1/2] Enabling GitHub Actions schedules..."
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

# --- 2. Worker service ---
echo ""
echo "[2/2] Starting local Compose worker..."
if bash "$SCRIPT_DIR/../infra/pipeline-control.sh" resume worker; then
  echo "      Worker service resumed via Compose helper"
else
  echo "      ERROR: worker service resume failed"
  worker_control_ok=false
fi

echo ""
if $scheduler_ok && $worker_control_ok; then
  echo "Done. Pipeline is resumed."
  echo "  - GH Actions: enabled (daily static at 06:00 UTC, warm rollups at 07:00 UTC)"
  echo "  - Worker service: resumed via Compose helper"
  echo "  - Database: already running; no external compute API is used for Oracle/Compose Postgres"
  exit_code=0
else
  echo "Pipeline resume completed with issues."
  if $scheduler_ok; then
    echo "  - GH Actions: enabled"
  else
    echo "  - GH Actions: one or more workflow enables failed"
  fi
  if $worker_control_ok; then
    echo "  - Worker service: resumed via Compose helper"
  else
    echo "  - Worker service: resume failed"
  fi
  echo "  - Database: already running; no external compute API is used for Oracle/Compose Postgres"
  exit_code=1
fi
echo ""
echo "To pause again: bash scripts/pause-pipeline.sh"
exit "$exit_code"
