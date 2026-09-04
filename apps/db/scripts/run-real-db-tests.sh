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
active_command_pid=""
active_command_group=""
handshake_pending=0
pending_signal_name=""
pending_signal_status=""

fail() {
  echo "real-db verification: $*" >&2
  return 1
}

cleanup() {
  local primary_status=$?
  local cleanup_failed=0
  local listed_containers
  local listed_networks_by_label
  local listed_networks_by_name
  local listed_volume
  local listed_volumes
  local network_query_failed=0
  trap - EXIT HUP INT TERM

  if ((cleanup_needed)); then
    if ! "${compose_command[@]}" down --volumes --remove-orphans; then
      echo "real-db cleanup failed: Docker Compose teardown failed." >&2
      cleanup_failed=1
    fi
    if ! listed_containers="$(
      docker ps --all --quiet \
        --filter "label=com.docker.compose.project=${project_name}"
    )"; then
      echo "real-db cleanup failed: could not verify project container removal." >&2
      cleanup_failed=1
    elif [[ -n "${listed_containers}" ]]; then
      echo "real-db cleanup failed: project container still exists." >&2
      cleanup_failed=1
    fi
    if ! listed_networks_by_label="$(
      docker network ls --quiet \
        --filter "label=com.docker.compose.project=${project_name}"
    )"; then
      echo "real-db cleanup failed: could not verify project network removal." >&2
      cleanup_failed=1
      network_query_failed=1
    fi
    if ! listed_networks_by_name="$(
      docker network ls --quiet --filter "name=^${project_name}_default$"
    )"; then
      echo "real-db cleanup failed: could not verify project network removal." >&2
      cleanup_failed=1
      network_query_failed=1
    fi
    if ((!network_query_failed)) &&
      [[ -n "${listed_networks_by_label}" || -n "${listed_networks_by_name}" ]]; then
      echo "real-db cleanup failed: project network still exists." >&2
      cleanup_failed=1
    fi
    if ! listed_volumes="$(
      docker volume ls --quiet --filter "name=^${volume_name}$"
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

isolated_command_group_exists() {
  local command_pid="$1"
  local process_group

  process_group="$(ps -o pgid= -p "${command_pid}" 2>/dev/null)" || return 1
  process_group="${process_group//[[:space:]]/}"
  [[ "${process_group}" == "${command_pid}" ]]
}

terminate_active_command() {
  local signal_name="$1"
  local command_pid="${active_command_pid}"
  local group="${active_command_group}"
  local killer_pid

  [[ -n "${command_pid}" ]] || return 0
  if [[ -z "${group}" ]] && isolated_command_group_exists "${command_pid}"; then
    group="${command_pid}"
  fi
  if [[ -n "${group}" ]]; then
    kill -s "${signal_name}" -- "-${group}" 2>/dev/null || true
  else
    kill -s "${signal_name}" -- "${command_pid}" 2>/dev/null || true
  fi
  (
    sleep 1
    if [[ -n "${group}" ]]; then
      if kill -0 -- "-${group}" 2>/dev/null; then
        kill -s KILL -- "-${group}" 2>/dev/null || true
      fi
    elif isolated_command_group_exists "${command_pid}"; then
      kill -s KILL -- "-${command_pid}" 2>/dev/null || true
    elif kill -0 -- "${command_pid}" 2>/dev/null; then
      kill -s KILL -- "${command_pid}" 2>/dev/null || true
    fi
  ) &
  killer_pid=$!
  wait "${killer_pid}" 2>/dev/null || true
  wait "${command_pid}" 2>/dev/null || true
  active_command_pid=""
  active_command_group=""
}

on_signal() {
  local signal_name="$1"
  local signal_status="$2"
  if ((handshake_pending)); then
    pending_signal_name="${signal_name}"
    pending_signal_status="${signal_status}"
    return
  fi
  trap - HUP INT TERM
  if [[ -n "${active_command_pid}" ]]; then
    terminate_active_command "${signal_name}"
  fi
  exit "${signal_status}"
}

install_signal_traps() {
  trap 'on_signal HUP 129' HUP
  trap 'on_signal INT 130' INT
  trap 'on_signal TERM 143' TERM
}

run_tracked() {
  local command_status
  local command_stdout_fd
  local handshake
  local handshake_fd
  local readiness_status

  pending_signal_name=""
  pending_signal_status=""
  handshake_pending=1
  exec {command_stdout_fd}>&1
  exec {handshake_fd}< <(
    exec python3 -c '
import os
import signal
import sys

for signal_number in (signal.SIGHUP, signal.SIGINT, signal.SIGTERM):
    signal.signal(signal_number, signal.SIG_DFL)
os.setsid()
os.write(3, f"READY {os.getpid()}\n".encode("ascii"))
os.close(3)
os.execvp(sys.argv[1], sys.argv[1:])
' "$@" 3>&1 1>&"${command_stdout_fd}"
  )
  active_command_pid="$!"
  exec {command_stdout_fd}>&-

  IFS= read -r -t 1 handshake <&"${handshake_fd}"
  readiness_status=$?
  handshake_pending=0
  if [[ -n "${pending_signal_name}" ]]; then
    exec {handshake_fd}<&-
    on_signal "${pending_signal_name}" "${pending_signal_status}"
  fi
  if ((readiness_status)) || [[ "${handshake}" != "READY ${active_command_pid}" ]] ||
    ! isolated_command_group_exists "${active_command_pid}"; then
    exec {handshake_fd}<&-
    terminate_active_command TERM
    fail "could not establish an isolated command process group."
    return 2
  fi
  exec {handshake_fd}<&-
  active_command_group="${active_command_pid}"
  wait "${active_command_pid}"
  command_status=$?
  active_command_pid=""
  active_command_group=""
  return "${command_status}"
}

