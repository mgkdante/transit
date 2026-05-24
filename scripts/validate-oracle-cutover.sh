#!/usr/bin/env bash
set -u -o pipefail

fail_count=0
warn_count=0

MAX_REALTIME_AGE_SECONDS="${MAX_REALTIME_AGE_SECONDS:-180}"
MIN_WORKFLOW_RUN_CREATED_AT="${MIN_WORKFLOW_RUN_CREATED_AT:-}"
CURL_MAX_TIME_SECONDS="${CURL_MAX_TIME_SECONDS:-15}"
REPO="${GITHUB_REPOSITORY:-mgkdante/transit}"

pass() {
  printf 'PASS %s\n' "$1"
}

warn() {
  warn_count=$((warn_count + 1))
  printf 'WARN %s\n' "$1"
}

fail() {
  fail_count=$((fail_count + 1))
  printf 'FAIL %s\n' "$1"
}

check_git_readiness() {
  local branch upstream ahead_behind dirty_state
  local origin_includes_head="no"
  local head_includes_origin="no"

  if ! branch="$(git branch --show-current 2>&1)"; then
    fail "Git readiness: could not determine current branch: $branch"
    return
  fi

  if ! upstream="$(git rev-parse --abbrev-ref --symbolic-full-name '@{u}' 2>&1)"; then
    fail "Git readiness: current branch $branch has no upstream: $upstream"
    return
  fi

  if ! ahead_behind="$(git rev-list --left-right --count '@{u}...HEAD' 2>&1)"; then
    fail "Git readiness: could not determine ahead/behind for $upstream: $ahead_behind"
    return
  fi

  if git merge-base --is-ancestor HEAD origin/main >/dev/null 2>&1; then
    origin_includes_head="yes"
  fi
  if git merge-base --is-ancestor origin/main HEAD >/dev/null 2>&1; then
    head_includes_origin="yes"
  fi

  if ! dirty_state="$(git status --porcelain 2>&1)"; then
    fail "Git readiness: could not inspect working tree: $dirty_state"
    return
  fi
  if [[ -n "$dirty_state" ]]; then
    warn "Git readiness: working tree has uncommitted changes"
  fi

  if [[ "$head_includes_origin" != "yes" ]]; then
    fail "Git readiness: current HEAD does not include origin/main"
    return
  fi
  if [[ "$origin_includes_head" != "yes" ]]; then
    warn "Git readiness: current HEAD has commits not yet included in origin/main"
  fi

  pass "Git readiness: branch=$branch upstream=$upstream ahead_behind=$ahead_behind origin_includes_HEAD=$origin_includes_head HEAD_includes_origin_main=$head_includes_origin"
}

check_health_endpoints() {
  local base_url="${HEALTH_BASE_URL:-}"

  if [[ -z "$base_url" ]]; then
    fail "Health endpoints: HEALTH_BASE_URL is required"
    return
  fi

  if curl --fail --silent --show-error --location --max-time "$CURL_MAX_TIME_SECONDS" "${base_url}/health/live" >/dev/null; then
    pass "Health endpoint /health/live: reachable"
  else
    fail "Health endpoint /health/live: unreachable"
  fi

  if curl --fail --silent --show-error --location --max-time "$CURL_MAX_TIME_SECONDS" "${base_url}/health" >/dev/null; then
    pass "Health endpoint /health: reachable"
  else
    fail "Health endpoint /health: unreachable"
  fi
}

run_realtime_freshness_query() {
  local database_url="$1"
  local provider_id="$2"
  local query="$3"

  if command -v psql >/dev/null 2>&1; then
    psql "$database_url" \
      --no-psqlrc \
      --tuples-only \
      --no-align \
      --set=ON_ERROR_STOP=1 \
      --variable=provider_id="$provider_id" \
      --command "$query"
    return
  fi

  if ! command -v uv >/dev/null 2>&1; then
    printf 'psql command is required when uv is unavailable\n' >&2
    return 127
  fi

  DATABASE_URL="$database_url" STM_PROVIDER_ID="$provider_id" uv run python - <<'PY'
from __future__ import annotations

import os

import psycopg

query = """
WITH endpoint_freshness AS (
  SELECT
    fe.endpoint_key,
    max(rsi.captured_at_utc) AS latest_captured_at_utc
  FROM core.feed_endpoints AS fe
  LEFT JOIN raw.realtime_snapshot_index AS rsi
    ON rsi.provider_id = fe.provider_id
    AND rsi.feed_endpoint_id = fe.feed_endpoint_id
  WHERE fe.provider_id = %(provider_id)s
    AND fe.endpoint_key IN ('trip_updates', 'vehicle_positions')
  GROUP BY fe.endpoint_key
)
SELECT
  COALESCE(
    max(EXTRACT(EPOCH FROM (now() - latest_captured_at_utc))::integer)
      FILTER (WHERE endpoint_key = 'trip_updates'),
    999999999
  ),
  COALESCE(
    max(EXTRACT(EPOCH FROM (now() - latest_captured_at_utc))::integer)
      FILTER (WHERE endpoint_key = 'vehicle_positions'),
    999999999
  ),
  count(*) FILTER (WHERE endpoint_key = 'trip_updates' AND latest_captured_at_utc IS NOT NULL),
  count(*) FILTER (WHERE endpoint_key = 'vehicle_positions' AND latest_captured_at_utc IS NOT NULL),
  (SELECT count(*) FROM gold.latest_vehicle_snapshot WHERE provider_id = %(provider_id)s),
  (SELECT count(*) FROM gold.latest_trip_delay_snapshot WHERE provider_id = %(provider_id)s)
FROM endpoint_freshness;
"""

with psycopg.connect(os.environ["DATABASE_URL"]) as connection:
    with connection.transaction(force_rollback=True):
        connection.execute("SET TRANSACTION READ ONLY")
        row = connection.execute(
            query,
            {"provider_id": os.environ.get("STM_PROVIDER_ID", "stm")},
        ).fetchone()

print("|".join(str(value) for value in row))
PY
}

