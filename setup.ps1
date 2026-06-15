# setup.ps1 — interactive setup for the clone + docker compose path on Windows.
#
#   git clone https://github.com/360solutions-dev/local-ai
#   cd local-ai
#   powershell -ExecutionPolicy Bypass -File .\setup.ps1
#
# Windows counterpart of setup.sh. Asks where Ollama should run (Machine vs
# Docker), installs/points to it, writes .env, and brings the stack up.
$ErrorActionPreference = "Stop"
Set-Location -Path $PSScriptRoot

# ── helpers ────────────────────────────────────────────────────────────────
function Info($m) { Write-Host "==> $m" -ForegroundColor Green }
function Warn($m) { Write-Host "[!] $m"  -ForegroundColor Yellow }
function Die($m)  { Write-Host "[x] $m"  -ForegroundColor Red; exit 1 }

$OllamaExe = "$env:LOCALAPPDATA\Programs\Ollama\ollama.exe"
function Get-OllamaCmd {
    if (Get-Command ollama -ErrorAction SilentlyContinue) { return "ollama" }
    if (Test-Path $OllamaExe) { return $OllamaExe }
    return $null
}

# Create or replace KEY=value in .env
function Set-EnvVar($key, $val) {
    $c = Get-Content ".env" -Raw
    if ($c -match "(?m)^$key=.*$") {
        $c = [regex]::Replace($c, "(?m)^$key=.*$", "$key=$val")
    } else {
        if ($c -notmatch "`n$") { $c += "`n" }
        $c += "$key=$val`n"
    }
    Set-Content ".env" -Value $c -Encoding UTF8 -NoNewline
}

function New-Secret {
    $bytes = New-Object byte[] 32
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
    ($bytes | ForEach-Object { $_.ToString("x2") }) -join ""
}

function Test-HostOllama {
    try {
        Invoke-WebRequest "http://localhost:11434/api/tags" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop | Out-Null
        return $true
    } catch { return $false }
}

# ── 0. prerequisites ─────────────────────────────────────────────────────────
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) { Die "Docker is required. Install Docker Desktop first." }
docker compose version *> $null
if ($LASTEXITCODE -ne 0) { Die "Docker Compose v2 required (use: docker compose). Update Docker Desktop." }

# ── 1. .env + secrets ────────────────────────────────────────────────────────
if (-not (Test-Path ".env")) {
    if (-not (Test-Path ".env.example")) { Die ".env.example not found in $PSScriptRoot" }
    Copy-Item ".env.example" ".env"
    Info "Created .env from .env.example"
}

$placeholders = @{
    "DJANGO_SECRET_KEY" = "change-me-in-production"
    "RAG_API_KEY"       = "dev-rag-key-change-me"
    "WHISPER_API_KEY"   = "change-me-in-production"
    "UPDATER_API_KEY"   = "change-me-in-production"
}
foreach ($key in $placeholders.Keys) {
    $envText = Get-Content ".env" -Raw
    if ($envText -match "(?m)^$key=$([regex]::Escape($placeholders[$key]))$") {
        Set-EnvVar $key (New-Secret)
        Info "Generated $key"
    }
}

# ── 2. ask where Ollama should run ───────────────────────────────────────────
Write-Host ""
Write-Host "Where should Ollama (the model engine) run?"
Write-Host "  1) Machine  - install Ollama on Windows (GPU accelerated, fast)"
Write-Host "  2) Docker   - bundled container, nothing to install (slower)"
Write-Host ""
$choice = Read-Host "Choose [1/2] (default 1)"
if ([string]::IsNullOrWhiteSpace($choice)) { $choice = "1" }
$mode = if ($choice -eq "2") { "container" } else { "host" }

# ── 3a. Machine / host Ollama ────────────────────────────────────────────────
if ($mode -eq "host") {
    if (-not (Get-OllamaCmd)) {
        if (Get-Command winget -ErrorAction SilentlyContinue) {
            Info "Installing Ollama via winget ..."
            winget install --id Ollama.Ollama --silent --accept-package-agreements --accept-source-agreements 2>&1 | Out-Null
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path","Machine") + ";" +
                        [System.Environment]::GetEnvironmentVariable("Path","User")
        }
        if (-not (Get-OllamaCmd)) {
            Info "Downloading Ollama installer from ollama.com ..."
            $exe = "$env:TEMP\OllamaSetup.exe"
            Invoke-WebRequest "https://ollama.com/download/OllamaSetup.exe" -OutFile $exe -UseBasicParsing
            Info "Running Ollama installer ..."
            Start-Process -FilePath $exe -ArgumentList "/SILENT" -Wait
        }
        if (-not (Get-OllamaCmd)) { Die "Could not install Ollama. Install from https://ollama.com/download then re-run, or choose Docker (2)." }
    } else {
        Info "Ollama already installed."
    }

    if (-not (Test-HostOllama)) {
        Info "Starting Ollama server ..."
        if (Test-Path "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe") {
            Start-Process "$env:LOCALAPPDATA\Programs\Ollama\ollama app.exe" -WindowStyle Hidden -ErrorAction SilentlyContinue
        } else {
            Start-Process (Get-OllamaCmd) -ArgumentList "serve" -WindowStyle Hidden -ErrorAction SilentlyContinue
        }
        for ($i = 0; $i -lt 60; $i++) { if (Test-HostOllama) { break }; Start-Sleep 1 }
    }
    if (-not (Test-HostOllama)) { Die "Ollama did not come up on :11434." }

    $cmd = Get-OllamaCmd
    Info "Pulling models (llama3.1:8b + nomic-embed-text) ..."
    & $cmd pull llama3.1:8b
    & $cmd pull nomic-embed-text

    Set-EnvVar "COMPOSE_PROFILES" ""
    Set-EnvVar "OLLAMA_BASE_URL" "http://host.docker.internal:11434"
    Set-EnvVar "OLLAMA_HOST"     "http://host.docker.internal:11434"
    Info "Ollama mode: HOST"
}
# ── 3b. Docker / container Ollama ────────────────────────────────────────────
else {
    Set-EnvVar "COMPOSE_PROFILES" "container-ollama"
    Set-EnvVar "OLLAMA_BASE_URL" "http://ollama:11434"
    Set-EnvVar "OLLAMA_HOST"     "http://ollama:11434"
    Info "Ollama mode: CONTAINER"
}

# ── 4. bring the stack up ────────────────────────────────────────────────────
Info "Starting the stack: docker compose up -d"
docker compose up -d

if ($mode -eq "container") {
    Info "Waiting for the Ollama container ..."
    for ($i = 0; $i -lt 60; $i++) {
        docker compose exec -T ollama ollama list *> $null
        if ($LASTEXITCODE -eq 0) { break }
        Start-Sleep 2
    }
    Info "Pulling models inside the container ..."
    docker compose exec -T ollama ollama pull llama3.1:8b
    docker compose exec -T ollama ollama pull nomic-embed-text
}

Write-Host ""
Info "Done. Check status with: docker compose ps"
