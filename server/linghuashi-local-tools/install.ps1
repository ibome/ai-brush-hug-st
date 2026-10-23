$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) {
    if (Get-Command py -ErrorAction SilentlyContinue) {
        & py -3.12 -m venv .venv
    } elseif (Get-Command python -ErrorAction SilentlyContinue) {
        & python -c "import sys; sys.exit(0 if (3,10) <= sys.version_info[:2] <= (3,12) else 1)"
        if ($LASTEXITCODE -ne 0) { throw 'Use Python 3.10-3.12 (3.12 recommended).' }
        & python -m venv .venv
    } else { throw 'Install Python 3.12 from python.org first.' }
    if ($LASTEXITCODE -ne 0) { throw 'Install Python 3.12 from python.org first.' }
}
& '.venv/Scripts/python.exe' -m pip install -r requirements.txt
if ($LASTEXITCODE -ne 0) { throw 'Dependency installation failed. Check the network and retry.' }
Write-Host 'Installed. Run start.ps1 with your Tavern page origin.'
& '.venv/Scripts/python.exe' diagnostics.py --output environment-diagnostics.json
if ($LASTEXITCODE -ne 0) { throw 'Post-install environment check failed.' }
