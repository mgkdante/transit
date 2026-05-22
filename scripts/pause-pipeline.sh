#!/usr/bin/env bash
# pause-pipeline.sh
# Stops all automated pipeline activity:
#   - Disables daily GH Actions workflows
#   - Sets PIPELINE_PAUSED=true on Railway (worker idles instead of cycling)
#   - Suspends the Railway realtime-worker compute (requires RAILWAY_TOKEN)
#   - Suspends the Neon compute endpoint (requires NEON_API_KEY)
#
# Usage:
#   bash scripts/pause-pipeline.sh
#
# For Railway compute suspension, export your personal API token first:
#   export RAILWAY_TOKEN=<token from https://railway.app/account/tokens>
#
# For Neon compute suspension, set NEON_API_KEY in .env or export it:
#   export NEON_API_KEY=<key from https://console.neon.tech/app/settings/api-keys>

set -euo pipefail

REPO="mgkdante/transit"
RAILWAY_SERVICE_ID="94361a64-992d-4647-b48f-94cba03f17c3"
RAILWAY_ENV_ID="2c724b2d-7525-4f28-8b08-356247612120"
RAILWAY_API="https://backboard.railway.app/graphql/v2"
NEON_PROJECT_ID="lively-glitter-51788896"
NEON_ENDPOINT_ID="ep-solitary-violet-anb7nj8e"
NEON_API="https://console.neon.tech/api/v2"

# Load NEON_API_KEY from .env if not already set
if [[ -z "${NEON_API_KEY:-}" ]] && [[ -f "$(dirname "$0")/../.env" ]]; then
  NEON_API_KEY=$(grep '^NEON_API_KEY=' "$(dirname "$0")/../.env" | cut -d= -f2-)
fi

echo "==> Pausing pipeline..."

# --- 1. GitHub Actions ---
echo ""
echo "[1/4] Disabling GitHub Actions workflows..."
gh workflow disable "Daily Static Pipeline" --repo "$REPO" 2>&1 && \
  echo "      Daily Static Pipeline: disabled" || \
  echo "      Daily Static Pipeline: already disabled or error (skipping)"

gh workflow disable "Daily Warm Rollups" --repo "$REPO" 2>&1 && \
  echo "      Daily Warm Rollups: disabled" || \
  echo "      Daily Warm Rollups: already disabled or error (skipping)"

# --- 2. Railway env var (soft stop) ---
echo ""
echo "[2/4] Setting PIPELINE_PAUSED=true on Railway (soft stop)..."
if command -v railway &>/dev/null; then
  railway variables set PIPELINE_PAUSED=true 2>&1 && \
    echo "      PIPELINE_PAUSED=true set on Railway" || \
    echo "      WARNING: railway variables set failed (trial expired or not linked — set manually in Railway dashboard)"
else
  echo "      WARNING: railway CLI not found — set PIPELINE_PAUSED=true manually in Railway dashboard"
fi

# --- 3. Railway service suspension (hard stop, stops compute billing) ---
echo ""
echo "[3/4] Suspending Railway realtime-worker service (hard stop)..."
if [[ -z "${RAILWAY_TOKEN:-}" ]]; then
  echo "      RAILWAY_TOKEN not set — skipping compute suspension."
  echo "      To stop Railway compute billing: export RAILWAY_TOKEN=<your token> and re-run,"
  echo "      or pause the service manually at https://railway.app"
else
  RESPONSE=$(curl -s -X POST "$RAILWAY_API" \
    -H "Authorization: Bearer $RAILWAY_TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"query\": \"mutation { serviceInstanceSuspend(environmentId: \\\"$RAILWAY_ENV_ID\\\", serviceId: \\\"$RAILWAY_SERVICE_ID\\\") }\"}" \
  )
  if echo "$RESPONSE" | grep -q '"serviceInstanceSuspend":true'; then
    echo "      Railway realtime-worker: suspended"
  else
    echo "      WARNING: suspension response: $RESPONSE"
    echo "      Pause the service manually at https://railway.app if needed."
  fi
fi

# --- 4. Neon compute suspension ---
echo ""
echo "[4/4] Suspending Neon compute endpoint..."
if [[ -z "${NEON_API_KEY:-}" ]]; then
  echo "      NEON_API_KEY not set — skipping compute suspension."
  echo "      To stop Neon compute billing: set NEON_API_KEY in .env or export it and re-run,"
  echo "      or suspend the endpoint manually at https://console.neon.tech"
else
  RESPONSE=$(curl -s -X POST "$NEON_API/projects/$NEON_PROJECT_ID/endpoints/$NEON_ENDPOINT_ID/suspend" \
    -H "Authorization: Bearer $NEON_API_KEY" \
    -H "Content-Type: application/json" \
  )
  if echo "$RESPONSE" | grep -q '"pending_state":"idle"\|"current_state":"idle"'; then
    echo "      Neon compute: suspended"
  elif echo "$RESPONSE" | grep -q '"endpoint"'; then
    echo "      Neon compute: suspend requested (may take a few seconds)"
  else
    echo "      WARNING: suspension response: $RESPONSE"
    echo "      Suspend the endpoint manually at https://console.neon.tech if needed."
  fi
fi

echo ""
echo "Done. Pipeline is paused."
echo "  - GH Actions: disabled (no daily static or warm rollup runs)"
echo "  - Railway worker: PIPELINE_PAUSED=true (idles on next start)"
echo "  - Railway compute: suspended if RAILWAY_TOKEN was set, otherwise pause manually"
echo "  - Neon compute: suspended if NEON_API_KEY was set, otherwise suspend manually"
echo ""
echo "To resume: bash scripts/resume-pipeline.sh"
