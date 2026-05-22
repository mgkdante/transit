#!/usr/bin/env bash

DATABASE_COMPUTE_ADAPTER_NAME="neon"
NEON_API_BASE="${NEON_API_BASE:-https://console.neon.tech/api/v2}"

_neon_api_request() {
  local method="$1"
  local url="$2"

  curl --fail --silent --show-error \
    --request "$method" \
    --url "$url" \
    --header "Accept: application/json" \
    --header "Authorization: Bearer $NEON_API_KEY"
}

pause_database_compute() {
  echo "[3/3] Handing database compute to adapter '$(database_compute_adapter_name)'..."

  if [[ -z "${NEON_API_KEY:-}" ]]; then
    echo "      Database adapter credentials not set — skipping database compute API call."
    echo "      This adapter relies on Neon scale-to-zero, so compute should idle after inactivity."
    echo "      Inspect compute status manually in the Neon console if you need confirmation."
    return 0
  fi

  if [[ -z "${NEON_PROJECT_ID:-}" || -z "${NEON_ENDPOINT_ID:-}" ]]; then
    echo "      Database adapter identifiers not set — skipping database compute API call."
    echo "      Set the adapter-specific project and endpoint identifiers to enable API-based status checks."
    return 0
  fi

  if RESPONSE="$(_neon_api_request GET "$NEON_API_BASE/projects/$NEON_PROJECT_ID/endpoints" 2>&1)"; then
    if grep -q "\"id\":\"$NEON_ENDPOINT_ID\"" <<<"$RESPONSE" || grep -q "\"id\": \"$NEON_ENDPOINT_ID\"" <<<"$RESPONSE"; then
      echo "      Database adapter endpoint $NEON_ENDPOINT_ID is registered; compute will idle after inactivity."
    else
      echo "      WARNING: database adapter could not find endpoint $NEON_ENDPOINT_ID in project $NEON_PROJECT_ID."
      echo "      Confirm the adapter identifiers in the Neon console."
    fi
  else
    echo "      WARNING: database adapter status check failed: $RESPONSE"
    echo "      Confirm the adapter credentials and identifiers in the Neon console."
  fi
}

resume_database_compute() {
  echo "[3/3] Handing database compute to adapter '$(database_compute_adapter_name)'..."

  if [[ -z "${NEON_API_KEY:-}" ]]; then
    echo "      Database adapter credentials not set — skipping database compute restart."
    echo "      The next database connection should wake compute automatically."
    return 0
  fi

  if [[ -z "${NEON_PROJECT_ID:-}" || -z "${NEON_ENDPOINT_ID:-}" ]]; then
    echo "      Database adapter identifiers not set — skipping database compute restart."
    echo "      Set the adapter-specific project and endpoint identifiers to enable API-based restarts."
    return 0
  fi

  if RESPONSE="$(_neon_api_request POST "$NEON_API_BASE/projects/$NEON_PROJECT_ID/endpoints/$NEON_ENDPOINT_ID/restart" 2>&1)"; then
    echo "      Database adapter restart request submitted."
  else
    echo "      WARNING: database adapter restart failed: $RESPONSE"
    echo "      The next database connection may still wake compute automatically."
    return 1
  fi
}
