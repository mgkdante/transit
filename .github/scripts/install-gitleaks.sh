#!/usr/bin/env bash

set -euo pipefail

GITLEAKS_VERSION="8.30.1"
GITLEAKS_ARCHIVE_SHA256="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"

if [ "$#" -ne 1 ] || [ -z "$1" ]; then
  echo "usage: install-gitleaks.sh DESTINATION_DIRECTORY" >&2
  exit 2
fi

case "$(uname -m)" in
  x86_64 | amd64)
    archive_platform="linux_x64"
    ;;
  *)
    echo "unsupported architecture for pinned gitleaks archive: $(uname -m)" >&2
    exit 2
    ;;
esac

destination_dir="$1"
work_dir="$(mktemp -d "${TMPDIR:-/tmp}/transit-gitleaks.XXXXXX")"
cleanup() {
  find -P "$work_dir" -depth -delete
}
trap cleanup EXIT

archive="$work_dir/gitleaks.tar.gz"
curl -fsSL \
  "https://github.com/gitleaks/gitleaks/releases/download/v${GITLEAKS_VERSION}/gitleaks_${GITLEAKS_VERSION}_${archive_platform}.tar.gz" \
  -o "$archive"
printf '%s  %s\n' "$GITLEAKS_ARCHIVE_SHA256" "$archive" | sha256sum -c - >/dev/null
tar -xzf "$archive" -C "$work_dir" gitleaks

actual_version="$("$work_dir/gitleaks" version)"
if [ "$actual_version" != "$GITLEAKS_VERSION" ]; then
  echo "unexpected gitleaks version: expected ${GITLEAKS_VERSION}, got ${actual_version}" >&2
  exit 1
fi

install -d -m 0755 "$destination_dir"
install -m 0755 "$work_dir/gitleaks" "$destination_dir/gitleaks"
printf '%s\n' "$destination_dir/gitleaks"
