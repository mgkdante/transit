#!/usr/bin/env bash

DATABASE_COMPUTE_ADAPTER="${DATABASE_COMPUTE_ADAPTER:-neon}"
DATABASE_COMPUTE_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

_database_compute_fail() {
  echo "$1" >&2
  return 1
}

case "$DATABASE_COMPUTE_ADAPTER" in
  neon)
    # shellcheck source=/dev/null
    source "$DATABASE_COMPUTE_LIB_DIR/database-compute-neon.sh"
    ;;
  none)
    # shellcheck source=/dev/null
    source "$DATABASE_COMPUTE_LIB_DIR/database-compute-none.sh"
    ;;
  *)
    _database_compute_fail "Unsupported DATABASE_COMPUTE_ADAPTER: $DATABASE_COMPUTE_ADAPTER"
    return 1
    ;;
esac

database_compute_adapter_name() {
  printf '%s\n' "${DATABASE_COMPUTE_ADAPTER_NAME:-$DATABASE_COMPUTE_ADAPTER}"
}

declare -F pause_database_compute >/dev/null || \
  _database_compute_fail "Database compute adapter '$DATABASE_COMPUTE_ADAPTER' must define pause_database_compute"
declare -F resume_database_compute >/dev/null || \
  _database_compute_fail "Database compute adapter '$DATABASE_COMPUTE_ADAPTER' must define resume_database_compute"
