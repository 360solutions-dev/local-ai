#!/usr/bin/env bash
# Local AI workspace — automated Docker setup (online or air-gapped bundle).
# Usage:
#   ./install.sh              Online: build/pull images, migrate, pull Ollama models
#   ./install.sh --offline    Load docker-images/*.tar [+ optional ollama_data.tgz], up, migrate
# See: docs/INSTALL.md, OFFLINE_INSTALL.md

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

OFFLINE=false
SKIP_PULL=false
FORCE_ENV=false
# Ollama placement: "host" (installed on the machine, GPU-accelerated, fast) or
# "container" (bundled Docker image, CPU-only on macOS, slower). Default is host
# with automatic fallback to container if host setup fails. --container-ollama
# forces the bundled container.
FORCE_CONTAINER_OLLAMA=false
OLLAMA_MODE="host"          # resolved at runtime by decide_ollama_mode()
OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"

usage() {
  cat <<'EOF'
Local AI workspace — install.sh

Options:
  --offline           Load Docker images from ./docker-images/*.tar before compose up.
                      If ./ollama_data.tgz exists, restore into the Ollama volume (see OFFLINE_INSTALL.md).
  --skip-pull         Do not run ollama pull (online mode; models already present).
  --force-env         Recreate .env from .env.example with new secrets (overwrites existing).
  --container-ollama  Force the bundled Docker Ollama container instead of host Ollama
                      (CPU-only on macOS — slower; use only if host Ollama can't be installed).
  -h, --help          Show this help.

Behaviour:
  By default the script uses host Ollama (installed on this machine, GPU/Metal
  accelerated). If Ollama is not installed it is installed automatically
  (Homebrew on macOS, ollama.com installer on Linux). If host setup fails it
  falls back to the bundled Ollama container so the app still runs.

Environment:
  OLLAMA_CHAT_MODEL     Default: llama3.1:8b
  OLLAMA_EMBED_MODEL    Default: nomic-embed-text
  OLLAMA_KEEP_ALIVE     Default: 30m (how long the model stays warm in memory)
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --offline) OFFLINE=true ;;
    --skip-pull) SKIP_PULL=true ;;
    --force-env) FORCE_ENV=true ;;
    --container-ollama) FORCE_CONTAINER_OLLAMA=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage; exit 1 ;;
  esac
  shift
done

OLLAMA_CHAT_MODEL="${OLLAMA_CHAT_MODEL:-llama3.1:8b}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"

log() { printf '\n[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { echo "Error: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "Missing required command: $1"
}

require_cmd docker
docker compose version >/dev/null 2>&1 || die "Docker Compose v2 required (use: docker compose)"
require_cmd openssl
require_cmd curl

if [[ "$OFFLINE" == true ]] && [[ "$SKIP_PULL" == false ]]; then
  SKIP_PULL=true
fi

COMPOSE_PROJECT="$(basename "$SCRIPT_DIR")"
OLLAMA_VOL="${COMPOSE_PROJECT}_ollama_data"

ensure_env() {
  if [[ -f .env ]] && [[ "$FORCE_ENV" != true ]]; then
    log "Using existing .env"
    return
  fi
  [[ -f .env.example ]] || die ".env.example not found in $SCRIPT_DIR"
  cp .env.example .env
  local sk rk wk
  sk="$(openssl rand -hex 32)"
  rk="$(openssl rand -hex 24)"
  wk="$(openssl rand -hex 24)"
  if command -v perl >/dev/null 2>&1; then
    perl -pi -e "s/^DJANGO_SECRET_KEY=.*/DJANGO_SECRET_KEY=$sk/" .env
    perl -pi -e "s/^RAG_API_KEY=.*/RAG_API_KEY=$rk/" .env
    perl -pi -e "s/^WHISPER_API_KEY=.*/WHISPER_API_KEY=$wk/" .env
  else
    die "perl is required to bootstrap .env (or install perl)"
  fi
  log "Created .env with generated secrets (use --force-env to regenerate)"
}

check_resources() {
  local df_avail
  df_avail="$(df -k . | awk 'NR==2 {print $4}')"
  # ~15GB free = 15*1024*1024 KB
  if [[ "${df_avail:-0}" -lt 1048576 ]]; then
    echo "Warning: Less than ~1 GB free disk space. Large models may fail." >&2
  fi
}

