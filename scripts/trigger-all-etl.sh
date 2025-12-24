#!/bin/bash
# Script to trigger both GTFS and RT ETL workflows sequentially
# Usage: ./scripts/trigger-all-etl.sh

set -e

echo "🚀 Triggering all ETL workflows..."
echo ""

# Trigger GTFS ETL
echo "📦 Step 1/2: Triggering GTFS Static ETL..."
./scripts/trigger-gtfs-etl.sh
echo ""

# Wait a moment before triggering the next workflow
sleep 2

# Trigger RT ETL
echo "📦 Step 2/2: Triggering RT Historical ETL..."
./scripts/trigger-rt-etl.sh
echo ""

echo "✅ All workflows triggered successfully!"
echo ""
echo "📊 To watch all workflow runs:"
echo "   gh run watch"
echo ""
echo "📋 To list recent runs:"
echo "   gh run list"

