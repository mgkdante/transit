# PowerShell script to trigger GTFS Static ETL workflow
# Usage: .\scripts\trigger-gtfs-etl.ps1 [date]
#   date: Optional date override (YYYY-MM-DD format)

param(
    [string]$Date = ""
)

$WORKFLOW_FILE = "silver-gtfs.yml"
$BRANCH = "main"

Write-Host "🚀 Triggering GTFS Static ETL workflow..." -ForegroundColor Cyan

if ($Date) {
    Write-Host "📅 Using date override: $Date" -ForegroundColor Yellow
    gh workflow run $WORKFLOW_FILE `
        --ref $BRANCH `
        --field GTFS_DATE=$Date
} else {
    gh workflow run $WORKFLOW_FILE --ref $BRANCH
}

if ($LASTEXITCODE -eq 0) {
    Write-Host "✅ Workflow triggered successfully!" -ForegroundColor Green
    Write-Host ""
    Write-Host "📊 To watch the workflow run:" -ForegroundColor Yellow
    Write-Host "   gh run watch"
    Write-Host ""
    Write-Host "📋 To list recent runs:" -ForegroundColor Yellow
    Write-Host "   gh run list --workflow=$WORKFLOW_FILE"
} else {
    Write-Host "❌ Failed to trigger workflow" -ForegroundColor Red
    exit 1
}

