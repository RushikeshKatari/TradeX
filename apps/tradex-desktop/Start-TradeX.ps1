$ErrorActionPreference = 'Stop'
$port = 5000
$baseUrl = "http://127.0.0.1:$port"
$python = Join-Path $PSScriptRoot '.venv\Scripts\python.exe'

if (-not (Test-Path $python)) {
    throw "TradeX is not installed. Run install_windows.ps1 first."
}

$running = $false
try {
    Invoke-WebRequest -Uri "$baseUrl/api/state" -TimeoutSec 2 | Out-Null
    $running = $true
} catch {}

if (-not $running) {
    $logDir = Join-Path $env:LOCALAPPDATA 'TradeX\logs'
    New-Item -ItemType Directory -Force -Path $logDir | Out-Null
    Start-Process -FilePath $python -ArgumentList 'app.py' -WorkingDirectory $PSScriptRoot -WindowStyle Hidden `
        -RedirectStandardOutput (Join-Path $logDir 'backend.out.log') `
        -RedirectStandardError (Join-Path $logDir 'backend.err.log') | Out-Null

    $ready = $false
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Seconds 1
        try {
            Invoke-WebRequest -Uri "$baseUrl/api/state" -TimeoutSec 2 | Out-Null
            $ready = $true
            break
        } catch {}
    }
    if (-not $ready) {
        throw "TradeX did not start. See logs in $logDir."
    }
}

Start-Process $baseUrl
