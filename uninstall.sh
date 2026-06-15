#!/usr/bin/env bash
#
# uninstall.sh — tear down the clone + docker compose setup (macOS Intel/M1, Ubuntu/Linux).
#
#   ./uninstall.sh                 # stop stack + remove volumes (data), keep host Ollama & .env
#   ./uninstall.sh --remove-ollama # also uninstall host Ollama + delete ~/.ollama (models)
#   ./uninstall.sh --keep-volumes  # keep DB / chats / models volumes
#   ./uninstall.sh --remove-env    # also delete the local .env
#   ./uninstall.sh --yes           # don't ask for confirmation
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

REMOVE_OLLAMA=false
KEEP_VOLUMES=false
REMOVE_ENV=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --remove-ollama) REMOVE_OLLAMA=true ;;
    --keep-volumes)  KEEP_VOLUMES=true ;;
    --remove-env)    REMOVE_ENV=true ;;
    --yes|-y)        ASSUME_YES=true ;;
    -h|--help) grep '^#' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }

detect_os() { case "$(uname -s)" in Darwin) echo macos;; Linux) echo linux;; *) echo unknown;; esac; }

# ── confirm ──────────────────────────────────────────────────────────────
if [[ "$ASSUME_YES" != true ]]; then
  echo "This will stop Local AI and remove its containers."
  $KEEP_VOLUMES || echo "  - Docker VOLUMES (DB, chats, container models) will be DELETED."
  $REMOVE_OLLAMA && echo "  - Host Ollama and ~/.ollama (downloaded models) will be REMOVED."
  $REMOVE_ENV && echo "  - Local .env will be DELETED."
  read -rp "Proceed? [y/N]: " ans
  [[ "${ans:-n}" =~ ^[Yy] ]] || { echo "Aborted."; exit 0; }
fi

# ── 1. stop the stack ─────────────────────────────────────────────────────
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  if [[ "$KEEP_VOLUMES" == true ]]; then
    log "Stopping stack (keeping volumes)..."
    docker compose --profile container-ollama down --remove-orphans || true
  else
    log "Stopping stack and removing volumes..."
    docker compose --profile container-ollama down -v --remove-orphans || true
  fi
else
  warn "docker compose not available — skipping container teardown."
fi

# ── 2. optionally remove host Ollama ──────────────────────────────────────
if [[ "$REMOVE_OLLAMA" == true ]]; then
  os="$(detect_os)"
  if command -v ollama >/dev/null 2>&1; then
    case "$os" in
      macos)
        command -v brew >/dev/null 2>&1 && brew services stop ollama >/dev/null 2>&1 || true
        if command -v brew >/dev/null 2>&1 && brew list ollama >/dev/null 2>&1; then
          log "Uninstalling Ollama (Homebrew)..."
          brew uninstall ollama || true
        else
          warn "Ollama not installed via brew — remove the app manually if needed."
        fi
        ;;
      linux)
        log "Stopping & removing host Ollama (Linux)..."
        sudo systemctl stop ollama 2>/dev/null || true
        sudo systemctl disable ollama 2>/dev/null || true
        sudo rm -f /etc/systemd/system/ollama.service
        sudo rm -f "$(command -v ollama)" 2>/dev/null || true
        ;;
      *) warn "Unknown OS — remove Ollama manually." ;;
    esac
  else
    warn "Ollama binary not found on host — nothing to uninstall."
  fi
  log "Removing model data at ~/.ollama ..."
  rm -rf "$HOME/.ollama"
else
  warn "Leaving host Ollama and ~/.ollama in place (use --remove-ollama to remove)."
fi

# ── 3. optionally remove .env ─────────────────────────────────────────────
if [[ "$REMOVE_ENV" == true ]] && [[ -f .env ]]; then
  log "Removing .env ..."
  rm -f .env
fi

log "Uninstall complete."
