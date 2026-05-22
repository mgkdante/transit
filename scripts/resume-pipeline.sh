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

# --- 1. GitHub Actions ---
echo ""
echo "[1/3] Enabling GitHub Actions workflows..."
gh workflow enable "Daily Static Pipeline" --repo "$REPO" 2>&1 && \
  echo "      Daily Static Pipeline: enabled" || \
  echo "      Daily Static Pipeline: already enabled or error (skipping)"

gh workflow enable "Daily Warm Rollups" --repo "$REPO" 2>&1 && \
  echo "      Daily Warm Rollups: enabled" || \
  echo "      Daily Warm Rollups: already enabled or error (skipping)"

# --- 2. Railway env var (remove soft stop) ---
echo ""
echo "[2/3] Setting PIPELINE_PAUSED=false on Railway..."
if command -v railway &>/dev/null; then
  railway variables set PIPELINE_PAUSED=false 2>&1 && \
    echo "      PIPELINE_PAUSED=false set on Railway" || \
    echo "      WARNING: railway variables set failed (trial expired or not linked — set manually in Railway dashboard)"
else
  echo "      WARNING: railway CLI not found — set PIPELINE_PAUSED=false manually in Railway dashboard"
fi

# --- 3. Database compute adapter ---
echo ""
resume_database_compute

echo ""
echo "Done. Pipeline is resumed."
echo "  - GH Actions: enabled (daily static at 06:00 UTC, warm rollups at 07:00 UTC)"
echo "  - Railway worker: PIPELINE_PAUSED=false (cycles every 30s)"
echo "  - Database compute: delegated to adapter '$(database_compute_adapter_name)'"
echo ""
echo "To pause again: bash scripts/pause-pipeline.sh"
