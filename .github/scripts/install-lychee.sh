#!/usr/bin/env bash
# Pinned Linux x64 Actions tool; shared by PR CI and the scheduled link check.
set -euo pipefail

: "${RUNNER_TEMP:?RUNNER_TEMP must be set}"
: "${GITHUB_PATH:?GITHUB_PATH must be set}"

tool_root="$RUNNER_TEMP/lychee"
mkdir "$tool_root"
gh release download lychee-v0.24.2 --repo lycheeverse/lychee \
  --pattern lychee-x86_64-unknown-linux-gnu.tar.gz --dir "$tool_root"
cd "$tool_root"
echo '1f4e0ef7f6554a6ed33dd7ac144fb2e1bbed98598e7af973042fc5cd43951c9a  lychee-x86_64-unknown-linux-gnu.tar.gz' | sha256sum --check
tar -xzf lychee-x86_64-unknown-linux-gnu.tar.gz

# This release has a top-level directory, not a top-level executable.
binary_dir="$tool_root/lychee-x86_64-unknown-linux-gnu"
test -x "$binary_dir/lychee"
"$binary_dir/lychee" --version
printf '%s\n' "$binary_dir" >> "$GITHUB_PATH"
