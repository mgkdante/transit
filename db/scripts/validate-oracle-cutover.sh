#!/usr/bin/env bash
set -u -o pipefail

fail_count=0
warn_count=0

MAX_REALTIME_AGE_SECONDS="${MAX_REALTIME_AGE_SECONDS:-180}"
MIN_WORKFLOW_RUN_CREATED_AT="${MIN_WORKFLOW_RUN_CREATED_AT:-}"
CURL_MAX_TIME_SECONDS="${CURL_MAX_TIME_SECONDS:-15}"
HEALTH_SSH_CONNECT_TIMEOUT_SECONDS="${HEALTH_SSH_CONNECT_TIMEOUT_SECONDS:-8}"
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

  if check_health_url "${base_url}/health/live"; then
    pass "Health endpoint /health/live: reachable"
  else
    fail "Health endpoint /health/live: unreachable"
  fi

  local health_report_error
  if health_report_error="$(check_health_report_url "${base_url}/health")"; then
    pass "Health endpoint /health: status ok"
  else
    fail "Health endpoint /health: ${health_report_error:-request failed}"
  fi
}

check_health_url() {
  local url="$1"
  local ssh_target="${HEALTH_SSH_TARGET:-}"
  local quoted_url quoted_timeout
  local ssh_args=()

  if [[ -z "$ssh_target" ]]; then
    curl --fail --silent --show-error --location --max-time "$CURL_MAX_TIME_SECONDS" "$url" \
      >/dev/null
    return
  fi

  if [[ -n "${HEALTH_SSH_IDENTITY_FILE:-}" ]]; then
    ssh_args+=("-i" "$HEALTH_SSH_IDENTITY_FILE")
  fi
  ssh_args+=(
    "-o" "BatchMode=yes"
    "-o" "ConnectTimeout=$HEALTH_SSH_CONNECT_TIMEOUT_SECONDS"
  )

  printf -v quoted_url "%q" "$url"
  printf -v quoted_timeout "%q" "$CURL_MAX_TIME_SECONDS"
  ssh "${ssh_args[@]}" "$ssh_target" \
    "curl --fail --silent --show-error --location --max-time $quoted_timeout $quoted_url" \
    >/dev/null
}

check_health_report_url() {
  local url="$1"
  local ssh_target="${HEALTH_SSH_TARGET:-}"
  local quoted_url quoted_timeout quoted_write_out
  local ssh_args=()
  local output status

  if [[ -z "$ssh_target" ]]; then
    if ! output="$(curl --silent --show-error --location --max-time "$CURL_MAX_TIME_SECONDS" --write-out '\n%{http_code}' "$url" 2>&1)"; then
      printf 'request failed: %s\n' "$output"
      return 1
    fi
  else
    if [[ -n "${HEALTH_SSH_IDENTITY_FILE:-}" ]]; then
      ssh_args+=("-i" "$HEALTH_SSH_IDENTITY_FILE")
    fi
    ssh_args+=(
      "-o" "BatchMode=yes"
      "-o" "ConnectTimeout=$HEALTH_SSH_CONNECT_TIMEOUT_SECONDS"
    )

    printf -v quoted_url "%q" "$url"
    printf -v quoted_timeout "%q" "$CURL_MAX_TIME_SECONDS"
    printf -v quoted_write_out "%q" '\n%{http_code}'
    if ! output="$(
      ssh "${ssh_args[@]}" "$ssh_target" \
        "curl --silent --show-error --location --max-time $quoted_timeout --write-out $quoted_write_out $quoted_url" \
        2>&1
    )"; then
      printf 'request failed: %s\n' "$output"
      return 1
    fi
  fi

  status="${output##*$'\n'}"
  case "$status" in
    200)
      return 0
      ;;
    503)
      printf 'needs attention (HTTP 503)\n'
      return 1
      ;;
    "")
      printf 'missing HTTP status\n'
      return 1
      ;;
    *)
      printf 'unexpected HTTP %s\n' "$status"
      return 1
      ;;
  esac
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
SELECT
  COALESCE(
    EXTRACT(EPOCH FROM (now() - max(captured_at_utc)))::integer,
    999999999
  ) AS vehicle_age,
  COALESCE(
    (
      SELECT EXTRACT(EPOCH FROM (now() - max(captured_at_utc)))::integer
      FROM gold.latest_trip_delay_snapshot
      WHERE provider_id = %(provider_id)s
    ),
    999999999
  ) AS trip_age,
  count(*) AS vehicle_count,
  (SELECT count(*) FROM gold.latest_trip_delay_snapshot WHERE provider_id = %(provider_id)s)
    AS trip_count
FROM gold.latest_vehicle_snapshot
WHERE provider_id = %(provider_id)s;
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
  local output vehicle_age trip_age vehicle_count trip_count
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
SELECT
  COALESCE(
    EXTRACT(EPOCH FROM (now() - max(captured_at_utc)))::integer,
    999999999
  ) AS vehicle_age,
  COALESCE(
    (
      SELECT EXTRACT(EPOCH FROM (now() - max(captured_at_utc)))::integer
      FROM gold.latest_trip_delay_snapshot
      WHERE provider_id = :'provider_id'
    ),
    999999999
  ) AS trip_age,
  count(*) AS vehicle_count,
  (SELECT count(*) FROM gold.latest_trip_delay_snapshot WHERE provider_id = :'provider_id')
    AS trip_count
FROM gold.latest_vehicle_snapshot
WHERE provider_id = :'provider_id';
ROLLBACK;
"

  if ! output="$(run_realtime_freshness_query "$database_url" "$provider_id" "$query" 2>&1)"; then
    fail "Realtime freshness: psql read-only query failed: $output"
    return
  fi

  output="$(
    printf '%s\n' "$output" \
      | awk -F'|' 'NF == 4 && $1 ~ /^[0-9]+$/ && $2 ~ /^[0-9]+$/ {line=$0} END {print line}'
  )"
  IFS='|' read -r vehicle_age trip_age vehicle_count trip_count <<< "$output"

  if [[ -z "${vehicle_age:-}" || -z "${trip_age:-}" || -z "${vehicle_count:-}" || -z "${trip_count:-}" ]]; then
    fail "Realtime freshness: could not parse psql output: $output"
    return
  fi

  if (( vehicle_age > MAX_REALTIME_AGE_SECONDS || trip_age > MAX_REALTIME_AGE_SECONDS )); then
    fail "Realtime freshness: Gold latest age exceeds threshold ${MAX_REALTIME_AGE_SECONDS}s (vehicle=${vehicle_age}s, trip=${trip_age}s)"
    return
  fi

  if (( vehicle_count <= 0 || trip_count <= 0 )); then
    fail "Realtime freshness: expected positive Gold row counts, got vehicles=$vehicle_count trips=$trip_count"
    return
  fi

  pass "Realtime freshness: vehicle_age=${vehicle_age}s, trip_age=${trip_age}s, vehicles=$vehicle_count, trips=$trip_count"
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
