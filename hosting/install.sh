#!/usr/bin/env bash
# Local AI — one-command installer
# Usage: curl -fsSL https://get.local-ai.run | bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
BASE_URL="http://get.local-ai.run"            # where install files are hosted
INSTALL_DIR="${LOCAL_AI_DIR:-$HOME/local-ai}" # override with LOCAL_AI_DIR env var
MIN_DISK_GB=10
REQUIRED_PORTS=(80 443)

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
    warn "Low disk space: ${FREE_GB}GB free. At least ${MIN_DISK_GB}GB recommended."
    warn "Continuing anyway — but you may run out of space during image pull."
  else
    log "Disk space OK (${FREE_GB}GB free)"
  fi
fi

# ── 6. Ports free? ───────────────────────────────────────────────────────────
PORTS_BLOCKED=()
for port in "${REQUIRED_PORTS[@]}"; do
  if lsof -iTCP:"$port" -sTCP:LISTEN &>/dev/null 2>&1; then
    PORTS_BLOCKED+=("$port")
  fi
done
if [[ ${#PORTS_BLOCKED[@]} -gt 0 ]]; then
  warn "Port(s) already in use: ${PORTS_BLOCKED[*]}"
  warn "Another service is using these ports. Local AI may fail to start."
  warn "Stop the conflicting service before continuing."
else
  log "Required ports (${REQUIRED_PORTS[*]}) are free"
fi

# ── 7. Create install directory ──────────────────────────────────────────────
if [[ -d "$INSTALL_DIR" ]]; then
  info "Directory $INSTALL_DIR already exists — updating files"
else
  mkdir -p "$INSTALL_DIR"
  log "Created $INSTALL_DIR"
fi
cd "$INSTALL_DIR"

# ── 8. Download compose file and Caddyfile (always overwrite — latest version) ─
info "Downloading docker-compose.release.yml ..."
curl -fsSL "$BASE_URL/docker-compose.release.yml" -o docker-compose.release.yml
log "docker-compose.release.yml downloaded"

info "Downloading Caddyfile ..."
curl -fsSL "$BASE_URL/Caddyfile" -o Caddyfile
log "Caddyfile downloaded"

# ── 9. Create .env (never overwrite existing — would destroy user settings) ──
if [[ -f ".env" ]]; then
  log ".env already exists — keeping your existing settings"
else
  info "Downloading .env template ..."
  curl -fsSL "$BASE_URL/.env.example" -o .env.example
  cp .env.example .env

  # Auto-generate secure secrets
  if command -v openssl &>/dev/null; then
    SECRET=$(openssl rand -hex 32)
    RAG_KEY=$(openssl rand -hex 24)
    WHISPER_KEY=$(openssl rand -hex 24)
    UPDATER_KEY=$(openssl rand -hex 24)
    if [[ "$OS" == "Darwin" ]]; then
      sed -i '' "s/change-me-in-production/$SECRET/" .env
      sed -i '' "s/dev-rag-key-change-me/$RAG_KEY/" .env
      sed -i '' "s/WHISPER_API_KEY=change-me-in-production/WHISPER_API_KEY=$WHISPER_KEY/" .env
      sed -i '' "s/UPDATER_API_KEY=change-me-in-production/UPDATER_API_KEY=$UPDATER_KEY/" .env
    else
      sed -i "s/change-me-in-production/$SECRET/" .env
      sed -i "s/dev-rag-key-change-me/$RAG_KEY/" .env
      sed -i "s/WHISPER_API_KEY=change-me-in-production/WHISPER_API_KEY=$WHISPER_KEY/" .env
      sed -i "s/UPDATER_API_KEY=change-me-in-production/UPDATER_API_KEY=$UPDATER_KEY/" .env
    fi
    log "Generated secure secret keys"
  fi

  log ".env created"
fi

# ── 10. Pull images from Docker Hub ──────────────────────────────────────────
printf "\n"
info "Pulling images from Docker Hub (first run takes a few minutes) ..."
docker compose -f docker-compose.release.yml pull
log "All images pulled"

# ── 11. Start the stack ───────────────────────────────────────────────────────
printf "\n"
info "Starting Local AI ..."
docker compose -f docker-compose.release.yml up -d
log "Stack started"

# ── 12. Wait for the app to be ready ─────────────────────────────────────────
printf "\n"
info "Waiting for Local AI to be ready"
TIMEOUT=120
ELAPSED=0
until curl -sf http://localhost/api/auth/setup-status/ &>/dev/null; do
  if [[ $ELAPSED -ge $TIMEOUT ]]; then
    warn "App is taking longer than expected. Check logs with:"
    warn "  docker compose -f $INSTALL_DIR/docker-compose.release.yml logs"
    break
  fi
  printf "."
  sleep 3
  ELAPSED=$((ELAPSED + 3))
done
printf "\n"

# ── 13. Done ─────────────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}  Local AI is ready!${NC}\n\n"
printf "  Open in your browser:  ${BOLD}http://local-ai.localhost${NC}\n"
printf "\n"
printf "  Useful commands:\n"
printf "    Stop:    docker compose -f $INSTALL_DIR/docker-compose.release.yml down\n"
printf "    Logs:    docker compose -f $INSTALL_DIR/docker-compose.release.yml logs -f\n"
printf "    Update:  Open the app -> Settings -> Check for Update\n"
printf "\n"
