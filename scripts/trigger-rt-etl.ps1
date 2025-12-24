# PowerShell script to trigger RT Historical ETL workflow
# Usage: .\scripts\trigger-rt-etl.ps1 [date] [feed_kind]
#   date: Optional date override (YYYY-MM-DD format)
#   feed_kind: Optional feed kind (gtfsrt_trip_updates or gtfsrt_vehicle_positions)

param(
    [string]$Date = "",
    [string]$FeedKind = ""
)

$WORKFLOW_FILE = "silver-rt.yml"
$BRANCH = "main"

Write-Host "🚀 Triggering RT Historical ETL workflow..." -ForegroundColor Cyan

$fields = @()

if ($Date) {
    Write-Host "📅 Using date override: $Date" -ForegroundColor Yellow
    $fields += "--field RT_DATE=$Date"
}

if ($FeedKind) {
    Write-Host "📦 Using feed_kind override: $FeedKind" -ForegroundColor Yellow
    $fields += "--field FEED_KIND=$FeedKind"
}

$cmd = "gh workflow run $WORKFLOW_FILE --ref $BRANCH"
if ($fields.Count -gt 0) {
    $cmd += " " + ($fields -join " ")
}

Invoke-Expression $cmd

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