is_local_docker_endpoint() {
  local endpoint="$1"
  local octet
  local port

  if [[ "${endpoint}" == unix:///* && "${endpoint}" != "unix:///" && "${endpoint}" != *[$'\r\n']* ]]; then
    return 0
  fi
  if [[ "${endpoint}" =~ ^tcp://127\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3}):([0-9]{1,5})$ ]]; then
    for octet in "${BASH_REMATCH[1]}" "${BASH_REMATCH[2]}" "${BASH_REMATCH[3]}"; do
      ((10#${octet} <= 255)) || return 1
    done
    port="${BASH_REMATCH[4]}"
    ((10#${port} >= 1 && 10#${port} <= 65535))
    return
  fi
  if [[ "${endpoint}" =~ ^tcp://\[::1\]:([0-9]{1,5})$ ]]; then
    port="${BASH_REMATCH[1]}"
    ((10#${port} >= 1 && 10#${port} <= 65535))
    return
  fi
  return 1
}

verify_local_docker_endpoint() {
  local context
  local endpoint

  if [[ -n "${DOCKER_CONTEXT:-}" ]]; then
    context="${DOCKER_CONTEXT}"
    [[ "${context}" != *[$'\r\n\t ']* ]] || {
      fail "could not resolve the selected Docker context."
      return 2
    }
    endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' "${context}" 2>/dev/null)" || {
      fail "could not resolve the selected Docker context."
      return 2
    }
  elif [[ -n "${DOCKER_HOST:-}" ]]; then
    endpoint="${DOCKER_HOST}"
  else
    context="$(docker context show 2>/dev/null)" || {
      fail "could not resolve the current Docker context."
      return 2
    }
    [[ -n "${context}" && "${context}" != *[$'\r\n\t ']* ]] || {
      fail "could not resolve the current Docker context."
      return 2
    }
    endpoint="$(docker context inspect --format '{{.Endpoints.docker.Host}}' "${context}" 2>/dev/null)" || {
      fail "could not resolve the current Docker context."
      return 2
    }
  fi

  [[ -n "${endpoint}" ]] || {
    fail "could not resolve the Docker context endpoint."
    return 2
  }

  is_local_docker_endpoint "${endpoint}" || {
    fail "a local Docker daemon is required."
    return 2
  }
}

verify_docker_architecture() {
  local architecture

  architecture="$(docker info --format '{{.Architecture}}' 2>/dev/null)" || {
    fail "could not verify Docker daemon architecture."
    return 2
  }
  [[ "${architecture}" == "amd64" || "${architecture}" == "x86_64" ]] || {
    fail "a local amd64 Docker daemon is required."
    return 2
  }
}

select_resource_identity() {
  local collision
  local containers
  local listed_volume
  local listed_volumes
  local networks_by_label
  local networks_by_name
  local suffix
  local attempt

  for ((attempt = 0; attempt < 8; attempt++)); do
    suffix="$(od -An -N16 -tx1 /dev/urandom | tr -d ' \n')" || {
      fail "could not generate a disposable Docker resource identity."
      return 2
    }
    [[ "${suffix}" =~ ^[0-9a-f]{32}$ ]] || {
      fail "could not generate a disposable Docker resource identity."
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

    containers="$(
      docker ps --all --quiet \
        --filter "label=com.docker.compose.project=${project_name}"
    )" || {
      fail "could not verify Compose project ownership."
      return 2
    }
    listed_volumes="$(
      docker volume ls --quiet --filter "name=^${volume_name}$"
    )" || {
      fail "could not verify volume ownership."
      return 2
    }
    networks_by_label="$(
      docker network ls --quiet \
        --filter "label=com.docker.compose.project=${project_name}"
    )" || {
      fail "could not verify network ownership."
      return 2
    }
    networks_by_name="$(
      docker network ls --quiet --filter "name=^${project_name}_default$"
    )" || {
      fail "could not verify network ownership."
      return 2
    }
    collision=0
    [[ -n "${containers}" ]] && collision=1
    [[ -n "${networks_by_label}" || -n "${networks_by_name}" ]] && collision=1
    while IFS= read -r listed_volume; do
      [[ "${listed_volume}" == "${volume_name}" ]] && collision=1
    done <<<"${listed_volumes}"
    ((collision)) || return 0
  done

  fail "could not prove a collision-free Docker resource identity."
  return 2
}

preflight() {
  local dependency
  for dependency in docker uv od ps python3 sleep tr setsid; do
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
  verify_local_docker_endpoint || return $?
  verify_docker_architecture || return $?
}

main() {
  preflight || return $?
  select_resource_identity || return $?

  local password
  password="$(od -An -N32 -tx1 /dev/urandom | tr -d ' \n')" || {
    fail "could not generate the disposable database password."
    return 2
  }
  [[ "${password}" =~ ^[0-9a-f]{64}$ ]] || {
    fail "could not generate the disposable database password."
    return 2
  }

  export TRANSIT_REAL_DB_PASSWORD="${password}"
  export PGPASSWORD="${password}"

  trap cleanup EXIT
  install_signal_traps
  cleanup_needed=1

  run_tracked "${compose_command[@]}" up --detach --wait --wait-timeout 120 postgres
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
  run_tracked uv run alembic upgrade head || return $?
  export COLUMNS=200
  run_tracked uv run pytest tests || return $?
}

main
