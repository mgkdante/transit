#!/usr/bin/env bash
# resume-pipeline.sh
# Restores all automated pipeline activity:
#   - Re-enables daily GH Actions workflows
#   - Sets PIPELINE_PAUSED=false on Railway (worker resumes cycling)
#   - Redeploys the Railway realtime-worker (requires RAILWAY_TOKEN)
#
# Usage:
#   bash scripts/resume-pipeline.sh
#
# For Railway compute restart, export your personal API token first:
#   export RAILWAY_TOKEN=<token from https://railway.app/account/tokens>

set -euo pipefail

REPO="mgkdante/transit"
RAILWAY_SERVICE_ID="94361a64-992d-4647-b48f-94cba03f17c3"
RAILWAY_ENV_ID="2c724b2d-7525-4f28-8b08-356247612120"
RAILWAY_API="https://backboard.railway.app/graphql/v2"

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

# --- 3. Railway service redeploy (restart compute) ---
echo ""
echo "[3/3] Redeploying Railway realtime-worker service..."
if [[ -z "${RAILWAY_TOKEN:-}" ]]; then
  echo "      RAILWAY_TOKEN not set — skipping redeploy."
  echo "      To start Railway compute: export RAILWAY_TOKEN=<your token> and re-run,"
  echo "      or trigger a redeploy manually at https://railway.app"
else
  RESPONSE=$(curl -s -X POST "$RAILWAY_API" \
    -H "Authorization: Bearer $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"mutation { serviceInstanceRedeploy(environmentId: \\\"$RAILWAY_ENV_ID\\\", serviceId: \\\"$RAILWAY_SERVICE_ID\\\") }\"}" \
  )
  if echo "$RESPONSE" | grep -q '"serviceInstanceRedeploy":true'; then
    echo "      Railway realtime-worker: redeployed"
  else
    echo "      WARNING: redeploy response: $RESPONSE"
    echo "      Trigger a redeploy manually at https://railway.app if needed."
  fi
fi

echo ""
echo "Done. Pipeline is resumed."
echo "  - GH Actions: enabled (daily static at 06:00 UTC, warm rollups at 07:00 UTC)"
echo "  - Railway worker: PIPELINE_PAUSED=false (cycles every 30s)"
echo "  - Railway compute: redeployed if RAILWAY_TOKEN was set, otherwise redeploy manually"
echo ""
echo "To pause again: bash scripts/pause-pipeline.sh"
