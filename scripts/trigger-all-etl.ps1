# PowerShell script to trigger both GTFS and RT ETL workflows sequentially
# Usage: .\scripts\trigger-all-etl.ps1

Write-Host "🚀 Triggering all ETL workflows..." -ForegroundColor Cyan
Write-Host ""

# Trigger GTFS ETL
Write-Host "📦 Step 1/2: Triggering GTFS Static ETL..." -ForegroundColor Yellow
& .\scripts\trigger-gtfs-etl.ps1
Write-Host ""

# Wait a moment before triggering the next workflow
Start-Sleep -Seconds 2

# Trigger RT ETL
Write-Host "📦 Step 2/2: Triggering RT Historical ETL..." -ForegroundColor Yellow
& .\scripts\trigger-rt-etl.ps1
Write-Host ""

Write-Host "✅ All workflows triggered successfully!" -ForegroundColor Green
Write-Host ""
Write-Host "📊 To watch all workflow runs:" -ForegroundColor Yellow
Write-Host "   gh run watch"
Write-Host ""
Write-Host "📋 To list recent runs:" -ForegroundColor Yellow
Write-Host "   gh run list"

