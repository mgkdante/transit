#!/usr/bin/env bash
# pause-pipeline.sh
# Stops all automated pipeline activity:
#   - Disables daily GH Actions workflows
#   - Pauses the Compose worker through infra/pipeline-control.sh
#   - Leaves Postgres running; there is no external database compute API
#
# Usage:
#   bash scripts/pause-pipeline.sh

set -euo pipefail

REPO="mgkdante/transit"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Pausing pipeline..."

scheduler_ok=true
worker_control_ok=true

# --- 1. GitHub Actions ---
echo ""
echo "[1/2] Disabling GitHub Actions schedules..."
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

# --- 2. Worker service ---
echo ""
echo "[2/2] Stopping local Compose worker..."
if bash "$SCRIPT_DIR/../infra/pipeline-control.sh" pause worker; then
  echo "      Worker service paused via Compose helper"
else
  echo "      ERROR: worker service pause failed"
  worker_control_ok=false
fi

echo ""
if $scheduler_ok && $worker_control_ok; then
  echo "Done. Pipeline is paused."
  echo "  - GH Actions: disabled (no daily static or warm rollup runs)"
  echo "  - Worker service: paused via Compose helper"
  echo "  - Database: left running; no external compute API is used for Oracle/Compose Postgres"
  exit_code=0
else
  echo "Pipeline pause completed with issues."
  if $scheduler_ok; then
    echo "  - GH Actions: disabled"
  else
    echo "  - GH Actions: one or more workflow disables failed"
  fi
  if $worker_control_ok; then
    echo "  - Worker service: paused via Compose helper"
  else
    echo "  - Worker service: pause failed"
  fi
  echo "  - Database: left running; no external compute API is used for Oracle/Compose Postgres"
  exit_code=1
fi
echo ""
echo "To resume: bash scripts/resume-pipeline.sh"
exit "$exit_code"
