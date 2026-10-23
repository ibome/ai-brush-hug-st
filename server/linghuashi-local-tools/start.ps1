param(
    [string]$TavernOrigin,
    [string]$ListenAddress = '127.0.0.1',
    [int]$Port = 8765,
    [switch]$ShowToken
)
$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath $PSScriptRoot
if (-not (Test-Path -LiteralPath '.venv/Scripts/python.exe')) { throw 'Run install.ps1 first.' }
$serviceArgs = @('service.py', '--host', $ListenAddress, '--port', "$Port")
if ($TavernOrigin) { $serviceArgs += @('--allow-origin', $TavernOrigin) }
if ($ShowToken) { $serviceArgs += '--show-token' }
& '.venv/Scripts/python.exe' @serviceArgs
