#!/bin/bash
# Script to trigger GTFS Static ETL workflow
# Usage: ./scripts/trigger-gtfs-etl.sh [date]
#   date: Optional date override (YYYY-MM-DD format)

set -e

WORKFLOW_FILE="silver-gtfs.yml"
BRANCH="main"

echo "🚀 Triggering GTFS Static ETL workflow..."

# Check if date parameter is provided
if [ -n "$1" ]; then
  echo "📅 Using date override: $1"
  gh workflow run "$WORKFLOW_FILE" \
    --ref "$BRANCH" \
    --field GTFS_DATE="$1"
else
  gh workflow run "$WORKFLOW_FILE" --ref "$BRANCH"
fi

echo "✅ Workflow triggered successfully!"
echo ""
echo "📊 To watch the workflow run:"
echo "   gh run watch"
echo ""
echo "📋 To list recent runs:"
echo "   gh run list --workflow=$WORKFLOW_FILE"

