#!/usr/bin/env bash

set -uo pipefail

DB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
COMPOSE_FILE="${DB_ROOT}/docker-compose.real-db.yml"
DATABASE_USER="transit_ci"
DATABASE_NAME="transit_ci"
DISPOSABLE_CONFIRMATION="I_UNDERSTAND_THIS_DATABASE_IS_DISPOSABLE"

cleanup_needed=0
project_name=""
volume_name=""
compose_command=()
active_uv_group=""
pending_signal_name=""
pending_signal_status=""

fail() {
  echo "real-db verification: $*" >&2
  return 1
}

cleanup() {
  local primary_status=$?
  local cleanup_failed=0
  local listed_volume
  local listed_volumes
  trap - EXIT HUP INT TERM

  if ((cleanup_needed)); then
    if ! "${compose_command[@]}" down --volumes --remove-orphans; then
      echo "real-db cleanup failed: Docker Compose teardown failed." >&2
      cleanup_failed=1
    fi
    if ! listed_volumes="$(
      docker volume ls --quiet --filter "name=${volume_name}"
    )"; then
      echo "real-db cleanup failed: could not verify data volume removal." >&2
      cleanup_failed=1
    else
      while IFS= read -r listed_volume; do
        if [[ "${listed_volume}" == "${volume_name}" ]]; then
          echo "real-db cleanup failed: data volume still exists." >&2
          cleanup_failed=1
          break
        fi
      done <<<"${listed_volumes}"
    fi
  fi

  if ((cleanup_failed)); then
    exit 90
  fi
  exit "${primary_status}"
}

on_signal() {
  local signal_name="$1"
  local signal_status="$2"
  local group="${active_uv_group}"
  trap - HUP INT TERM
  if [[ -n "${group}" ]]; then
    kill -s "${signal_name}" -- "-${group}" 2>/dev/null || true
    wait "${group}" 2>/dev/null || true
    active_uv_group=""
  fi
  exit "${signal_status}"
}

install_signal_traps() {
  trap 'on_signal HUP 129' HUP
  trap 'on_signal INT 130' INT
  trap 'on_signal TERM 143' TERM
}

queue_signal() {
  pending_signal_name="$1"
  pending_signal_status="$2"
}

run_uv() {
  local command_status
  pending_signal_name=""
  pending_signal_status=""
  trap 'queue_signal HUP 129' HUP
  trap 'queue_signal INT 130' INT
  trap 'queue_signal TERM 143' TERM
  setsid "$@" &
  active_uv_group=$!
  install_signal_traps
  if [[ -n "${pending_signal_name}" ]]; then
    on_signal "${pending_signal_name}" "${pending_signal_status}"
  fi
  wait "${active_uv_group}"
  command_status=$?
  active_uv_group=""
  return "${command_status}"
}

preflight() {
  local dependency
  for dependency in docker uv od tr setsid; do
    command -v "${dependency}" >/dev/null 2>&1 || {
      fail "required command '${dependency}' was not found."
      return 2
    }
  done
  [[ -r /dev/urandom ]] || {
    fail "/dev/urandom is not readable."
    return 2
  }
  docker compose version >/dev/null 2>&1 || {
    fail "Docker Compose v2 is required."
    return 2
  }
  local compose_help
  compose_help="$(docker compose up --help 2>&1)" || {
    fail "could not inspect Docker Compose up options."
    return 2
  }
  [[ "${compose_help}" =~ (^|[[:space:]])--wait([=[:space:]]|$) ]] || {
    fail "Docker Compose up must support --wait."
    return 2
  }
}

main() {
  preflight || return $?

  local suffix="${BASHPID}-${RANDOM}${RANDOM}"
  local password
  password="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" || {
    fail "could not generate the disposable database password."
    return 2
  }
  [[ "${password}" =~ ^[0-9a-f]{64}$ ]] || {
    fail "could not generate the disposable database password."
    return 2
  }

  project_name="transit-real-db-${suffix}"
  volume_name="${project_name}-data"
  compose_command=(
    docker compose
    --project-name "${project_name}"
    --file "${COMPOSE_FILE}"
  )
  export TRANSIT_REAL_DB_VOLUME="${volume_name}"
  export TRANSIT_REAL_DB_PASSWORD="${password}"
  export PGPASSWORD="${password}"

  trap cleanup EXIT
  install_signal_traps
  cleanup_needed=1

  "${compose_command[@]}" up --detach --wait --wait-timeout 120 postgres
  local startup_status=$?
  if ((startup_status)); then
    "${compose_command[@]}" logs --no-color --tail 200 postgres >&2 || true
    fail "PostGIS startup failed."
    return "${startup_status}"
  fi

  local endpoint
  endpoint="$("${compose_command[@]}" port postgres 5432)" || {
    fail "could not discover the disposable database port."
    return 1
  }
  if [[ ! "${endpoint}" =~ ^127\.0\.0\.1:([0-9]{1,5})$ ]]; then
    fail "Docker Compose returned an invalid loopback port."
    return 1
  fi
  local port="${BASH_REMATCH[1]}"
  if ((10#${port} < 1 || 10#${port} > 65535)); then
    fail "Docker Compose returned an invalid loopback port."
    return 1
  fi

  local database_url="postgresql+psycopg://${DATABASE_USER}@127.0.0.1:${port}/${DATABASE_NAME}"
  export DATABASE_URL="${database_url}"
  export TRANSIT_TEST_DATABASE_URL="${database_url}"
  export TRANSIT_TEST_DATABASE_DISPOSABLE="${DISPOSABLE_CONFIRMATION}"
  unset PGHOST PGHOSTADDR PGPORT PGDATABASE PGUSER PGSERVICE PGSERVICEFILE

  cd -- "${DB_ROOT}" || return 1
  run_uv uv run alembic upgrade head || return $?
  export COLUMNS=200
  run_uv uv run pytest tests || return $?
}

main
