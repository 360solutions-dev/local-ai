#!/usr/bin/env bash
# Local AI — one-command uninstaller
# Usage: curl -fsSL http://get.local-ai.run/uninstall.sh | bash
#
# Removes everything the installer created:
#   - Docker containers, the project's images, and named volumes (DB, models, logs)
#   - The install directory ($HOME/local-ai), including .env and compose files
#   - The 'local-ai' helper command
#   - (Optional, prompted) host Ollama installed on this machine
#
# Flags / env:
#   --yes                 Skip the confirmation prompt (LOCAL_AI_ASSUME_YES=1)
#   --keep-ollama         Never touch host Ollama (LOCAL_AI_KEEP_OLLAMA=1)
#   --remove-ollama       Remove host Ollama without asking (LOCAL_AI_REMOVE_OLLAMA=1)
#   --keep-volumes        Keep Docker volumes (your chats/users/models survive)
#   LOCAL_AI_DIR=<path>   Install directory (default: $HOME/local-ai)
set -euo pipefail

# ── Config / flags ────────────────────────────────────────────────────────────
INSTALL_DIR="${LOCAL_AI_DIR:-$HOME/local-ai}"
ASSUME_YES="${LOCAL_AI_ASSUME_YES:-0}"
KEEP_OLLAMA="${LOCAL_AI_KEEP_OLLAMA:-0}"
REMOVE_OLLAMA="${LOCAL_AI_REMOVE_OLLAMA:-0}"
KEEP_VOLUMES=0
IMAGE_PREFIX_DEFAULT="rizwanhameed360s"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes) ASSUME_YES=1 ;;
    --keep-ollama) KEEP_OLLAMA=1 ;;
    --remove-ollama) REMOVE_OLLAMA=1 ;;
    --keep-volumes) KEEP_VOLUMES=1 ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $1" >&2; exit 1 ;;
  esac
  shift
done

