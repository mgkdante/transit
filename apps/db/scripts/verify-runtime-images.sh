#!/usr/bin/env bash
set -Eeuo pipefail

DB_ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
REPO_ROOT="$(cd -- "${DB_ROOT}/../.." && pwd -P)"
cd "${DB_ROOT}"

expected_python="$(
  sed -nE '1s/^FROM python:([0-9]+\.[0-9]+\.[0-9]+)-[^@]+@sha256:.*/\1/p' Dockerfile
)"
expected_uv="$(
  awk '/^[[:space:]]+version:/ {gsub(/"/, "", $2); print $2; exit}' \
    "${REPO_ROOT}/.github/actions/setup-py/action.yml"
)"
expected_postgres="$(
  sed -nE '1s/^FROM postgres:([0-9]+\.[0-9]+)-[^@]+@sha256:.*/\1/p' Dockerfile.postgis
)"
caddy_image="$(
  sed -nE \
    's/^[[:space:]]*image: (caddy:[^[:space:]]+@sha256:[0-9a-f]{64})[[:space:]]*$/\1/p' \
    docker-compose.yml
)"
expected_caddy="$(
  sed -nE 's/^caddy:([0-9]+\.[0-9]+\.[0-9]+)-[^@]+@sha256:.*/\1/p' \
    <<< "${caddy_image}"
)"
for declaration in expected_python expected_uv expected_postgres caddy_image expected_caddy; do
  if [[ -z "${!declaration}" ]]; then
    echo "could not derive ${declaration} from its pinned declaration" >&2
    exit 2
  fi
done

raw_suffix="${TRANSIT_RUNTIME_VERIFY_TAG_SUFFIX:-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-0}-$$}"
if [[ ! "${raw_suffix}" =~ ^[a-z0-9][a-z0-9_.-]*$ ]]; then
  echo "invalid runtime-verification tag suffix: ${raw_suffix}" >&2
  exit 2
fi

worker_tag="transit-runtime-verify-worker:${raw_suffix}"
health_tag="transit-runtime-verify-health:${raw_suffix}"
postgres_tag="transit-runtime-verify-postgres:${raw_suffix}"

cleanup() {
  local primary_status=$?
  local cleanup_status=0
  trap - EXIT INT TERM
  docker image rm --force "${worker_tag}" "${health_tag}" "${postgres_tag}" || cleanup_status=$?
  if (( primary_status != 0 )); then
    exit "${primary_status}"
  fi
  exit "${cleanup_status}"
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

assert_version_prefix() {
  local label=$1
  local expected_prefix=$2
  shift 2
  local actual
  actual="$("$@")"
  printf '%s\n' "${actual}"
  if [[ "${actual}" != "${expected_prefix}"* ]]; then
    printf 'unexpected %s version: expected prefix %q, got %q\n' \
      "${label}" "${expected_prefix}" "${actual}" >&2
    return 1
  fi
}

printf '%s\n' '== Docker host =='
docker version --format 'Docker Engine {{.Server.Version}}'
docker compose version

printf '%s\n' '== Build runtime images =='
docker build --pull --file Dockerfile --tag "${worker_tag}" .
docker build --pull --file Dockerfile.health --tag "${health_tag}" .
docker build --pull --file Dockerfile.postgis --tag "${postgres_tag}" .

printf '%s\n' '== Worker runtime =='
assert_version_prefix Python "Python ${expected_python}" \
  docker run --rm --entrypoint python "${worker_tag}" --version
assert_version_prefix uv "uv ${expected_uv}" \
  docker run --rm --entrypoint uv "${worker_tag}" --version
docker run --rm --entrypoint dpkg-query "${worker_tag}" \
  -W '-f=${binary:Package}=${Version}\n' \
  ca-certificates postgresql-common postgresql-client-16

printf '%s\n' '== Health runtime =='
assert_version_prefix Python "Python ${expected_python}" \
  docker run --rm --entrypoint python "${health_tag}" --version
assert_version_prefix uv "uv ${expected_uv}" \
  docker run --rm --entrypoint uv "${health_tag}" --version

printf '%s\n' '== PostgreSQL runtime =='
assert_version_prefix PostgreSQL "postgres (PostgreSQL) ${expected_postgres}" \
  docker run --rm --entrypoint postgres "${postgres_tag}" --version
docker run --rm --entrypoint pg_repack "${postgres_tag}" --version
docker run --rm --entrypoint dpkg-query "${postgres_tag}" \
  -W '-f=${binary:Package}=${Version}\n' \
  postgresql-16-postgis-3 postgresql-16-postgis-3-scripts postgresql-16-repack

printf '%s\n' '== Caddy runtime =='
assert_version_prefix Caddy "v${expected_caddy}" \
  docker run --rm --entrypoint caddy "${caddy_image}" version
