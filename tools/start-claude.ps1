<#
.SYNOPSIS
    Launch Claude Code with a named session for automatic logging.

.DESCRIPTION
    Sets CLAUDE_SESSION_LABEL so the logging hook writes to a human-readable
    folder under CLAUDE_LOG_ROOT. Logs land at:

        C:\Users\otalo\Freelance\project-logs\<SessionLabel>\sliceNN.md

.PARAMETER SessionLabel
    A short, human-readable name for this work session.
    Example: transit-hot-cold-hardening

.EXAMPLE
    .\tools\start-claude.ps1 transit-hot-cold-hardening
#>
param(
    [string]$SessionLabel = ""
)

if ($SessionLabel -ne "") {
    $env:CLAUDE_SESSION_LABEL = $SessionLabel
}

if (-not $env:CLAUDE_LOG_ROOT) {
    $env:CLAUDE_LOG_ROOT = "C:\Users\otalo\Freelance\project-logs"
}

claude
