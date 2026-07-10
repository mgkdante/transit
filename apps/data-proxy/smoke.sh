#!/usr/bin/env bash
# Prod smoke for the transit-data-proxy worker (slice-9.1.1p).
#
# This script is the slice's failing prod test: it stays red (curl exit 6,
# could not resolve transit.yesid.dev) until the operator creates the proxied
# AAAA record and deploys the worker; exit 0 proves the canonical URLs baked
# into the published manifest resolve end to end, while data.yesid.dev keeps
# working untouched as the fallback origin.
#
# Usage: bash apps/data-proxy/smoke.sh
#   CANONICAL_BASE / FALLBACK_BASE / APEX_BASE override the probed hosts.
set -euo pipefail

CANONICAL_BASE="${CANONICAL_BASE:-https://transit.yesid.dev/data}"
FALLBACK_BASE="${FALLBACK_BASE:-https://data.yesid.dev}"
MAX_TIME=15

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

headers_of() {
  # -I HEAD probe; CRLF stripped so greps can anchor on line ends.
  curl -fsSI --max-time "$MAX_TIME" "$1" | tr -d '\r'
}

status_of() {
  curl -s -o /dev/null --max-time "$MAX_TIME" -w '%{http_code}' "$@"
}

assert_object() {
  # $2 is an EXTENDED-regex alternation: objects only pick up a new publish-time
  # Cache-Control when their CONTENT next rewrites (publish is hash-guarded), so
  # during a header rollout prod legitimately serves old|new until the next
  # rewrite of that object (daily for historic aggregates; edition-flip for static).
  local url="$1" cache_control="$2" headers
  headers="$(headers_of "$url")" || fail "$url did not return 2xx headers"
  grep -qi '^content-type: application/json' <<<"$headers" \
    || fail "$url content-type is not application/json"
  grep -Eqi "^cache-control: (${cache_control})$" <<<"$headers" \
    || fail "$url cache-control != '${cache_control}'"
  ok "$url -> 200 application/json '${cache_control}'"
}

# --- canonical host: manifest + all three tiers + provenance (hard asserts;
# --- historic went publicly live 2026-06-10, values from snapshots/storage.py) ---
assert_object "$CANONICAL_BASE/v1/stm/manifest.json" "public, max-age=30"
curl -fsS --max-time "$MAX_TIME" "$CANONICAL_BASE/v1/stm/manifest.json" \
  | grep -q '"provider":"stm"' || fail "manifest body missing \"provider\":\"stm\""
ok "manifest body carries provider stm"

assert_object "$CANONICAL_BASE/v1/stm/live/vehicles.json" "public, max-age=30"
assert_object "$CANONICAL_BASE/v1/stm/static/routes_index.json" "public, max-age=86400, stale-while-revalidate=86400|public, max-age=604800"
assert_object "$CANONICAL_BASE/v1/stm/historic/network_trend.json" "public, max-age=3600, stale-while-revalidate=86400|public, max-age=86400"
assert_object "$CANONICAL_BASE/v1/stm/provenance.json" "public, max-age=3600, stale-while-revalidate=86400|public, max-age=86400"

# --- negatives: clean 404/405, and errors are never cacheable ---
[ "$(status_of "$CANONICAL_BASE/v1/stm/definitely-missing.json")" = "404" ] \
  || fail "missing key must return 404"
ok "missing key -> 404"

curl -sI --max-time "$MAX_TIME" "$CANONICAL_BASE/v1/stm/definitely-missing.json" \
  | tr -d '\r' | grep -qi '^cache-control: no-store' \
  || fail "404 response must carry cache-control: no-store"
ok "404 carries cache-control: no-store"

[ "$(status_of "$CANONICAL_BASE/secrets.txt")" = "404" ] \
  || fail "path outside v1/ must return 404"
ok "non-v1 path -> 404"

[ "$(status_of -X POST "$CANONICAL_BASE/v1/stm/manifest.json")" = "405" ] \
  || fail "POST must return 405"
ok "POST -> 405"

# --- CORS: the recorded slice-9.2 dev decision (fetch canonical host directly) ---
headers_of "$CANONICAL_BASE/v1/stm/manifest.json" >/dev/null # resolvability guard
curl -fsSI --max-time "$MAX_TIME" -H 'Origin: http://localhost:5173' \
  "$CANONICAL_BASE/v1/stm/manifest.json" | tr -d '\r' \
  | grep -qi '^access-control-allow-origin: \*' \
  || fail "manifest must carry access-control-allow-origin: *"
ok "access-control-allow-origin: * present"

# --- fallback origin untouched: data.yesid.dev keeps serving ---
[ "$(status_of "$FALLBACK_BASE/v1/stm/manifest.json")" = "200" ] \
  || fail "fallback $FALLBACK_BASE manifest must still return 200"
ok "fallback $FALLBACK_BASE manifest -> 200"

# --- /api/v1/kpis: public KPI endpoint (frozen v1 contract, src/kpis.js) ---
# APEX_BASE is independent from CANONICAL_BASE because the latter ends in
# /data while this route sits at the canonical host apex.
APEX_BASE="${APEX_BASE:-https://transit.yesid.dev}"
KPIS_URL="$APEX_BASE/api/v1/kpis"
kpis_body="$(curl -fsS --max-time "$MAX_TIME" "$KPIS_URL")" \
  || fail "$KPIS_URL did not return 200 (cold pipeline would be 503)"
for field in snapshotAt freshnessS vehicles avgDelayS coverage routesLive routesTotal topRoutes; do
  grep -q "\"$field\"" <<<"$kpis_body" || fail "kpis body missing \"$field\""
done
ok "$KPIS_URL -> 200 with all v1 contract fields"

kpis_headers="$(curl -fsSI --max-time "$MAX_TIME" -H 'Origin: https://yesid.dev' "$KPIS_URL" | tr -d '\r')"
grep -qi '^access-control-allow-origin: \*' <<<"$kpis_headers" \
  || fail "kpis must carry access-control-allow-origin: *"
grep -qi '^cache-control: no-store' <<<"$kpis_headers" \
  || fail "kpis response must be no-store (server-side cache only)"
ok "kpis CORS + no-store headers present"

[ "$(status_of "$APEX_BASE/api/v1/definitely-missing")" = "404" ] \
  || fail "unknown /api/v1/* must return 404"
ok "unknown /api/v1/* -> 404"

# /api/vitals belongs to the web app. A 405 means the data-proxy route widened
# beyond /api/v1/* and intercepted the beacon.
vitals_status="$(status_of -X POST -H 'content-type: application/json' -d '{}' \
  "$APEX_BASE/api/vitals")"
[ "$vitals_status" != "405" ] || fail "/api/vitals returned 405 — route scope leaked past /api/v1/*"
ok "/api/vitals still reaches the web app (status $vitals_status)"

echo "SMOKE OK: canonical + fallback serving, kpis live, negatives clean"
