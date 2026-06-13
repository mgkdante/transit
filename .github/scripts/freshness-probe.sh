#!/usr/bin/env bash
#
# freshness-probe.sh — external freshness probe for the transit pipeline
# (slice-9.1.1o). Dependency-light bash (curl + jq + date + psql, all
# preinstalled on ubuntu-latest; NO uv sync). Three checks:
#
#   A. Manifest live age — the public /v1 manifest's files.live.generated_utc
#      must be younger than LIVE_MAX_AGE_SECONDS (cache-busted fetch).
#   B. DB capture age — the worst (oldest) of the three realtime endpoints'
#      latest captured_at_utc must be younger than DB_MAX_AGE_SECONDS.
#   C. Failed-run burst — fewer than FAILED_RUNS_ALERT_THRESHOLD failed
#      raw.ingestion_runs in the last FAILED_RUNS_WINDOW_MINUTES. This is the
#      ONLY detector for the silver-load-freeze incident class: during it,
#      captures and publishes kept succeeding (so A and B stayed green) while
#      the silver load failed silently. The new run_kind='silver_load' rows
#      (slice-9.1.1o) make those failures countable here.
#
# Any failed check fires a single alert issue and exits nonzero (so the run
# itself goes red); all-green resolves any open alert.
set -euo pipefail

: "${SNAPSHOT_PUBLIC_BASE_URL:?SNAPSHOT_PUBLIC_BASE_URL must be set}"
: "${DATABASE_URL:?DATABASE_URL must be set}"

LIVE_MAX_AGE_SECONDS="${LIVE_MAX_AGE_SECONDS:-300}"
DB_MAX_AGE_SECONDS="${DB_MAX_AGE_SECONDS:-900}"
FAILED_RUNS_WINDOW_MINUTES="${FAILED_RUNS_WINDOW_MINUTES:-30}"
FAILED_RUNS_ALERT_THRESHOLD="${FAILED_RUNS_ALERT_THRESHOLD:-10}"
PROVIDER_ID="${PROVIDER_ID:-stm}"

# psql cannot parse SQLAlchemy's "postgresql+psycopg://" driver tag — strip it so
# the same secret works for both the python jobs and this bare-psql probe.
PSQL_URL="${DATABASE_URL//+psycopg/}"
# These two values are shell-interpolated into the SQL below because psql's
# :'var' interpolation does NOT fire through -c (it silently errored, making
# Check B return the 999999 sentinel and Check C return 0 every run). Guard them
# strictly so a bad override can neither break nor inject into the query.
[[ "$PROVIDER_ID" =~ ^[A-Za-z0-9_]+$ ]] || { echo "freshness-probe: invalid PROVIDER_ID '${PROVIDER_ID}'" >&2; exit 2; }
[[ "$FAILED_RUNS_WINDOW_MINUTES" =~ ^[0-9]+$ ]] || FAILED_RUNS_WINDOW_MINUTES=30

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ALERT_ISSUE="${ALERT_ISSUE_SCRIPT:-alert-issue.sh}"
if ! command -v "$ALERT_ISSUE" >/dev/null 2>&1; then
  ALERT_ISSUE="${SCRIPT_DIR}/alert-issue.sh"
fi

failures=()

# --- Check A: manifest live age ---------------------------------------------
manifest_url="${SNAPSHOT_PUBLIC_BASE_URL}/v1/${PROVIDER_ID}/manifest.json?probe=$(date -u +%s)"
manifest_json="$(curl -fsS -H 'Cache-Control: no-cache' "$manifest_url" || true)"
generated_utc="$(printf '%s' "$manifest_json" | jq -r '.files.live.generated_utc // empty' 2>/dev/null || true)"

if [[ -z "$generated_utc" ]]; then
  failures+=("manifest: fetch/parse failed for ${manifest_url}")
else
  generated_epoch="$(date -u -d "$generated_utc" +%s 2>/dev/null || echo "")"
  if [[ -z "$generated_epoch" ]]; then
    failures+=("manifest: unparseable generated_utc '${generated_utc}'")
  else
    now_epoch="$(date -u +%s)"
    manifest_age=$(( now_epoch - generated_epoch ))
    if (( manifest_age > LIVE_MAX_AGE_SECONDS )); then
      failures+=("manifest: live age ${manifest_age}s > ${LIVE_MAX_AGE_SECONDS}s")
    fi
  fi
fi

# --- Check B: worst-endpoint DB capture age ---------------------------------
# Mirrors health/checks.py: latest captured_at_utc per realtime endpoint, then
# the oldest of them as the worst case. The provider id is shell-interpolated
# (validated ^[A-Za-z0-9_]+$ above) — NOT via psql's :'var', which does not fire
# through -c and silently pinned this check at the 999999 sentinel.
capture_age="$(
  psql "$PSQL_URL" -tA -v ON_ERROR_STOP=1 -c "
    WITH latest AS (
      SELECT
        fe.endpoint_key,
        CASE
          WHEN fe.endpoint_key = 'i3_alerts' THEN (
            SELECT max(s.captured_at_utc)
            FROM raw.i3_alert_snapshots s
            WHERE s.feed_endpoint_id = fe.feed_endpoint_id
          )
          ELSE (
            SELECT max(r.captured_at_utc)
            FROM raw.realtime_snapshot_index r
            WHERE r.feed_endpoint_id = fe.feed_endpoint_id
          )
        END AS latest_at
      FROM core.feed_endpoints fe
      WHERE fe.provider_id = '${PROVIDER_ID}'
        AND fe.endpoint_key IN ('trip_updates', 'vehicle_positions', 'i3_alerts')
    )
    SELECT COALESCE(max(EXTRACT(EPOCH FROM (now() - latest_at))::bigint), 999999)
    FROM latest
  " 2>/dev/null || echo "999999"
)"
capture_age="${capture_age//[[:space:]]/}"
[[ "$capture_age" =~ ^[0-9]+$ ]] || capture_age=999999
if (( capture_age > DB_MAX_AGE_SECONDS )); then
  failures+=("db_capture: worst-endpoint age ${capture_age}s > ${DB_MAX_AGE_SECONDS}s")
fi

# --- Check C: failed-run burst ----------------------------------------------
failed_runs="$(
  psql "$PSQL_URL" -tA -v ON_ERROR_STOP=1 -c "
    SELECT count(*)
    FROM raw.ingestion_runs
    WHERE status = 'failed'
      AND started_at_utc > now() - make_interval(mins => ${FAILED_RUNS_WINDOW_MINUTES})
  " 2>/dev/null || echo "0"
)"
failed_runs="${failed_runs//[[:space:]]/}"
[[ "$failed_runs" =~ ^[0-9]+$ ]] || failed_runs=0
if (( failed_runs >= FAILED_RUNS_ALERT_THRESHOLD )); then
  failures+=("failed_runs: ${failed_runs} failed runs in ${FAILED_RUNS_WINDOW_MINUTES}m >= ${FAILED_RUNS_ALERT_THRESHOLD}")
fi

# --- Fire / resolve ----------------------------------------------------------
if (( ${#failures[@]} > 0 )); then
  body="$(printf '%s\n' "${failures[@]}")"
  "$ALERT_ISSUE" fire freshness "[alert] ${PROVIDER_ID} pipeline stale/failing" "$body"
  echo "freshness-probe: FAILING" >&2
  printf '%s\n' "${failures[@]}" >&2
  exit 1
fi

"$ALERT_ISSUE" resolve freshness "recovered: all freshness probes green"
echo "freshness-probe: all checks green"