load_offline_images() {
  local dir="$SCRIPT_DIR/docker-images"
  local found=false
  if [[ -d "$dir" ]]; then
    shopt -s nullglob
    for f in "$dir"/*.tar "$dir"/*.tar.gz; do
      [[ -f "$f" ]] || continue
      found=true
      log "Loading image archive: $f"
      docker load -i "$f"
    done
    shopt -u nullglob
  fi
  if [[ "$found" != true ]]; then
    log "No docker-images/*.tar found — assuming images are already loaded"
  fi
}

restore_ollama_volume() {
  local tgz="$SCRIPT_DIR/ollama_data.tgz"
  [[ -f "$tgz" ]] || return 0
  log "Restoring Ollama data from ollama_data.tgz into volume $OLLAMA_VOL"
  docker volume inspect "$OLLAMA_VOL" >/dev/null 2>&1 || docker volume create "$OLLAMA_VOL" >/dev/null
  # Use postgres:16-alpine so we do not pull a separate image (must be loaded in offline bundles).
  docker run --rm \
    -v "${OLLAMA_VOL}:/to" \
    -v "${SCRIPT_DIR}:/backup:ro" \
    postgres:16-alpine \
    sh -c 'cd /to && tar xzf /backup/ollama_data.tgz'
  log "Ollama volume restore finished"
}

wait_for_django() {
  local max="${1:-120}"
  local i=0
  log "Waiting for Django (up to ${max}s)..."
  while [[ $i -lt "$max" ]]; do
    if docker compose exec -T django python -c \
      "import urllib.request; urllib.request.urlopen('http://localhost:8000/api/auth/setup-status/')" \
      >/dev/null 2>&1; then
      log "Django is reachable"
      return 0
    fi
    sleep 3
    i=$((i + 3))
  done
  die "Django did not become healthy in time. Check: docker compose ps && docker compose logs django"
}

compose_up() {
  if [[ "$OFFLINE" == true ]]; then
    log "Starting stack (offline: no image build/pull)..."
    docker compose up -d
  else
    log "Building and starting stack..."
    docker compose up --build -d
  fi
}

run_migrate() {
  log "Running database migrations..."
  docker compose exec -T django python manage.py migrate --noinput
}

wait_for_ollama() {
  local max=60
  local i=0
  while [[ $i -lt $max ]]; do
    if docker compose exec -T ollama ollama list >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
    i=$((i + 2))
  done
  die "Ollama container did not become ready in time. Check: docker compose logs ollama"
}

pull_models() {
  if [[ "$SKIP_PULL" == true ]]; then
    log "Skipping Ollama model pull (--skip-pull or --offline without manual pull)"
    return 0
  fi
  wait_for_ollama
  log "Pulling Ollama models (this may take a while)..."
  docker compose exec -T ollama ollama pull "$OLLAMA_CHAT_MODEL"
  docker compose exec -T ollama ollama pull "$OLLAMA_EMBED_MODEL"
}

verify_ollama() {
  log "Ollama models:"
  docker compose exec -T ollama ollama list || true
}

# ---------------------------------------------------------------------------
# Host Ollama support
# The app reaches host Ollama via http://host.docker.internal:11434. These
# helpers detect/install/start it on the host and pull models there, so model
# inference uses the machine's GPU/Metal instead of the CPU-only container.
# ---------------------------------------------------------------------------

# Rewrite a KEY=value line in .env (keys already exist via .env.example).
set_env_var() {
  local key="$1" val="$2"
  command -v perl >/dev/null 2>&1 || die "perl is required to update .env"
  perl -pi -e "s|^${key}=.*|${key}=${val}|" .env
}

detect_os() {
  case "$(uname -s)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}

# Is a host Ollama server already responding on :11434?
host_ollama_up() {
  command -v curl >/dev/null 2>&1 || return 1
  curl -fsS --max-time 3 http://localhost:11434/api/version >/dev/null 2>&1
}

install_host_ollama() {
  if command -v ollama >/dev/null 2>&1; then
    log "Ollama binary already installed on host."
    return 0
  fi
  local os; os="$(detect_os)"
  case "$os" in
    macos)
      if command -v brew >/dev/null 2>&1; then
        log "Installing Ollama via Homebrew..."
        brew install ollama || return 1
      else
        log "Homebrew not found — cannot auto-install Ollama on macOS."
        log "Install it manually from https://ollama.com/download then re-run."
        return 1
      fi
      ;;
    linux)
      log "Installing Ollama via ollama.com installer..."
      curl -fsSL https://ollama.com/install.sh | sh || return 1
      ;;
    *)
      log "Unsupported OS for automatic Ollama install."
      return 1
      ;;
  esac
  command -v ollama >/dev/null 2>&1
}

# Make sure a host Ollama server is running; start one in the background if not.
start_host_ollama() {
  if host_ollama_up; then
    return 0
  fi
  command -v ollama >/dev/null 2>&1 || return 1
  log "Starting host Ollama server (keep_alive=${OLLAMA_KEEP_ALIVE})..."
  # On macOS, persist keep_alive for GUI/launchd-started servers too.
  if [[ "$(detect_os)" == "macos" ]]; then
    launchctl setenv OLLAMA_KEEP_ALIVE "$OLLAMA_KEEP_ALIVE" 2>/dev/null || true
  fi
  OLLAMA_KEEP_ALIVE="$OLLAMA_KEEP_ALIVE" nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
  local i=0
  while [[ $i -lt 30 ]]; do
    host_ollama_up && return 0
    sleep 1
    i=$((i + 1))
  done
  return 1
}

# Try to get host Ollama fully ready. Returns non-zero to signal fallback.
setup_host_ollama() {
  if host_ollama_up; then
    log "Using existing host Ollama on :11434"
    return 0
  fi
  install_host_ollama || return 1
  start_host_ollama   || return 1
  host_ollama_up      || return 1
  return 0
}

pull_models_host() {
  if [[ "$SKIP_PULL" == true ]]; then
    log "Skipping model pull (--skip-pull)"
    return 0
  fi
  command -v ollama >/dev/null 2>&1 || die "ollama CLI not found on host for model pull"
  log "Pulling models on host Ollama (this may take a while)..."
  ollama pull "$OLLAMA_CHAT_MODEL"
  ollama pull "$OLLAMA_EMBED_MODEL"
}

verify_ollama_host() {
  log "Host Ollama models:"
  ollama list || true
}

# Decide host vs container, and write the matching values into .env.
decide_ollama_mode() {
  # Offline or explicit flag → bundled container (host install needs network).
  if [[ "$FORCE_CONTAINER_OLLAMA" == true ]] || [[ "$OFFLINE" == true ]]; then
    OLLAMA_MODE="container"
  elif setup_host_ollama; then
    OLLAMA_MODE="host"
  else
    log "Host Ollama unavailable — falling back to the bundled container (slower)."
    OLLAMA_MODE="container"
  fi

  if [[ "$OLLAMA_MODE" == "host" ]]; then
    set_env_var COMPOSE_PROFILES ""
    set_env_var OLLAMA_BASE_URL "http://host.docker.internal:11434"
    set_env_var OLLAMA_HOST "http://host.docker.internal:11434"
    log "Ollama mode: HOST (GPU/Metal accelerated)"
  else
    set_env_var COMPOSE_PROFILES "container-ollama"
    set_env_var OLLAMA_BASE_URL "http://ollama:11434"
    set_env_var OLLAMA_HOST "http://ollama:11434"
    log "Ollama mode: CONTAINER (bundled, CPU-only)"
  fi
}

print_success() {
  local ollama_note
  if [[ "$OLLAMA_MODE" == "host" ]]; then
    ollama_note="Ollama: HOST install on this machine (GPU/Metal accelerated, fast)."
  else
    ollama_note="Ollama: bundled CONTAINER (CPU-only — slower). Install host Ollama and re-run for GPU speed."
  fi
  cat <<EOF

================================================================================
Setup finished.

$ollama_note

Add these lines to your hosts file if not already present:
  - macOS/Linux: /etc/hosts
  - Windows:     C:\\Windows\\System32\\drivers\\etc\\hosts

  127.0.0.1 local-ai.localhost api.local-ai.localhost

Main web app (Caddy on port 80):
  http://local-ai.localhost

RAG document chat (Streamlit, exposed on host):
  http://localhost:8501

Django API (via Caddy hostname):
  http://api.local-ai.localhost

Ollama API (host port):
  http://localhost:11434
================================================================================
EOF
}

# --- main ---
[[ -f docker-compose.yml ]] || die "Run this script from the project root (docker-compose.yml missing)"

check_resources
ensure_env

if [[ "$OFFLINE" == true ]]; then
  load_offline_images
fi

# Choose host vs container Ollama and write the matching values into .env
# BEFORE compose_up so COMPOSE_PROFILES takes effect.
decide_ollama_mode

# Restore the bundled-Ollama volume only when we are actually using it.
if [[ "$OFFLINE" == true ]] && [[ "$OLLAMA_MODE" == "container" ]]; then
  restore_ollama_volume
fi

compose_up

# Give containers a moment before health-dependent exec
sleep 5
wait_for_django 180

run_migrate

if [[ "$OLLAMA_MODE" == "host" ]]; then
  pull_models_host
  verify_ollama_host
elif [[ "$OFFLINE" == true ]]; then
  if [[ ! -f "$SCRIPT_DIR/ollama_data.tgz" ]]; then
    echo "Warning: --offline but ollama_data.tgz not found. Load models via a connected install first, or add the tarball." >&2
  fi
  log "Offline mode: skipped ollama pull"
  wait_for_ollama
  verify_ollama
else
  pull_models
  verify_ollama
fi

print_success
