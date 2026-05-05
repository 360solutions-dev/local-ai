# Local AI - Windows Installer
# Usage: irm http://get.local-ai.run/install.ps1 | iex

$BASE_URL    = "http://get.local-ai.run"
$INSTALL_DIR = "$env:USERPROFILE\local-ai"
$MIN_DISK_GB = 50
$MIN_RAM_GB  = 8

function Write-OK   { param($msg) Write-Host "✓  $msg" -ForegroundColor Green }
function Write-Info { param($msg) Write-Host "→  $msg" -ForegroundColor Cyan }
function Write-Warn { param($msg) Write-Host "⚠  $msg" -ForegroundColor Yellow }
function Write-Fail { param($msg) Write-Host "✗  $msg" -ForegroundColor Red; exit 1 }

Write-Host ""
Write-Host "  Local AI - Installer" -ForegroundColor White
Write-Host "  -----------------------------------"
Write-Host ""

# 1. Windows version check
$winVer = [System.Environment]::OSVersion.Version
if ($winVer.Major -lt 10) {
    Write-Fail "Windows $($winVer.Major) is not supported. Local AI requires Windows 10 or Windows 11. Please upgrade your OS."
}
Write-OK "Windows version OK (Windows $($winVer.Major))"

# 2. Docker installed?
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Fail "Docker is not installed. Download from https://docs.docker.com/get-docker/ then re-run."
}
Write-OK "Docker is installed"

# 3. Docker running?
docker info 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "Docker is not running. Open Docker Desktop, wait for it to start, then re-run."
}
Write-OK "Docker daemon is running"

# 4. docker compose available?
docker compose version 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) {
    Write-Fail "docker compose (v2) not found. Update Docker Desktop to the latest version."
}
Write-OK "docker compose is available"

# 5. Disk space (warn if under 50 GB)
$drive = Split-Path $INSTALL_DIR -Qualifier
$disk  = Get-PSDrive ($drive.TrimEnd(':')) -ErrorAction SilentlyContinue
if ($disk) {
    $freeGB = [math]::Round($disk.Free / 1GB, 1)
    if ($freeGB -lt $MIN_DISK_GB) {
        Write-Warn "Low disk space: ${freeGB}GB free. At least ${MIN_DISK_GB}GB recommended."
    } else {
        Write-OK "Disk space OK (${freeGB}GB free)"
    }
}

# 6. RAM check (warn if under 8 GB)
$totalRAM = (Get-CimInstance Win32_ComputerSystem).TotalPhysicalMemory
$totalRAM_GB = [math]::Round($totalRAM / 1GB, 1)
if ($totalRAM_GB -lt $MIN_RAM_GB) {
    Write-Warn "Low RAM: ${totalRAM_GB}GB detected. At least ${MIN_RAM_GB}GB recommended."
} else {
    Write-OK "RAM OK (${totalRAM_GB}GB)"
}

# 7. Ports free?
$blockedPorts = @()
foreach ($port in @(80, 5433, 11434, 8501)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $blockedPorts += $port }
}
if ($blockedPorts.Count -gt 0) {
    Write-Warn "Port(s) already in use: $($blockedPorts -join ', '). Local AI may fail to start."
} else {
    Write-OK "Required ports (80, 5433, 11434, 8501) are free"
}

# 8. Create install directory
if (Test-Path $INSTALL_DIR) {
    Write-Info "Directory $INSTALL_DIR already exists - updating files"
} else {
    New-Item -ItemType Directory -Path $INSTALL_DIR | Out-Null
    Write-OK "Created $INSTALL_DIR"
}
Set-Location $INSTALL_DIR

# 9. Download compose file and Caddyfile
Write-Info "Downloading docker-compose.release.yml ..."
Invoke-WebRequest "$BASE_URL/docker-compose.release.yml" -OutFile "docker-compose.release.yml" -UseBasicParsing
Write-OK "docker-compose.release.yml downloaded"

Write-Info "Downloading Caddyfile ..."
Invoke-WebRequest "$BASE_URL/Caddyfile" -OutFile "Caddyfile" -UseBasicParsing
Write-OK "Caddyfile downloaded"

# Read version from compose file
$CURRENT_TAG = (Select-String -Path "docker-compose.release.yml" -Pattern 'LOCAL_AI_IMAGE_TAG:-([0-9]+\.[0-9]+\.[0-9]+)' | Select-Object -First 1).Matches.Groups[1].Value
if (-not $CURRENT_TAG) { $CURRENT_TAG = "latest" }

