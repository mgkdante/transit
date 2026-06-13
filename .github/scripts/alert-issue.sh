#!/usr/bin/env bash
#
# alert-issue.sh — the shared alert CHANNEL for the transit pipeline
# (slice-9.1.1o). Zero new SaaS, zero new secrets: a labeled GitHub issue IS
# the alert, and GitHub emails admin@yesid.dev on create/close. An open issue
# is the "alerting" state; closing it is the "recovered" state.
#
# Usage:
#   alert-issue.sh fire    <slug> <title> <body>
#   alert-issue.sh resolve <slug> <body>
#
# fire:    create a labeled issue ONLY if none is open for this slug. An issue
#          already open is left untouched (no comment spam during an outage).
# resolve: comment + close the open issue for this slug, if any. No-op when
#          nothing is open.
#
# Requires GH_TOKEN (gh auth) and GH_REPO (owner/name) in the environment; the
# workflows pass ${{ github.token }} and ${{ github.repository }}.
set -euo pipefail

: "${GH_TOKEN:?GH_TOKEN must be set}"
: "${GH_REPO:?GH_REPO must be set}"
export GH_TOKEN GH_REPO

ALERT_LABEL="pipeline-alert"

action="${1:-}"
slug="${2:-}"

if [[ -z "$action" || -z "$slug" ]]; then
  echo "usage: alert-issue.sh fire|resolve <slug> ..." >&2
  exit 2
fi

slug_label="alert:${slug}"

# Idempotent label setup; --force makes re-creates a no-op success.
gh label create "$ALERT_LABEL" --repo "$GH_REPO" --force >/dev/null 2>&1 || true
gh label create "$slug_label" --repo "$GH_REPO" --force >/dev/null 2>&1 || true

open_issue_number() {
  gh issue list \
    --repo "$GH_REPO" \
    --label "$slug_label" \
    --state open \
    --json number \
    --jq '.[0].number // empty'
}

case "$action" in
  fire)
    title="${3:?fire requires a title}"
    body="${4:-}"
    existing="$(open_issue_number)"
    if [[ -n "$existing" ]]; then
      echo "alert-issue: issue #${existing} already open for ${slug_label}; leaving as-is."
      exit 0
    fi
    gh issue create \
      --repo "$GH_REPO" \
      --title "$title" \
      --body "$body" \
      --label "${ALERT_LABEL},${slug_label}"
    ;;
  resolve)
    body="${3:-recovered}"
    existing="$(open_issue_number)"
    if [[ -z "$existing" ]]; then
      echo "alert-issue: no open issue for ${slug_label}; nothing to resolve."
      exit 0
    fi
    gh issue comment "$existing" --repo "$GH_REPO" --body "$body"
    gh issue close "$existing" --repo "$GH_REPO"
    ;;
  *)
    echo "alert-issue: unknown action '${action}'" >&2
    exit 2
    ;;
esac
