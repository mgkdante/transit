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

# --- 1. GitHub Actions ---
echo ""
echo "[1/3] Disabling GitHub Actions workflows..."
gh workflow disable "Daily Static Pipeline" --repo "$REPO" 2>&1 && \
  echo "      Daily Static Pipeline: disabled" || \
  echo "      Daily Static Pipeline: already disabled or error (skipping)"

gh workflow disable "Daily Warm Rollups" --repo "$REPO" 2>&1 && \
  echo "      Daily Warm Rollups: disabled" || \
  echo "      Daily Warm Rollups: already disabled or error (skipping)"

# --- 2. Railway env var (soft stop) ---
echo ""
echo "[2/3] Setting PIPELINE_PAUSED=true on Railway (soft stop)..."
if command -v railway &>/dev/null; then
  railway variables set PIPELINE_PAUSED=true 2>&1 && \
    echo "      PIPELINE_PAUSED=true set on Railway" || \
    echo "      WARNING: railway variables set failed (trial expired or not linked — set manually in Railway dashboard)"
else
  echo "      WARNING: railway CLI not found — set PIPELINE_PAUSED=true manually in Railway dashboard"
fi

# --- 3. Database compute adapter ---
echo ""
pause_database_compute

echo ""
echo "Done. Pipeline is paused."
echo "  - GH Actions: disabled (no daily static or warm rollup runs)"
echo "  - Railway worker: PIPELINE_PAUSED=true (idles on next start)"
echo "  - Database compute: delegated to adapter '$(database_compute_adapter_name)'"
echo ""
echo "To resume: bash scripts/resume-pipeline.sh"
