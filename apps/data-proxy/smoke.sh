#!/usr/bin/env bash
# Prod smoke for direct R2 snapshot serving plus the compatibility data Worker.
#
# Browser bulk reads and absolute URLs published into the manifest use the R2
# custom domain. The more expensive Worker route remains a backwards-compatible
# `/data/*` surface and still owns `/api/v1/*`.
#
# Usage: bash apps/data-proxy/smoke.sh
#   CANONICAL_BASE / FALLBACK_BASE / APEX_BASE override the probed hosts.
set -euo pipefail

CANONICAL_BASE="${CANONICAL_BASE:-https://data.yesid.dev}"
FALLBACK_BASE="${FALLBACK_BASE:-https://transit.yesid.dev/data}"
BROWSER_ORIGIN="${BROWSER_ORIGIN:-https://transit.yesid.dev}"
MAX_TIME=15
EDGE_MAX_ATTEMPTS="${EDGE_MAX_ATTEMPTS:-12}"
EDGE_RETRY_DELAY_S="${EDGE_RETRY_DELAY_S:-3}"
KPIS_MAX_ATTEMPTS="${KPIS_MAX_ATTEMPTS:-24}"
KPIS_RETRY_DELAY_S="${KPIS_RETRY_DELAY_S:-5}"

fail() { echo "FAIL: $*" >&2; exit 1; }
ok() { echo "ok: $*"; }

