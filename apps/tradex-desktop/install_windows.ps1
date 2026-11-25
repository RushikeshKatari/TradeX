$ErrorActionPreference = 'Stop'
$source = $PSScriptRoot
$installDir = Join-Path $env:LOCALAPPDATA 'Programs\TradeX'
$pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
if (-not $pythonLauncher) {
    throw 'Install Python 3.11 or newer from python.org and enable the Python Launcher, then run this script again.'
}
$pythonVersion = & py -3 -c 'import sys; print("%s.%s" % sys.version_info[:2])'
if ($LASTEXITCODE -ne 0 -or [version]$pythonVersion -lt [version]'3.11') {
    throw 'Python 3.11 or newer is required. Install it from python.org and run this script again.'
}

Write-Host "Installing TradeX to $installDir"
New-Item -ItemType Directory -Force -Path $installDir | Out-Null
if ((Resolve-Path $source).Path.TrimEnd('\') -ne (Resolve-Path $installDir).Path.TrimEnd('\')) {
    & robocopy $source $installDir /E /XD .venv __pycache__ tests /XF tradex_config.json tradex_trades.sqlite3 tradex_last_snapshot.json
    if ($LASTEXITCODE -gt 7) { throw "Copying TradeX files failed (robocopy exit $LASTEXITCODE)." }
    $global:LASTEXITCODE = 0
}

$venvPython = Join-Path $installDir '.venv\Scripts\python.exe'
if (-not (Test-Path $venvPython)) {
    & py -3 -m venv (Join-Path $installDir '.venv')
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the Python environment. Confirm Python 3.11+ is installed.' }
}
& $venvPython -m pip install --upgrade pip
if ($LASTEXITCODE -ne 0) { throw 'Could not update pip.' }
& $venvPython -m pip install -r (Join-Path $installDir 'requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'Could not install TradeX dependencies.' }
& $venvPython -m playwright install chromium
if ($LASTEXITCODE -ne 0) { throw 'Could not install the Playwright Chromium browser.' }

$desktop = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktop 'TradeX.lnk'
$launcher = Join-Path $installDir 'Start-TradeX.ps1'
$powershell = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $powershell
$shortcut.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$launcher`""
$shortcut.WorkingDirectory = $installDir
$shortcut.Description = 'Launch the local TradeX dashboard'
$shortcut.Save()

Write-Host 'TradeX installed. A TradeX shortcut was added to your desktop.'
& $powershell -NoProfile -ExecutionPolicy Bypass -File $launcher
