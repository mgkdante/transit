#!/bin/bash
# Script to trigger RT Historical ETL workflow
# Usage: ./scripts/trigger-rt-etl.sh [date] [feed_kind]
#   date: Optional date override (YYYY-MM-DD format)
#   feed_kind: Optional feed kind (gtfsrt_trip_updates or gtfsrt_vehicle_positions)

set -e

WORKFLOW_FILE="silver-rt.yml"
BRANCH="main"

echo "🚀 Triggering RT Historical ETL workflow..."

# Build workflow run command
CMD="gh workflow run $WORKFLOW_FILE --ref $BRANCH"

# Add date parameter if provided
if [ -n "$1" ]; then
  echo "📅 Using date override: $1"
  CMD="$CMD --field RT_DATE=$1"
fi

# Add feed_kind parameter if provided
if [ -n "$2" ]; then
  echo "📦 Using feed_kind override: $2"
  CMD="$CMD --field FEED_KIND=$2"
fi

eval $CMD

echo "✅ Workflow triggered successfully!"
echo ""
echo "📊 To watch the workflow run:"
echo "   gh run watch"
echo ""
echo "📋 To list recent runs:"
echo "   gh run list --workflow=$WORKFLOW_FILE"