[[ "$EDGE_MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] \
  || fail "EDGE_MAX_ATTEMPTS must be a positive integer"
[[ "$EDGE_RETRY_DELAY_S" =~ ^[0-9]+$ ]] \
  || fail "EDGE_RETRY_DELAY_S must be a non-negative integer"

headers_of() {
  # -I HEAD probe; CRLF stripped so greps can anchor on line ends.
  curl -fsSI --max-time "$MAX_TIME" "$1" | tr -d '\r'
}

get_headers_of() {
  # Use a real GET so this proves the same cache object browsers consume. The
  # body is discarded, while response headers remain available for the gate.
  local url="$1"
  shift
  curl -fsS --max-time "$MAX_TIME" -D - -o /dev/null "$@" "$url" | tr -d '\r'
}

response_headers_of() {
  # Unlike get_headers_of, keep 4xx responses available for negative cache checks.
  local url="$1"
  shift
  curl -sS --max-time "$MAX_TIME" -D - -o /dev/null "$@" "$url" | tr -d '\r'
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

assert_edge_hit() {
  local url="$1" expected_cache_control="$2" headers attempt

  # Cloudflare configuration can take a short time to converge. Repeat the
  # exact browser-origin GET until CORS and cache reuse are both observable.
  for ((attempt = 1; attempt <= EDGE_MAX_ATTEMPTS; attempt++)); do
    if headers="$(get_headers_of "$url" -H "Origin: $BROWSER_ORIGIN")"; then
      if grep -qi '^access-control-allow-origin: \*$' <<<"$headers" \
        && grep -Eqi "^cache-control: (${expected_cache_control})$" <<<"$headers" \
        && grep -qi '^cf-cache-status: HIT$' <<<"$headers" \
        && grep -Eqi '^age: [1-9][0-9]*$' <<<"$headers"; then
        ok "$url browser-origin edge gate -> CORS + '${expected_cache_control}' + HIT with positive Age"
        return
      fi
    fi

    if [ "$attempt" -lt "$EDGE_MAX_ATTEMPTS" ]; then
      echo "wait: $url edge gate not ready (attempt $attempt/$EDGE_MAX_ATTEMPTS); retrying in ${EDGE_RETRY_DELAY_S}s" >&2
      sleep "$EDGE_RETRY_DELAY_S"
    fi
  done

  fail "$url exhausted $EDGE_MAX_ATTEMPTS attempts without browser-origin CORS, '${expected_cache_control}', HIT, and positive Age"
}

assert_range_preflight() {
  local url="$1" headers attempt

  for ((attempt = 1; attempt <= EDGE_MAX_ATTEMPTS; attempt++)); do
    if headers="$(curl -sS --max-time "$MAX_TIME" -D - -o /dev/null -X OPTIONS \
      -H "Origin: $BROWSER_ORIGIN" \
      -H 'Access-Control-Request-Method: GET' \
      -H 'Access-Control-Request-Headers: range' \
      "$url" | tr -d '\r')" \
      && grep -Eq '^HTTP/[^ ]+ 2[0-9][0-9]' <<<"$headers" \
      && grep -qi '^access-control-allow-origin: \*$' <<<"$headers" \
      && grep -Eqi '^access-control-allow-methods:.*GET' <<<"$headers" \
      && grep -Eqi '^access-control-allow-headers:.*range' <<<"$headers"; then
      ok "$url Range preflight -> allowed"
      return
    fi

    if [ "$attempt" -lt "$EDGE_MAX_ATTEMPTS" ]; then
      echo "wait: $url Range preflight not ready (attempt $attempt/$EDGE_MAX_ATTEMPTS); retrying in ${EDGE_RETRY_DELAY_S}s" >&2
      sleep "$EDGE_RETRY_DELAY_S"
    fi
  done

  fail "$url exhausted $EDGE_MAX_ATTEMPTS attempts without a valid Range preflight"
}

assert_missing_edge_bypass() {
  local url="$1" headers attempt

  for attempt in 1 2; do
    headers="$(response_headers_of "$url" -H "Origin: $BROWSER_ORIGIN")" \
      || fail "$url missing-object cache probe failed"
    grep -Eq '^HTTP/[^ ]+ 404' <<<"$headers" \
      || fail "$url missing-object cache probe did not return 404"
    if grep -qi '^cf-cache-status: HIT$' <<<"$headers"; then
      fail "$url returned CF-Cache-Status: HIT on a missing direct-R2 object"
    fi
    if grep -Eqi '^age: [1-9][0-9]*$' <<<"$headers"; then
      fail "$url returned Age on a missing direct-R2 object"
    fi
  done
  ok "$url missing direct-R2 object remains uncacheable"
}

# --- direct R2 custom domain: manifest + all three tiers + provenance (hard asserts;
# --- historic went publicly live 2026-06-10, values from snapshots/storage.py) ---
assert_object "$CANONICAL_BASE/v1/stm/manifest.json" "public, max-age=30"
curl -fsS --max-time "$MAX_TIME" "$CANONICAL_BASE/v1/stm/manifest.json" \
  | grep -q '"provider":"stm"' || fail "manifest body missing \"provider\":\"stm\""
ok "manifest body carries provider stm"
assert_edge_hit "$CANONICAL_BASE/v1/stm/manifest.json" "public, max-age=30"
assert_range_preflight "$CANONICAL_BASE/v1/stm/static/basemap/montreal.pmtiles"
assert_missing_edge_bypass "$CANONICAL_BASE/v1/stm/definitely-missing.json"

assert_object "$CANONICAL_BASE/v1/stm/live/vehicles.json" "public, max-age=30"
assert_object "$CANONICAL_BASE/v1/stm/static/routes_index.json" "public, max-age=86400, stale-while-revalidate=86400|public, max-age=604800"
assert_object "$CANONICAL_BASE/v1/stm/historic/network_trend.json" "public, max-age=3600, stale-while-revalidate=86400|public, max-age=86400"
assert_object "$CANONICAL_BASE/v1/stm/provenance.json" "public, max-age=3600, stale-while-revalidate=86400|public, max-age=86400"

# --- compatibility Worker negatives: clean 404/405 and errors never cacheable ---
[ "$(status_of "$FALLBACK_BASE/v1/stm/definitely-missing.json")" = "404" ] \
  || fail "missing key must return 404"
ok "missing key -> 404"

curl -sI --max-time "$MAX_TIME" "$FALLBACK_BASE/v1/stm/definitely-missing.json" \
  | tr -d '\r' | grep -qi '^cache-control: no-store' \
  || fail "404 response must carry cache-control: no-store"
ok "404 carries cache-control: no-store"

[ "$(status_of "$FALLBACK_BASE/secrets.txt")" = "404" ] \
  || fail "path outside v1/ must return 404"
ok "non-v1 path -> 404"

[ "$(status_of -X POST "$FALLBACK_BASE/v1/stm/manifest.json")" = "405" ] \
  || fail "POST must return 405"
ok "POST -> 405"

# --- compatibility Worker route remains live during the cutover. ---
[ "$(status_of "$FALLBACK_BASE/v1/stm/manifest.json")" = "200" ] \
  || fail "compatibility route $FALLBACK_BASE manifest must still return 200"
ok "compatibility route $FALLBACK_BASE manifest -> 200"

# --- /api/v1/kpis: public KPI endpoint (frozen v1 contract, src/kpis.js) ---
# APEX_BASE is independent from CANONICAL_BASE because the latter ends in
# /data while this route sits at the canonical host apex.
APEX_BASE="${APEX_BASE:-https://transit.yesid.dev}"
KPIS_URL="$APEX_BASE/api/v1/kpis"
[[ "$KPIS_MAX_ATTEMPTS" =~ ^[1-9][0-9]*$ ]] \
  || fail "KPIS_MAX_ATTEMPTS must be a positive integer"
[[ "$KPIS_RETRY_DELAY_S" =~ ^[0-9]+$ ]] \
  || fail "KPIS_RETRY_DELAY_S must be a non-negative integer"

kpis_body=""
kpis_ready=false
for ((attempt = 1; attempt <= KPIS_MAX_ATTEMPTS; attempt++)); do
  if kpis_body="$(curl -fsS --max-time "$MAX_TIME" "$KPIS_URL")"; then
    kpis_ready=true
    for field in snapshotAt freshnessS vehicles avgDelayS coverage routesLive routesTotal topRoutes; do
      if ! grep -q "\"$field\"" <<<"$kpis_body"; then
        kpis_ready=false
        break
      fi
    done
    [ "$kpis_ready" = true ] && break
  fi

  if [ "$attempt" -lt "$KPIS_MAX_ATTEMPTS" ]; then
    echo "wait: $KPIS_URL not ready (attempt $attempt/$KPIS_MAX_ATTEMPTS); retrying in ${KPIS_RETRY_DELAY_S}s" >&2
    sleep "$KPIS_RETRY_DELAY_S"
  fi
done
[ "$kpis_ready" = true ] \
  || fail "$KPIS_URL exhausted $KPIS_MAX_ATTEMPTS attempts without a valid 200 response"
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

echo "SMOKE OK: direct R2 + compatibility serving, kpis live, negatives clean"
