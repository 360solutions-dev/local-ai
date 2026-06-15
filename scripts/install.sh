#!/usr/bin/env bash
# Local AI — one-command installer
# Usage: curl -fsSL https://get.local-ai.run | bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
BASE_URL="https://get.local-ai.run"          # where install files are hosted
INSTALL_DIR="${LOCAL_AI_DIR:-$HOME/local-ai}" # override with LOCAL_AI_DIR env var
MIN_DISK_GB=50
MIN_RAM_GB=8
REQUIRED_PORTS=(80 5433 11434 8501)

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { printf "${GREEN}✓${NC}  %s\n" "$*"; }
info() { printf "${BLUE}→${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
die()  { printf "${RED}✗${NC}  %s\n" "$*" >&2; exit 1; }

# ── Banner ───────────────────────────────────────────────────────────────────
printf "\n${BOLD}  Local AI — Installer${NC}\n"
printf "  ───────────────────────────────────\n\n"

# ── 1. OS check ──────────────────────────────────────────────────────────────
OS="$(uname -s)"
case "$OS" in
  Linux|Darwin) ;;
  *) die "Unsupported OS: $OS. Linux and macOS are supported." ;;
esac

# ── 2. Docker installed? ─────────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  die "Docker is not installed. Install Docker Desktop from https://docs.docker.com/get-docker/ then re-run this script."
fi
log "Docker is installed"

# ── 3. Docker daemon running? ────────────────────────────────────────────────
if ! docker info &>/dev/null; then
  die "Docker is not running. Please open Docker Desktop, wait for it to start, then re-run this script."
fi
log "Docker daemon is running"

# ── 4. docker compose available? ─────────────────────────────────────────────
if ! docker compose version &>/dev/null; then
  die "docker compose (v2) not found. Update Docker Desktop to the latest version."
fi
log "docker compose is available"

# ── 5. Disk space ────────────────────────────────────────────────────────────
if command -v df &>/dev/null; then
  if [[ "$OS" == "Darwin" ]]; then
    FREE_GB=$(df -g / | awk 'NR==2 {print $4}')
  else
    FREE_GB=$(df -BG / | awk 'NR==2 {print $4}' | tr -d 'G')
  fi
  if [[ "${FREE_GB:-0}" -lt "$MIN_DISK_GB" ]]; then
    die "Not enough disk space: ${FREE_GB}GB free, at least ${MIN_DISK_GB}GB required (each AI model adds 4–15GB). Free up space and re-run."
  else
    log "Disk space OK (${FREE_GB}GB free)"
  fi
fi

# ── 6. RAM ───────────────────────────────────────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then
  TOTAL_RAM_BYTES=$(sysctl -n hw.memsize 2>/dev/null || echo 0)
  TOTAL_RAM_GB=$(( TOTAL_RAM_BYTES / 1024 / 1024 / 1024 ))
elif command -v free &>/dev/null; then
  TOTAL_RAM_GB=$(free -g | awk '/^Mem:/ {print $2}')
else
  TOTAL_RAM_GB=0
fi
if [[ "${TOTAL_RAM_GB:-0}" -lt "$MIN_RAM_GB" ]]; then
  die "Not enough RAM: ${TOTAL_RAM_GB}GB detected, at least ${MIN_RAM_GB}GB required (16GB recommended for running multiple models)."
else
  log "RAM OK (${TOTAL_RAM_GB}GB)"
  if [[ "${TOTAL_RAM_GB:-0}" -lt 16 ]]; then
    warn "16GB RAM recommended for a smooth experience with 7B+ models."
  fi
fi

# ── 7. Ports free? ───────────────────────────────────────────────────────────
PORTS_BLOCKED=()
for port in "${REQUIRED_PORTS[@]}"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN &>/dev/null 2>&1; then
    PORTS_BLOCKED+=("$port")
  fi
done
if [[ ${#PORTS_BLOCKED[@]} -gt 0 ]]; then
  die "Port(s) already in use: ${PORTS_BLOCKED[*]}. Stop the conflicting service and re-run. See docs/INSTALL.md for port customisation."
else
  log "Required ports (${REQUIRED_PORTS[*]}) are free"
fi

# ── 8. Create install directory ──────────────────────────────────────────────
if [[ -d "$INSTALL_DIR" ]]; then
  info "Directory $INSTALL_DIR already exists — updating files"
else
  mkdir -p "$INSTALL_DIR"
  log "Created $INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── 9. Download compose file and Caddyfile (always overwrite — latest version) ─
info "Downloading docker-compose.release.yml …"
curl -fsSL "$BASE_URL/docker-compose.release.yml" -o docker-compose.release.yml
log "docker-compose.release.yml downloaded"

info "Downloading Caddyfile …"
curl -fsSL "$BASE_URL/Caddyfile" -o Caddyfile
log "Caddyfile downloaded"

# ── 10. Create .env (never overwrite existing — would destroy user settings) ──
if [[ -f ".env" ]]; then
  log ".env already exists — keeping your existing settings"
else
  info "Downloading .env template …"
  curl -fsSL "$BASE_URL/.env.example" -o .env.example
  cp .env.example .env

  # Auto-generate a secure DJANGO_SECRET_KEY
  if command -v openssl &>/dev/null; then
    SECRET=$(openssl rand -hex 32)
    if [[ "$OS" == "Darwin" ]]; then
      sed -i '' "s/change-me-in-production/$SECRET/g" .env
    else
      sed -i "s/change-me-in-production/$SECRET/g" .env
    fi
    log "Generated secure DJANGO_SECRET_KEY"
  fi

  log ".env created — edit $INSTALL_DIR/.env to customise settings"
fi

# ── 11. Pull images from Docker Hub ──────────────────────────────────────────
printf "\n"
info "Pulling images from Docker Hub (this may take a few minutes on first run) …"
docker compose -f docker-compose.release.yml pull
log "All images pulled"

# ── 12. Start the stack ───────────────────────────────────────────────────────
printf "\n"
info "Starting Local AI …"
docker compose -f docker-compose.release.yml up -d
log "Stack started"

# ── 13. Wait for the app to be ready ─────────────────────────────────────────
printf "\n"
info "Waiting for Local AI to be ready"
TIMEOUT=120
ELAPSED=0
until curl -sf http://localhost/api/auth/setup-status/ &>/dev/null; do
  if [[ $ELAPSED -ge $TIMEOUT ]]; then
    warn "App is taking longer than expected. Check status with:"
    warn "  docker compose -f $INSTALL_DIR/docker-compose.release.yml logs"
    break
  fi
  printf "."
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done
printf "\n"

# ── 14. Done ─────────────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}  Local AI is ready!${NC}\n\n"
printf "  Open in your browser:  ${BOLD}http://local-ai.localhost${NC}\n"
printf "\n"
printf "  Manage:\n"
printf "    Stop:    docker compose -f $INSTALL_DIR/docker-compose.release.yml down\n"
printf "    Logs:    docker compose -f $INSTALL_DIR/docker-compose.release.yml logs -f\n"
printf "    Update:  Open the app → Settings → Check for Update\n"
printf "\n"
