# uninstall.ps1 — tear down the clone + docker compose setup on Windows.
#
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveOllama
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -KeepVolumes
#   powershell -ExecutionPolicy Bypass -File .\uninstall.ps1 -RemoveEnv -Yes
#
param(
    [switch]$RemoveOllama,   # also uninstall Ollama + delete %USERPROFILE%\.ollama (models)
    [switch]$KeepVolumes,    # keep DB / chats / models volumes
    [switch]$RemoveEnv,      # also delete the local .env
    [switch]$Yes             # skip confirmation
)
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

function Info($m) { Write-Host "==> $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m"  -ForegroundColor Yellow }

# ── confirm ──────────────────────────────────────────────────────────────
if (-not $Yes) {
    Write-Host "This will stop Local AI and remove its containers."
    if (-not $KeepVolumes) { Write-Host "  - Docker VOLUMES (DB, chats, container models) will be DELETED." }
    if ($RemoveOllama) { Write-Host "  - Ollama and %USERPROFILE%\.ollama (downloaded models) will be REMOVED." }
    if ($RemoveEnv) { Write-Host "  - Local .env will be DELETED." }
    $ans = Read-Host "Proceed? [y/N]"
    if ($ans -notmatch '^[Yy]') { Write-Host "Aborted."; exit 0 }
}

# ── 1. stop the stack ─────────────────────────────────────────────────────
$dockerOk = $false
if (Get-Command docker -ErrorAction SilentlyContinue) {
    docker compose version *> $null
    if ($LASTEXITCODE -eq 0) { $dockerOk = $true }
}
if ($dockerOk) {
    if ($KeepVolumes) {
        Info "Stopping stack (keeping volumes)..."
        docker compose --profile container-ollama down --remove-orphans
    } else {
        Info "Stopping stack and removing volumes..."
        docker compose --profile container-ollama down -v --remove-orphans
    }
} else {
    Warn "docker compose not available - skipping container teardown."
}

# ── 2. optionally remove Ollama ────────────────────────────────────────────
if ($RemoveOllama) {
    # Stop any running Ollama processes first.
    Get-Process ollama, "ollama app" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue

    $removed = $false
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        Info "Uninstalling Ollama via winget ..."
        winget uninstall --id Ollama.Ollama --silent 2>&1 | Out-Null
        if ($LASTEXITCODE -eq 0) { $removed = $true }
    }
    $uninst = "$env:LOCALAPPDATA\Programs\Ollama\unins000.exe"
    if (-not $removed -and (Test-Path $uninst)) {
        Info "Running Ollama uninstaller ..."
        Start-Process -FilePath $uninst -ArgumentList "/SILENT" -Wait
        $removed = $true
    }
    if (-not $removed) { Warn "Could not auto-remove Ollama - uninstall it from Settings > Apps if needed." }

    $ollamaData = Join-Path $env:USERPROFILE ".ollama"
    if (Test-Path $ollamaData) {
        Info "Removing model data at $ollamaData ..."
        Remove-Item -Recurse -Force $ollamaData -ErrorAction SilentlyContinue
    }
} else {
    Warn "Leaving Ollama and %USERPROFILE%\.ollama in place (use -RemoveOllama to remove)."
}

# ── 3. optionally remove .env ─────────────────────────────────────────────
if ($RemoveEnv -and (Test-Path ".env")) {
    Info "Removing .env ..."
    Remove-Item -Force ".env"
}

Info "Uninstall complete."
