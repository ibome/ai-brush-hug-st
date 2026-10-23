param([int]$Port = 8765)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
$checkArgs = @('diagnostics.py', '--port', "$Port", '--output', 'environment-diagnostics.json')
if (Test-Path -LiteralPath '.venv/Scripts/python.exe') {
    & '.venv/Scripts/python.exe' @checkArgs
} elseif (Get-Command py -ErrorAction SilentlyContinue) {
    & py -3.12 @checkArgs
} elseif (Get-Command python -ErrorAction SilentlyContinue) {
    & python @checkArgs
} else {
    throw 'Python was not found. Install Python 3.12, then run this check again.'
}
if ($LASTEXITCODE -ne 0) { throw 'Environment check failed. Review the command output.' }
Write-Host 'Report: environment-diagnostics.json (import it in the component wizard).'