# 10. Create .env (never overwrite existing)
if (Test-Path ".env") {
    Write-OK ".env already exists - keeping your existing settings"
} else {
    Write-Info "Creating .env ..."

    $chars      = (48..57) + (97..102)
    $secret     = -join ($chars | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    $ragKey     = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    $whisperKey = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    $updaterKey = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })

    @"
# PostgreSQL
POSTGRES_USER=localai
POSTGRES_PASSWORD=localai_dev
POSTGRES_DB=localai

# Django
DATABASE_URL=postgresql://localai:localai_dev@postgres:5432/localai
DJANGO_SECRET_KEY=$secret
DJANGO_DEBUG=false
CORS_ALLOWED_ORIGINS=http://local-ai.localhost

# RAG service
RAG_API_KEY=$ragKey
RAG_SERVICE_URL=http://rag:8080

# Ollama
OLLAMA_BASE_URL=http://ollama:11434

# Backend URL (used by Next.js to reach Django inside Docker)
BACKEND_URL=http://django:8000

# RAG URL (used by Next.js to reach RAG service inside Docker)
RAG_URL=http://rag:8080

# Whisper
WHISPER_API_KEY=$whisperKey
WHISPER_MODEL=base

# Docker Hub images
LOCAL_AI_IMAGE_PREFIX=alinawaz360
LOCAL_AI_IMAGE_TAG=$CURRENT_TAG

# Compose profiles
COMPOSE_PROFILES=container-ollama

# Updater
UPDATER_SERVICE_URL=http://updater:8070
UPDATER_API_KEY=$updaterKey
"@ | Set-Content ".env" -Encoding UTF8

    Write-OK "Generated secure secret keys"
    Write-OK ".env created"
}

# 11. Pull images
Write-Host ""
Write-Info "Pulling images from Docker Hub (first run takes a few minutes) ..."
docker compose -f docker-compose.release.yml pull
Write-OK "All images pulled"

# 12. Start the stack
Write-Host ""
Write-Info "Starting Local AI ..."
docker compose -f docker-compose.release.yml up -d
Write-OK "Stack started"

# 12.5 Install 'local-ai' helper command
Write-Host ""
Write-Info "Installing 'local-ai' command ..."
try {
    Invoke-WebRequest "$BASE_URL/local-ai.cmd" -OutFile "$INSTALL_DIR\local-ai.cmd" -UseBasicParsing
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if (-not $userPath) { $userPath = "" }
    if ($userPath -notlike "*$INSTALL_DIR*") {
        $newPath = if ($userPath) { "$userPath;$INSTALL_DIR" } else { "$INSTALL_DIR" }
        [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
        Write-OK "'local-ai' command installed (open a new terminal to use it)"
    } else {
        Write-OK "'local-ai' command installed"
    }
} catch {
    Write-Warn "Could not install 'local-ai' helper - skipping (use docker compose directly)"
}

# 13. Wait for app to be ready
Write-Host ""
Write-Info "Waiting for Local AI to be ready"
$timeout = 120
$elapsed = 0
$ready   = $false
while ($elapsed -lt $timeout) {
    try {
        $r = Invoke-WebRequest "http://localhost/api/auth/setup-status/" -UseBasicParsing -TimeoutSec 3 -ErrorAction Stop
        if ($r.StatusCode -lt 500) { $ready = $true; break }
    } catch {}
    Write-Host "." -NoNewline
    Start-Sleep 3
    $elapsed += 3
}
Write-Host ""
if (-not $ready) {
    Write-Warn "App is taking longer than expected. Check logs:"
    Write-Warn "  docker compose -f $INSTALL_DIR\docker-compose.release.yml logs"
}

# 14. Done
Write-Host ""
Write-Host "  Local AI is ready!" -ForegroundColor Green
Write-Host ""
Write-Host "  Open in your browser:  http://local-ai.localhost" -ForegroundColor White
Write-Host ""
Write-Host "  Useful commands:"
Write-Host "    Stop:     local-ai stop"
Write-Host "    Start:    local-ai start"
Write-Host "    Logs:     local-ai logs"
Write-Host "    Help:     local-ai help"
Write-Host "    Update:   Open the app -> Settings -> Check for Update"
Write-Host ""
Write-Host "  Note: open a new terminal window to use the 'local-ai' command."
Write-Host ""