# ── Colors / helpers ──────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
log()  { printf "${GREEN}✓${NC}  %s\n" "$*"; }
info() { printf "${BLUE}→${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
die()  { printf "${RED}✗${NC}  %s\n" "$*" >&2; exit 1; }

OS="$(uname -s)"
COMPOSE_FILE="$INSTALL_DIR/docker-compose.release.yml"

# Read a KEY=value from the install .env (if present).
env_get() {
  local key="$1"
  [[ -f "$INSTALL_DIR/.env" ]] || return 0
  grep -m1 "^${key}=" "$INSTALL_DIR/.env" 2>/dev/null | cut -d= -f2- | tr -d '\r'
}

# Ask a yes/no question on the terminal. $1 = prompt, $2 = default (y/n).
confirm() {
  local prompt="$1" def="${2:-n}" ans
  if [[ "$ASSUME_YES" == "1" ]]; then return 0; fi
  [[ -r /dev/tty ]] || return 1   # no terminal → treat as "no"
  printf "%s " "$prompt" >&2
  read -r ans </dev/tty || return 1
  ans="${ans:-$def}"
  [[ "$ans" =~ ^[Yy] ]]
}

# ── Banner ────────────────────────────────────────────────────────────────────
printf "\n${BOLD}  Local AI — Uninstaller${NC}\n"
printf "  ───────────────────────────────────\n\n"

OLLAMA_PLACEMENT="$(env_get OLLAMA_PLACEMENT)"
IMAGE_PREFIX="$(env_get LOCAL_AI_IMAGE_PREFIX)"; IMAGE_PREFIX="${IMAGE_PREFIX:-$IMAGE_PREFIX_DEFAULT}"

info "Install directory: $INSTALL_DIR"
[[ -n "$OLLAMA_PLACEMENT" ]] && info "Ollama was set to: $OLLAMA_PLACEMENT"
printf "\n"
warn "This will REMOVE Local AI containers, images, the install folder, and"
if [[ "$KEEP_VOLUMES" == "1" ]]; then
  warn "KEEP your data volumes (chats, users, models)."
else
  warn "DELETE all data volumes (chats, users, and container-stored models)."
fi
printf "\n"

if ! confirm "Continue? [y/N]:" "n"; then
  die "Aborted. Nothing was removed."
fi

# ── 1. Stop & remove containers + volumes ─────────────────────────────────────
if [[ -f "$COMPOSE_FILE" ]] && command -v docker >/dev/null 2>&1; then
  info "Stopping and removing containers ..."
  DOWN_ARGS="--remove-orphans"
  [[ "$KEEP_VOLUMES" == "1" ]] || DOWN_ARGS="$DOWN_ARGS -v"
  # --profile container-ollama so the bundled ollama container is included too.
  docker compose -f "$COMPOSE_FILE" --profile container-ollama down $DOWN_ARGS 2>/dev/null || \
    docker compose -f "$COMPOSE_FILE" down $DOWN_ARGS 2>/dev/null || \
    warn "compose down had issues — continuing."
  log "Containers removed"
else
  warn "No compose file at $COMPOSE_FILE — removing any leftover containers by name."
  docker ps -aq --filter "name=local-ai-" 2>/dev/null | xargs -r docker rm -f >/dev/null 2>&1 || true
fi

# ── 2. Remove leftover named volumes (in case compose down missed them) ───────
if [[ "$KEEP_VOLUMES" != "1" ]] && command -v docker >/dev/null 2>&1; then
  info "Removing leftover volumes ..."
  docker volume ls -q 2>/dev/null | grep -E "(^|_)(postgres_data|ollama_data|whisper_models)$" \
    | xargs -r docker volume rm >/dev/null 2>&1 || true
  log "Volumes removed"
fi

# ── 3. Remove the project's Docker images ─────────────────────────────────────
if command -v docker >/dev/null 2>&1; then
  info "Removing Local AI Docker images ..."
  # Project images (rizwanhameed360s/local-ai-*) + the bundled ollama image.
  docker images --format '{{.Repository}}:{{.Tag}}' 2>/dev/null \
    | grep -E "(^|/)(${IMAGE_PREFIX}/local-ai-|local-ai-)|^ollama/ollama" \
    | xargs -r docker rmi -f >/dev/null 2>&1 || true
  log "Images removed (generic images like postgres/caddy left intact)"
fi

# ── 4. Remove the 'local-ai' helper command ───────────────────────────────────
for p in /usr/local/bin/local-ai "$INSTALL_DIR/bin/local-ai"; do
  if [[ -e "$p" ]]; then
    rm -f "$p" 2>/dev/null || sudo rm -f "$p" 2>/dev/null || true
  fi
done
log "Helper command removed"

# ── 5. Remove the install directory (logs, .env, compose files) ───────────────
if [[ -d "$INSTALL_DIR" ]]; then
  info "Removing install directory $INSTALL_DIR ..."
  rm -rf "$INSTALL_DIR" 2>/dev/null || sudo rm -rf "$INSTALL_DIR" 2>/dev/null || \
    warn "Could not fully remove $INSTALL_DIR"
  log "Install directory removed"
fi

# ── 6. Host Ollama (optional — other apps may depend on it) ───────────────────
remove_host_ollama() {
  info "Removing host Ollama ..."
  if [[ "$OS" == "Darwin" ]]; then
    osascript -e 'quit app "Ollama"' >/dev/null 2>&1 || true
    pkill -9 -f ollama 2>/dev/null || true
    if command -v brew >/dev/null 2>&1; then
      # Uninstall via brew FIRST so its records are cleared — otherwise a later
      # `rm -rf` leaves brew thinking it's still installed and a reinstall does
      # nothing ("already installed" but app missing). The GUI cask is
      # "ollama-app"; the CLI formula is "ollama". Force-remove all variants.
      brew uninstall --cask --force ollama-app >/dev/null 2>&1 || true
      brew uninstall --cask --force ollama >/dev/null 2>&1 || true
      brew uninstall --force ollama >/dev/null 2>&1 || true
    fi
    rm -rf "/Applications/Ollama.app" 2>/dev/null || true
    launchctl unsetenv OLLAMA_KEEP_ALIVE 2>/dev/null || true
  else
    sudo systemctl stop ollama 2>/dev/null || true
    sudo systemctl disable ollama 2>/dev/null || true
    sudo rm -f /etc/systemd/system/ollama.service 2>/dev/null || true
    sudo rm -f "$(command -v ollama 2>/dev/null)" 2>/dev/null || true
    sudo rm -rf /usr/share/ollama 2>/dev/null || true
  fi
  if confirm "Also delete downloaded models in ~/.ollama? [y/N]:" "n"; then
    rm -rf "$HOME/.ollama" 2>/dev/null || true
    log "Removed ~/.ollama (models)"
  fi
  log "Host Ollama removed"
}

if command -v ollama >/dev/null 2>&1 || [[ -d "/Applications/Ollama.app" ]]; then
  if [[ "$KEEP_OLLAMA" == "1" ]]; then
    info "Keeping host Ollama (--keep-ollama)."
  elif [[ "$REMOVE_OLLAMA" == "1" ]]; then
    remove_host_ollama
  else
    printf "\n"
    warn "Host Ollama is installed on this machine."
    warn "Other apps (e.g. odysseus) may also use it — removing it can break them."
    if confirm "Uninstall host Ollama too? [y/N]:" "n"; then
      remove_host_ollama
    else
      info "Keeping host Ollama."
    fi
  fi
fi

# ── Done ──────────────────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}  Local AI has been uninstalled.${NC}\n\n"