check_realtime_freshness() {
  local database_url="${DATABASE_URL:-}"
  local provider_id="${STM_PROVIDER_ID:-stm}"
  local output trip_updates_age vehicle_positions_age trip_updates_seen vehicle_positions_seen
  local vehicle_count trip_count
  local query

  if [[ -z "$database_url" ]]; then
    fail "Realtime freshness: DATABASE_URL is required"
    return
  fi
  if [[ ! "$MAX_REALTIME_AGE_SECONDS" =~ ^[1-9][0-9]*$ ]]; then
    fail "Realtime freshness: MAX_REALTIME_AGE_SECONDS must be a positive integer"
    return
  fi

  query="
BEGIN READ ONLY;
WITH endpoint_freshness AS (
  SELECT
    fe.endpoint_key,
    max(rsi.captured_at_utc) AS latest_captured_at_utc
  FROM core.feed_endpoints AS fe
  LEFT JOIN raw.realtime_snapshot_index AS rsi
    ON rsi.provider_id = fe.provider_id
    AND rsi.feed_endpoint_id = fe.feed_endpoint_id
  WHERE fe.provider_id = :'provider_id'
    AND fe.endpoint_key IN ('trip_updates', 'vehicle_positions')
  GROUP BY fe.endpoint_key
)
SELECT
  COALESCE(
    max(EXTRACT(EPOCH FROM (now() - latest_captured_at_utc))::integer)
      FILTER (WHERE endpoint_key = 'trip_updates'),
    999999999
  ),
  COALESCE(
    max(EXTRACT(EPOCH FROM (now() - latest_captured_at_utc))::integer)
      FILTER (WHERE endpoint_key = 'vehicle_positions'),
    999999999
  ),
  count(*) FILTER (WHERE endpoint_key = 'trip_updates' AND latest_captured_at_utc IS NOT NULL),
  count(*) FILTER (WHERE endpoint_key = 'vehicle_positions' AND latest_captured_at_utc IS NOT NULL),
  (SELECT count(*) FROM gold.latest_vehicle_snapshot WHERE provider_id = :'provider_id'),
  (SELECT count(*) FROM gold.latest_trip_delay_snapshot WHERE provider_id = :'provider_id')
FROM endpoint_freshness;
ROLLBACK;
"

  if ! output="$(run_realtime_freshness_query "$database_url" "$provider_id" "$query" 2>&1)"; then
    fail "Realtime freshness: psql read-only query failed: $output"
    return
  fi

  output="$(
    printf '%s\n' "$output" \
      | awk -F'|' 'NF == 6 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {line=$0} END {print line}'
  )"
  IFS='|' read -r trip_updates_age vehicle_positions_age trip_updates_seen vehicle_positions_seen vehicle_count trip_count <<< "$output"

  if [[ -z "${trip_updates_age:-}" || -z "${vehicle_positions_age:-}" || -z "${trip_updates_seen:-}" || -z "${vehicle_positions_seen:-}" || -z "${vehicle_count:-}" || -z "${trip_count:-}" ]]; then
    fail "Realtime freshness: could not parse psql output: $output"
    return
  fi

  if (( trip_updates_seen <= 0 || vehicle_positions_seen <= 0 )); then
    fail "Realtime freshness: expected both realtime endpoints, got trip_updates=$trip_updates_seen vehicle_positions=$vehicle_positions_seen"
    return
  fi

  if (( trip_updates_age > MAX_REALTIME_AGE_SECONDS || vehicle_positions_age > MAX_REALTIME_AGE_SECONDS )); then
    fail "Realtime freshness: endpoint age exceeds threshold ${MAX_REALTIME_AGE_SECONDS}s (trip_updates=${trip_updates_age}s, vehicle_positions=${vehicle_positions_age}s)"
    return
  fi

  if (( vehicle_count <= 0 || trip_count <= 0 )); then
    fail "Realtime freshness: expected positive row counts, got vehicles=$vehicle_count trips=$trip_count"
    return
  fi

  pass "Realtime freshness: trip_updates_age=${trip_updates_age}s, vehicle_positions_age=${vehicle_positions_age}s, trip_updates=$trip_updates_seen, vehicle_positions=$vehicle_positions_seen, vehicles=$vehicle_count, trips=$trip_count"
}

