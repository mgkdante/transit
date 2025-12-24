#!/bin/bash
# Script to apply D1 migrations
# Usage: ./apply-migrations.sh

DATABASE_NAME="transit-bronze"
DATABASE_ID="7fc37116-50c7-4c5f-bf6b-6c9a958b0140"

echo "Applying D1 migrations to database: $DATABASE_NAME ($DATABASE_ID)"
echo ""

echo "Applying migration 001: Create Static Tables..."
npx wrangler d1 execute $DATABASE_NAME --file=./migrations/001_create_static_tables.sql --remote

echo ""
echo "Applying migration 002: Create RT Aggregation Tables..."
npx wrangler d1 execute $DATABASE_NAME --file=./migrations/002_create_rt_aggregation_tables.sql --remote

echo ""
echo "Verifying tables were created..."
npx wrangler d1 execute $DATABASE_NAME --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --remote

echo ""
echo "✅ Migrations applied successfully!"


