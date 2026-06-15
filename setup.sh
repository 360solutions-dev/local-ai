#!/usr/bin/env bash
#
# setup.sh — interactive setup for the clone + docker compose path.
#            Works on macOS (Intel + Apple Silicon/M1) and Ubuntu/Linux.
#            Windows users: run setup.ps1 instead.
#
#   git clone https://github.com/360solutions-dev/local-ai
#   cd local-ai
#   ./setup.sh
#
# Like install.sh's prompt, this asks where Ollama should run (Machine vs
# Docker), installs/points to it, writes .env, and brings the stack up.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── helpers ──────────────────────────────────────────────────────────────
log()  { printf '\033[1;32m==>\033[0m %s\n' "$*"; }
warn() { printf '\033[1;33m[!]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[x]\033[0m %s\n' "$*" >&2; exit 1; }

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}

# set_env_var KEY VALUE  — create or replace KEY=VALUE in .env
set_env_var() {
  local key="$1" val="$2"
  if grep -qE "^${key}=" .env; then
    perl -pi -e "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

gen_secret() { openssl rand -hex 32; }

# ── 0. prerequisites ─────────────────────────────────────────────────────
command -v docker >/dev/null 2>&1 || die "Docker is required. Install Docker Desktop / Engine first."
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 required (use: docker compose)."
command -v perl >/dev/null 2>&1 || die "perl is required to edit .env."

# ── 1. .env + secrets ────────────────────────────────────────────────────
if [[ ! -f .env ]]; then
  [[ -f .env.example ]] || die ".env.example not found in $SCRIPT_DIR"
  cp .env.example .env
  log "Created .env from .env.example"
fi

# Replace any placeholder secrets so the stack isn't insecure by default.
for pair in \
  "DJANGO_SECRET_KEY:change-me-in-production" \
  "RAG_API_KEY:dev-rag-key-change-me" \
  "WHISPER_API_KEY:change-me-in-production" \
  "UPDATER_API_KEY:change-me-in-production"; do
  key="${pair%%:*}"; placeholder="${pair#*:}"
  if grep -qE "^${key}=${placeholder}$" .env; then
    set_env_var "$key" "$(gen_secret)"
    log "Generated $key"
  fi
done

# ── 2. ask where Ollama should run ───────────────────────────────────────
echo
echo "Where should Ollama (the model engine) run?"
echo "  1) Machine  — install Ollama on this host (GPU/Metal accelerated, fast)"
echo "  2) Docker   — bundled container, nothing to install (CPU-only, slower)"
echo
read -rp "Choose [1/2] (default 1): " choice
choice="${choice:-1}"

OLLAMA_MODE="host"
[[ "$choice" == "2" ]] && OLLAMA_MODE="container"

# ── 3a. Machine / host Ollama ────────────────────────────────────────────
if [[ "$OLLAMA_MODE" == "host" ]]; then
  if ! command -v ollama >/dev/null 2>&1; then
    os="$(detect_os)"
    case "$os" in
      macos)
        if command -v brew >/dev/null 2>&1; then
          log "Installing Ollama via Homebrew..."
          brew install ollama
        else
          die "Homebrew not found. Install Ollama from https://ollama.com/download then re-run, or choose Docker (2)."
        fi
        ;;
      linux)
        log "Installing Ollama via official installer..."
        curl -fsSL https://ollama.com/install.sh | sh
        ;;
      *) die "Unsupported OS for auto-install. Install Ollama manually or choose Docker (2)." ;;
    esac
  else
    log "Ollama already installed on host."
  fi

  # The server stores its signing key in ~/.ollama; a missing dir causes
  # "open ~/.ollama/id_ed25519: no such file or directory" on the first pull.
  mkdir -p "$HOME/.ollama"

  # Start the server if it isn't already answering on :11434.
  if ! curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1; then
    log "Starting Ollama server..."
    if [[ "$(detect_os)" == "macos" ]] && command -v brew >/dev/null 2>&1; then
      # brew-managed service is the reliable way to keep it running on macOS.
      brew services start ollama >/dev/null 2>&1 || (ollama serve >/dev/null 2>&1 &)
    else
      (ollama serve >/dev/null 2>&1 &)
    fi
    # Wait until the API actually responds (model pull needs a live server).
    for _ in $(seq 1 60); do
      curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1 && break
      sleep 1
    done
  fi
  curl -fsS http://localhost:11434/api/tags >/dev/null 2>&1 || die "Ollama did not come up on :11434."

  log "Pulling models (llama3.1:8b + nomic-embed-text)..."
  ollama pull llama3.1:8b
  ollama pull nomic-embed-text

  set_env_var COMPOSE_PROFILES ""
  set_env_var OLLAMA_BASE_URL "http://host.docker.internal:11434"
  set_env_var OLLAMA_HOST     "http://host.docker.internal:11434"
  log "Ollama mode: HOST"

# ── 3b. Docker / container Ollama ────────────────────────────────────────
else
  set_env_var COMPOSE_PROFILES "container-ollama"
  set_env_var OLLAMA_BASE_URL "http://ollama:11434"
  set_env_var OLLAMA_HOST     "http://ollama:11434"
  log "Ollama mode: CONTAINER"
fi

# ── 4. bring the stack up ────────────────────────────────────────────────
log "Starting the stack: docker compose up -d"
docker compose up -d

# Container mode: wait for Ollama, then pull the models inside the container.
if [[ "$OLLAMA_MODE" == "container" ]]; then
  log "Waiting for the Ollama container..."
  for _ in $(seq 1 60); do
    docker compose exec -T ollama ollama list >/dev/null 2>&1 && break
    sleep 2
  done
  log "Pulling models inside the container..."
  docker compose exec -T ollama ollama pull llama3.1:8b
  docker compose exec -T ollama ollama pull nomic-embed-text
fi

echo
log "Done. App should be reachable shortly. Check with: docker compose ps"
