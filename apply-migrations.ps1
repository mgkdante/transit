# PowerShell script to apply D1 migrations
# Usage: .\apply-migrations.ps1

$DATABASE_NAME = "transit-bronze"
$DATABASE_ID = "7fc37116-50c7-4c5f-bf6b-6c9a958b0140"

Write-Host "Applying D1 migrations to database: $DATABASE_NAME ($DATABASE_ID)" -ForegroundColor Cyan
Write-Host ""

Write-Host "Applying migration 001: Create Static Tables..." -ForegroundColor Yellow
npx wrangler d1 execute $DATABASE_NAME --file=./migrations/001_create_static_tables.sql --remote

Write-Host ""
Write-Host "Applying migration 002: Create RT Aggregation Tables..." -ForegroundColor Yellow
npx wrangler d1 execute $DATABASE_NAME --file=./migrations/002_create_rt_aggregation_tables.sql --remote

Write-Host ""
Write-Host "Verifying tables were created..." -ForegroundColor Yellow
npx wrangler d1 execute $DATABASE_NAME --command="SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;" --remote

Write-Host ""
Write-Host "✅ Migrations applied successfully!" -ForegroundColor Green


