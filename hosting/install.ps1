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
foreach ($port in @(80)) {
    $conn = Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue
    if ($conn) { $blockedPorts += $port }
}
if ($blockedPorts.Count -gt 0) {
    Write-Warn "Port(s) already in use: $($blockedPorts -join ', '). Local AI may fail to start."
} else {
    Write-OK "Required ports (80) are free"
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

# Always download the latest .env.example (single source of truth for release values)
Write-Info "Downloading .env template ..."
Invoke-WebRequest "$BASE_URL/.env.example" -OutFile ".env.example" -UseBasicParsing
Write-OK ".env.example downloaded"

# Extract release-controlled values from .env.example
$envExample    = Get-Content ".env.example"
$releasePrefix = ($envExample | Where-Object { $_ -match '^LOCAL_AI_IMAGE_PREFIX=(.+)$' } | ForEach-Object { $matches[1].Trim() } | Select-Object -First 1)
$releaseTag    = ($envExample | Where-Object { $_ -match '^LOCAL_AI_IMAGE_TAG=(.+)$' }    | ForEach-Object { $matches[1].Trim() } | Select-Object -First 1)
if (-not $releasePrefix -or -not $releaseTag) {
    Write-Fail ".env.example missing LOCAL_AI_IMAGE_PREFIX/TAG"
}

# 10. Create or update .env
# - Fresh install: copy .env.example, generate secrets.
# - Existing install: preserve user secrets but force-update LOCAL_AI_IMAGE_PREFIX/TAG
#   so old installs upgrade to the new Docker Hub account / version automatically.
if (Test-Path ".env") {
    Write-OK ".env already exists - preserving your secrets"
    $envContent = Get-Content ".env" -Raw
    $envContent = $envContent -replace '(?m)^LOCAL_AI_IMAGE_PREFIX=.*', "LOCAL_AI_IMAGE_PREFIX=$releasePrefix"
    $envContent = $envContent -replace '(?m)^LOCAL_AI_IMAGE_TAG=.*',    "LOCAL_AI_IMAGE_TAG=$releaseTag"
    Set-Content ".env" -Value $envContent -Encoding UTF8 -NoNewline
    Write-OK "Synced LOCAL_AI_IMAGE_PREFIX=$releasePrefix, LOCAL_AI_IMAGE_TAG=$releaseTag"
} else {
    Write-Info "Creating .env ..."

    # Generate secure random secrets (hex)
    $chars      = (48..57) + (97..102)
    $secret     = -join ($chars | Get-Random -Count 64 | ForEach-Object { [char]$_ })
    $ragKey     = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    $whisperKey = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })
    $updaterKey = -join ($chars | Get-Random -Count 48 | ForEach-Object { [char]$_ })

    # Copy template, then replace placeholder secrets
    Copy-Item ".env.example" ".env"
    $envContent = Get-Content ".env" -Raw
    $envContent = $envContent -replace 'DJANGO_SECRET_KEY=change-me-in-production', "DJANGO_SECRET_KEY=$secret"
    $envContent = $envContent -replace 'RAG_API_KEY=dev-rag-key-change-me',         "RAG_API_KEY=$ragKey"
    $envContent = $envContent -replace 'WHISPER_API_KEY=change-me-in-production',   "WHISPER_API_KEY=$whisperKey"
    $envContent = $envContent -replace 'UPDATER_API_KEY=change-me-in-production',   "UPDATER_API_KEY=$updaterKey"
    Set-Content ".env" -Value $envContent -Encoding UTF8 -NoNewline

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