check_one_workflow() {
  local workflow_name="$1"
  local state workflows latest conclusion run_id run_url created_at

  if ! workflows="$(gh workflow list --repo "$REPO" --limit 100 2>&1)"; then
    fail "GitHub workflow $workflow_name: could not list workflows: $workflows"
    return
  fi
  if ! state="$(
    printf '%s\n' "$workflows" \
      | awk -F '\t' -v workflow_name="$workflow_name" '$1 == workflow_name {print $2; found=1} END {if (!found) exit 1}'
  )"; then
    fail "GitHub workflow $workflow_name: workflow not found"
    return
  fi

  if [[ "$state" != "active" ]]; then
    fail "GitHub workflow $workflow_name: state is $state"
    return
  fi

  pass "GitHub workflow $workflow_name: active"

  if ! latest="$(gh run list --workflow "$workflow_name" --repo "$REPO" --branch main --status completed --limit 1 --json conclusion,databaseId,url,createdAt --jq '.[0] | "\(.conclusion)|\(.databaseId)|\(.url)|\(.createdAt)"' 2>&1)"; then
    fail "GitHub workflow $workflow_name: could not inspect latest completed run: $latest"
    return
  fi

  IFS='|' read -r conclusion run_id run_url created_at <<< "$latest"
  if [[ -z "${conclusion:-}" || "$conclusion" == "null" ]]; then
    fail "GitHub workflow $workflow_name: no completed runs found"
    return
  fi
  if [[ -z "${created_at:-}" || "$created_at" == "null" ]]; then
    fail "GitHub workflow $workflow_name: latest completed run is missing created_at"
    return
  fi
  if [[ -n "$MIN_WORKFLOW_RUN_CREATED_AT" && "$created_at" < "$MIN_WORKFLOW_RUN_CREATED_AT" ]]; then
    fail "GitHub workflow $workflow_name: latest completed main run created_at=$created_at predates required $MIN_WORKFLOW_RUN_CREATED_AT"
    return
  fi
  if [[ "$conclusion" != "success" ]]; then
    fail "GitHub workflow $workflow_name: latest completed run $conclusion"
    return
  fi

  pass "GitHub workflow $workflow_name: latest completed main run succeeded ($run_id $run_url created_at=$created_at)"
}

check_github_workflows() {
  if ! command -v gh >/dev/null 2>&1; then
    fail "GitHub workflows: gh command is required"
    return
  fi

  check_one_workflow "Daily Static Pipeline"
  check_one_workflow "Daily Warm Rollups"
}

check_powerbi_report() {
  local report_url="${POWERBI_REPORT_URL:-}"

  if [[ -z "$report_url" ]]; then
    fail "Power BI report page: POWERBI_REPORT_URL is required"
    return
  fi

  if curl --fail --silent --show-error --location --max-time "$CURL_MAX_TIME_SECONDS" "$report_url" >/dev/null; then
    pass "Power BI report page: reachable"
  else
    fail "Power BI report page: unreachable"
  fi
}

check_rollback_prereqs() {
  local missing=()
  local compose_database_url_configured=false
  local active_line

  for path in scripts/pause-pipeline.sh scripts/resume-pipeline.sh docker-compose.yml Caddyfile; do
    if [[ ! -r "$path" ]]; then
      missing+=("$path")
    fi
  done

  if [[ -z "${DATABASE_URL:-}" ]]; then
    missing+=("DATABASE_URL")
  fi

  if [[ -r docker-compose.yml ]]; then
    while IFS= read -r active_line; do
      active_line="${active_line%%#*}"
      if [[ "$active_line" =~ ^[[:space:]]+DATABASE_URL[[:space:]]*: ]]; then
        compose_database_url_configured=true
        break
      fi
    done < docker-compose.yml
  fi
  if [[ -r docker-compose.yml ]] && ! $compose_database_url_configured; then
    missing+=("docker-compose.yml DATABASE_URL")
  fi

  if (( ${#missing[@]} > 0 )); then
    fail "Rollback prereqs: missing or unconfigured ${missing[*]}"
  else
    pass "Rollback prereqs: pause/resume scripts, docker-compose.yml, Caddyfile, and DATABASE_URL are present/configured"
  fi

  printf 'No rollback, merge, push, workflow trigger, docker compose, or database mutation was run.\n'
}

check_git_readiness
check_health_endpoints
check_realtime_freshness
check_github_workflows
check_powerbi_report
check_rollback_prereqs

printf 'Summary: %s fail(s), %s warning(s)\n' "$fail_count" "$warn_count"

if (( fail_count > 0 )); then
  exit 1
fi

exit 0
