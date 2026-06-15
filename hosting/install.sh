#!/usr/bin/env bash
# Local AI — one-command installer
# Usage: curl -fsSL https://get.local-ai.run | bash
set -euo pipefail

# ── Configuration ────────────────────────────────────────────────────────────
# BASE_URL can be overridden for local testing (e.g. point at a local HTTP
# server serving the hosting/ folder): LOCAL_AI_BASE_URL=http://localhost:8088
BASE_URL="${LOCAL_AI_BASE_URL:-http://get.local-ai.run}"  # where install files are hosted
INSTALL_DIR="${LOCAL_AI_DIR:-$HOME/local-ai}" # override with LOCAL_AI_DIR env var
# DRY_RUN=1 (LOCAL_AI_DRY_RUN=1) tests the script's logic (OS/Ollama detection,
# .env rewriting, host vs container decision) WITHOUT pulling images, starting
# containers, pulling models, or installing the helper — safe on a machine that
# already runs the stack.
DRY_RUN="${LOCAL_AI_DRY_RUN:-0}"
MIN_DISK_GB=50
MIN_RAM_GB=8
REQUIRED_PORTS=(80)

# ── Colors ───────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'

log()  { printf "${GREEN}✓${NC}  %s\n" "$*"; }
info() { printf "${BLUE}→${NC}  %s\n" "$*"; }
warn() { printf "${YELLOW}⚠${NC}  %s\n" "$*"; }
die()  { printf "${RED}✗${NC}  %s\n" "$*" >&2; exit 1; }

# ── Ollama placement ──────────────────────────────────────────────────────────
# Default: host Ollama (installed on the machine, uses GPU/Metal — fast). Falls
# back to the bundled container only if host setup fails. Set
# FORCE_CONTAINER_OLLAMA=1 to skip host Ollama and always use the container.
FORCE_CONTAINER_OLLAMA="${FORCE_CONTAINER_OLLAMA:-0}"
OLLAMA_CHAT_MODEL="${OLLAMA_CHAT_MODEL:-llama3.1:8b}"
OLLAMA_EMBED_MODEL="${OLLAMA_EMBED_MODEL:-nomic-embed-text}"
OLLAMA_KEEP_ALIVE="${OLLAMA_KEEP_ALIVE:-30m}"

# Is a host Ollama server already responding on :11434?
host_ollama_up() {
  curl -fsS --max-time 3 http://localhost:11434/api/version >/dev/null 2>&1
}

# Install the Ollama binary on the host (Homebrew on macOS, official installer on Linux).
install_host_ollama() {
  command -v ollama >/dev/null 2>&1 && return 0
  if [[ "$OS" == "Darwin" ]]; then
    if command -v brew >/dev/null 2>&1; then
      # Use the CASK (official Ollama.app), NOT the `ollama` formula. The
      # formula builds from source and on Apple Silicon often ships without the
      # llama-server runner ("llama-server binary not found"), which breaks
      # model loading. The cask bundles the full prebuilt runtime.
      info "Installing Ollama (official app) via Homebrew cask ..."
      brew install --cask ollama >/dev/null 2>&1 || return 1
    else
      # No Homebrew — download the official Ollama.app directly so install
      # still works on a clean Mac.
      info "Homebrew not found — downloading Ollama.app from ollama.com ..."
      local zip="/tmp/Ollama-darwin.zip"
      curl -fsSL "https://ollama.com/download/Ollama-darwin.zip" -o "$zip" || { warn "Download failed — install manually from https://ollama.com/download"; return 1; }
      rm -rf "/Applications/Ollama.app"
      ditto -x -k "$zip" /Applications/ >/dev/null 2>&1 || unzip -oq "$zip" -d /Applications/ || { warn "Could not unpack Ollama.app"; return 1; }
      rm -f "$zip"
      # Clear the quarantine flag — otherwise the manually-extracted app fails
      # TLS verification when pulling models ("SecPolicyCreateSSL error").
      xattr -dr com.apple.quarantine "/Applications/Ollama.app" 2>/dev/null || true
    fi
  else
    info "Installing Ollama via ollama.com installer ..."
    curl -fsSL https://ollama.com/install.sh | sh || return 1
  fi
  command -v ollama >/dev/null 2>&1 || [[ -d "/Applications/Ollama.app" ]]
}

# Make sure a host Ollama server is running; start one in the background if not.
start_host_ollama() {
  host_ollama_up && return 0
  info "Starting host Ollama (keep_alive=${OLLAMA_KEEP_ALIVE}) ..."
  if [[ "$OS" == "Darwin" ]]; then
    launchctl setenv OLLAMA_KEEP_ALIVE "$OLLAMA_KEEP_ALIVE" 2>/dev/null || true
    [[ -d "/Applications/Ollama.app" ]] && xattr -dr com.apple.quarantine "/Applications/Ollama.app" 2>/dev/null || true
    # Start the server HEADLESS via the CLI (the cask's binary ships the full
    # runtime) instead of `open -a Ollama`, which pops up the GUI chat window.
    local obin
    obin="$(command -v ollama 2>/dev/null)"
    if [[ -z "$obin" && -x "/Applications/Ollama.app/Contents/Resources/ollama" ]]; then
      obin="/Applications/Ollama.app/Contents/Resources/ollama"
    fi
    if [[ -n "$obin" ]]; then
      OLLAMA_KEEP_ALIVE="$OLLAMA_KEEP_ALIVE" nohup "$obin" serve >/tmp/ollama-serve.log 2>&1 &
    elif [[ -d "/Applications/Ollama.app" ]]; then
      # Fallback: launch the app in the background, hidden (no foreground window).
      open -gj -a Ollama 2>/dev/null || true
    else
      return 1
    fi
  else
    command -v ollama >/dev/null 2>&1 || return 1
    OLLAMA_KEEP_ALIVE="$OLLAMA_KEEP_ALIVE" nohup ollama serve >/tmp/ollama-serve.log 2>&1 &
  fi
  local i=0
  while [[ $i -lt 30 ]]; do host_ollama_up && return 0; sleep 1; i=$((i + 1)); done
  return 1
}

# Returns 0 if host Ollama is ready (existing, or freshly installed+started).
setup_host_ollama() {
  host_ollama_up && { log "Using existing host Ollama"; return 0; }
  if [[ "$DRY_RUN" == "1" ]]; then
    info "[dry-run] host Ollama not running — would install + start it"
    return 1
  fi
  install_host_ollama || return 1
  start_host_ollama   || return 1
  host_ollama_up
}

# Pull the chat + embedding models onto the host Ollama.
pull_host_models() {
  command -v ollama >/dev/null 2>&1 || return 1
  info "Pulling models on host Ollama: $OLLAMA_CHAT_MODEL, $OLLAMA_EMBED_MODEL ..."
  ollama pull "$OLLAMA_CHAT_MODEL" || warn "Failed to pull $OLLAMA_CHAT_MODEL"
  ollama pull "$OLLAMA_EMBED_MODEL" || warn "Failed to pull $OLLAMA_EMBED_MODEL"
}

# Print the host-vs-container benefit comparison shown before the prompt.
print_placement_benefits() {
  if [[ "$OS" == "Linux" ]]; then
    cat <<EOF

  Detected OS: Linux

  Where should Ollama (the AI model engine) run?

  ┌────────────────────┬──────────────────────────────┬──────────────────────────────┐
  │                    │  [1] MACHINE (host)          │  [2] DOCKER (container)      │
  ├────────────────────┼──────────────────────────────┼──────────────────────────────┤
  │  Speed             │  Fast — uses your NVIDIA GPU │  CPU by default. GPU needs   │
  │                    │  (CUDA) if present, else CPU │  nvidia-container-toolkit    │
  │  Setup             │  Installs Ollama via the     │  Nothing to install — runs   │
  │                    │  official script (may sudo)  │  fully inside Docker         │
  │  Models stored     │  On this machine (~/.ollama) │  Inside a Docker volume      │
  │  Best for          │  Machines with an NVIDIA GPU │  Quick / portable setups,    │
  │                    │                              │  or machines without a GPU   │
  └────────────────────┴──────────────────────────────┴──────────────────────────────┘

  Tip: on Ubuntu/Linux choose MACHINE if you have an NVIDIA GPU (fastest);
  choose DOCKER for the simplest, self-contained setup. Installing host Ollama
  may prompt for your sudo password to set up the systemd service. Models you
  install later go to the same place.

EOF
  elif [[ "$ARCH" == "arm64" ]]; then
    cat <<EOF

  Detected OS: macOS (Apple Silicon)

  Where should Ollama (the AI model engine) run?

  ┌────────────────────┬──────────────────────────────┬──────────────────────────────┐
  │                    │  [1] MACHINE (host)          │  [2] DOCKER (container)      │
  ├────────────────────┼──────────────────────────────┼──────────────────────────────┤
  │  Speed             │  Fast — uses Apple Metal     │  Slower — CPU only on macOS  │
  │                    │  GPU acceleration            │  (no GPU inside Docker)      │
  │  Setup             │  Installs the Ollama app     │  Nothing to install — runs   │
  │                    │  automatically (Homebrew)    │  fully inside Docker         │
  │  Models stored     │  On this machine (~/.ollama) │  Inside a Docker volume      │
  │  Best for          │  Apple Silicon Macs (M1+)    │  Quick / portable setups     │
  └────────────────────┴──────────────────────────────┴──────────────────────────────┘

  Tip: choose MACHINE for speed (Apple Silicon GPU); choose DOCKER for the
  simplest, self-contained setup. Models you install later go to the same place.

EOF
  else
    cat <<EOF

  Detected OS: macOS (Intel)

  Where should Ollama (the AI model engine) run?

  ┌────────────────────┬──────────────────────────────┬──────────────────────────────┐
  │                    │  [1] MACHINE (host)          │  [2] DOCKER (container)      │
  ├────────────────────┼──────────────────────────────┼──────────────────────────────┤
  │  Speed             │  CPU only — Intel Macs have  │  CPU only (slightly slower   │
  │                    │  no GPU offload in Ollama    │  than native, Docker overhead)│
  │  Setup             │  Installs the Ollama app     │  Nothing to install — runs   │
  │                    │  automatically (Homebrew)    │  fully inside Docker         │
  │  Models stored     │  On this machine (~/.ollama) │  Inside a Docker volume      │
  │  Best for          │  Keeping models on the host  │  Quick / portable setups     │
  └────────────────────┴──────────────────────────────┴──────────────────────────────┘

  Tip: Intel Macs run on CPU either way (no GPU). MACHINE keeps models native;
  DOCKER is the simplest, self-contained option. Models go to the same place.

EOF
  fi
}

# Decide placement: returns "host" or "docker" on stdout.
# Order: explicit env override > forced container > interactive prompt > default host.
choose_ollama_placement() {
  # Non-interactive override (CI, automation, testing): LOCAL_AI_OLLAMA_PLACEMENT=host|docker
  case "${LOCAL_AI_OLLAMA_PLACEMENT:-}" in
    host|docker) echo "${LOCAL_AI_OLLAMA_PLACEMENT}"; return ;;
  esac
  [[ "$FORCE_CONTAINER_OLLAMA" == "1" ]] && { echo "docker"; return; }

  # Need a real terminal to ask. When piped without a TTY, default to host.
  if [[ ! -r /dev/tty ]]; then
    echo "host"; return
  fi

  print_placement_benefits >&2
  local ans
  while true; do
    printf "  Enter 1 for MACHINE or 2 for DOCKER [default: 1]: " >&2
    read -r ans </dev/tty || { echo "host"; return; }
    case "${ans:-1}" in
      1|machine|host|"")  echo "host";   return ;;
      2|docker|container) echo "docker"; return ;;
      *) printf "  Please enter 1 or 2.\n" >&2 ;;
    esac
  done
}

# ── Banner ───────────────────────────────────────────────────────────────────
printf "\n${BOLD}  Local AI — Installer${NC}\n"
printf "  ───────────────────────────────────\n\n"

# ── 1. OS check ──────────────────────────────────────────────────────────────
OS="$(uname -s)"
ARCH="$(uname -m)"   # arm64 = Apple Silicon, x86_64 = Intel Mac / Linux
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

# ── 6. RAM check ─────────────────────────────────────────────────────────────
if [[ "$OS" == "Darwin" ]]; then
  TOTAL_RAM_GB=$(( $(sysctl -n hw.memsize) / 1024 / 1024 / 1024 ))
elif [[ -f /proc/meminfo ]]; then
  TOTAL_RAM_GB=$(( $(grep MemTotal /proc/meminfo | awk '{print $2}') / 1024 / 1024 ))
fi
if [[ -n "${TOTAL_RAM_GB:-}" ]]; then
  if [[ "$TOTAL_RAM_GB" -lt "$MIN_RAM_GB" ]]; then
    warn "Low RAM: ${TOTAL_RAM_GB}GB detected. At least ${MIN_RAM_GB}GB recommended."
    warn "Local AI may run slowly or fail to start with less than ${MIN_RAM_GB}GB RAM."
  else
    log "RAM OK (${TOTAL_RAM_GB}GB)"
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
  warn "Port(s) already in use: ${PORTS_BLOCKED[*]}"
  warn "Another service is using these ports. Local AI may fail to start."
  warn "Stop the conflicting service before continuing."
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
info "Downloading docker-compose.release.yml ..."
curl -fsSL "$BASE_URL/docker-compose.release.yml" -o docker-compose.release.yml
log "docker-compose.release.yml downloaded"

info "Downloading Caddyfile ..."
curl -fsSL "$BASE_URL/Caddyfile" -o Caddyfile
log "Caddyfile downloaded"

# Always download the latest .env.example (single source of truth for release values)
info "Downloading .env template ..."
curl -fsSL "$BASE_URL/.env.example" -o .env.example
log ".env.example downloaded"

# Extract release-controlled values (Docker Hub prefix + tag) from the latest .env.example
RELEASE_PREFIX=$(grep -m1 '^LOCAL_AI_IMAGE_PREFIX=' .env.example | cut -d= -f2- | tr -d '\r')
RELEASE_TAG=$(grep -m1 '^LOCAL_AI_IMAGE_TAG=' .env.example | cut -d= -f2- | tr -d '\r')
RELEASE_STABLE_TAG=$(grep -m1 '^LOCAL_AI_STABLE_TAG=' .env.example | cut -d= -f2- | tr -d '\r')
[[ -z "$RELEASE_PREFIX" || -z "$RELEASE_TAG" ]] && die ".env.example missing LOCAL_AI_IMAGE_PREFIX/TAG"

# Cross-platform sed -i wrapper
sed_inplace() {
  if [[ "$OS" == "Darwin" ]]; then sed -i '' "$@"; else sed -i "$@"; fi
}

# Set KEY=value in .env: update the line if present, otherwise append it.
set_env_kv() {
  local key="$1" val="$2"
  if grep -q "^${key}=" .env 2>/dev/null; then
    sed_inplace "s|^${key}=.*|${key}=${val}|" .env
  else
    printf '%s=%s\n' "$key" "$val" >> .env
  fi
}

# ── 10. Create or update .env ────────────────────────────────────────────────
# - Fresh install: copy from .env.example and generate secrets.
# - Existing install: preserve user secrets but force-update release-controlled
#   values (LOCAL_AI_IMAGE_PREFIX / LOCAL_AI_IMAGE_TAG) so old installs upgrade
#   to the new Docker Hub account / version automatically.
if [[ -f ".env" ]]; then
  log ".env already exists — preserving your secrets"
  sed_inplace "s|^LOCAL_AI_IMAGE_PREFIX=.*|LOCAL_AI_IMAGE_PREFIX=${RELEASE_PREFIX}|" .env
  sed_inplace "s|^LOCAL_AI_IMAGE_TAG=.*|LOCAL_AI_IMAGE_TAG=${RELEASE_TAG}|" .env
  # Sync STABLE_TAG — add it if missing, update if present
  if [[ -n "$RELEASE_STABLE_TAG" ]]; then
    if grep -q '^LOCAL_AI_STABLE_TAG=' .env; then
      sed_inplace "s|^LOCAL_AI_STABLE_TAG=.*|LOCAL_AI_STABLE_TAG=${RELEASE_STABLE_TAG}|" .env
    else
      printf '\nLOCAL_AI_STABLE_TAG=%s\n' "$RELEASE_STABLE_TAG" >> .env
    fi
  fi
  log "Synced LOCAL_AI_IMAGE_PREFIX=${RELEASE_PREFIX}, LOCAL_AI_IMAGE_TAG=${RELEASE_TAG}, LOCAL_AI_STABLE_TAG=${RELEASE_STABLE_TAG:-$RELEASE_TAG}"
else
  cp .env.example .env

  # Auto-generate secure secrets
  if command -v openssl &>/dev/null; then
    SECRET=$(openssl rand -hex 32)
    RAG_KEY=$(openssl rand -hex 24)
    WHISPER_KEY=$(openssl rand -hex 24)
    UPDATER_KEY=$(openssl rand -hex 24)
    sed_inplace "s/change-me-in-production/$SECRET/" .env
    sed_inplace "s/dev-rag-key-change-me/$RAG_KEY/" .env
    sed_inplace "s/WHISPER_API_KEY=change-me-in-production/WHISPER_API_KEY=$WHISPER_KEY/" .env
    sed_inplace "s/UPDATER_API_KEY=change-me-in-production/UPDATER_API_KEY=$UPDATER_KEY/" .env
    log "Generated secure secret keys"
  fi

  log ".env created"
fi

# ── 10.5 Choose Ollama placement: ask the user (host vs Docker) ──────────────
# The user's choice is honoured and remembered (OLLAMA_PLACEMENT in .env) so
# models installed later from the app go to the same place. If MACHINE is
# chosen but host Ollama can't be set up, we fall back to the container so the
# app still has a working model engine.
printf "\n"
PLACEMENT="$(choose_ollama_placement)"
USE_HOST_OLLAMA=0

if [[ "$PLACEMENT" == "host" ]]; then
  info "You chose: MACHINE (host Ollama)"
  if setup_host_ollama; then
    USE_HOST_OLLAMA=1
  else
    warn "Could not set up host Ollama — falling back to the bundled container."
  fi
else
  info "You chose: DOCKER (bundled Ollama container)"
fi

if [[ "$USE_HOST_OLLAMA" == "1" ]]; then
  # No profile → the ollama container is neither pulled nor started.
  COMPOSE_PROFILE_ARGS=""
  set_env_kv OLLAMA_PLACEMENT "host"
  set_env_kv COMPOSE_PROFILES ""
  set_env_kv OLLAMA_BASE_URL "http://host.docker.internal:11434"
  set_env_kv OLLAMA_HOST "http://host.docker.internal:11434"
  log "Ollama: MACHINE / host install (GPU/Metal accelerated)"
else
  COMPOSE_PROFILE_ARGS="--profile container-ollama"
  set_env_kv OLLAMA_PLACEMENT "docker"
  set_env_kv COMPOSE_PROFILES "container-ollama"
  set_env_kv OLLAMA_BASE_URL "http://ollama:11434"
  set_env_kv OLLAMA_HOST "http://ollama:11434"
  log "Ollama: DOCKER / bundled container (CPU-only)"
fi

# In dry-run we stop here: the goal is to verify detection + .env, not to pull
# multi-GB images or touch a stack that may already be running.
if [[ "$DRY_RUN" == "1" ]]; then
  printf "\n"
  info "[dry-run] Skipping image pull, container start, model pull and helper install."
  info "[dry-run] Resulting Ollama config in $INSTALL_DIR/.env:"
  grep -E '^(COMPOSE_PROFILES|OLLAMA_BASE_URL|OLLAMA_HOST)=' .env | sed 's/^/    /'
  info "[dry-run] Would run: docker compose -f docker-compose.release.yml ${COMPOSE_PROFILE_ARGS:-<no profile>} up -d"
  printf "\n${GREEN}✓${NC}  Dry-run complete (no changes to Docker or models).\n\n"
  exit 0
fi

# ── 11. Pull images from Docker Hub ──────────────────────────────────────────
printf "\n"
info "Pulling images from Docker Hub (first run takes a few minutes) ..."
docker compose -f docker-compose.release.yml $COMPOSE_PROFILE_ARGS pull
log "All images pulled"

# ── 12. Start the stack ───────────────────────────────────────────────────────
printf "\n"
info "Starting Local AI ..."
docker compose -f docker-compose.release.yml $COMPOSE_PROFILE_ARGS up -d
log "Stack started"

# Pull models onto host Ollama (container models are baked into the image volume).
if [[ "$USE_HOST_OLLAMA" == "1" ]]; then
  printf "\n"
  pull_host_models
fi

# ── 12.5 Install 'local-ai' helper command ──────────────────────────────────
printf "\n"
info "Installing 'local-ai' command ..."
TMP_CLI=$(mktemp)
if curl -fsSL "$BASE_URL/local-ai" -o "$TMP_CLI"; then
  chmod +x "$TMP_CLI"
  if [[ -w /usr/local/bin ]]; then
    mv "$TMP_CLI" /usr/local/bin/local-ai
    log "'local-ai' command installed"
  else
    info "Need permission to install to /usr/local/bin (you may be prompted for your password)"
    if sudo mv "$TMP_CLI" /usr/local/bin/local-ai 2>/dev/null; then
      log "'local-ai' command installed"
    else
      mkdir -p "$INSTALL_DIR/bin"
      mv "$TMP_CLI" "$INSTALL_DIR/bin/local-ai" 2>/dev/null || true
      warn "Could not install to /usr/local/bin — placed at $INSTALL_DIR/bin/local-ai"
      warn "Run with full path or add $INSTALL_DIR/bin to your PATH"
    fi
  fi
else
  rm -f "$TMP_CLI"
  warn "Could not download 'local-ai' helper — skipping (use docker compose directly)"
fi

# ── 13. Wait for the app to be ready ─────────────────────────────────────────
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

# ── 14. Done ─────────────────────────────────────────────────────────────────
printf "\n${BOLD}${GREEN}  Local AI is ready!${NC}\n\n"
printf "  Open in your browser:  ${BOLD}http://local-ai.localhost${NC}\n"
printf "\n"
if [[ "$USE_HOST_OLLAMA" == "1" ]]; then
  if [[ "$OS" == "Linux" ]]; then
    printf "  Ollama runs on:  ${BOLD}this machine${NC} (uses NVIDIA GPU/CUDA if present — fast)\n"
  elif [[ "$ARCH" == "arm64" ]]; then
    printf "  Ollama runs on:  ${BOLD}this machine${NC} (Apple Metal GPU — fast)\n"
  else
    printf "  Ollama runs on:  ${BOLD}this machine${NC} (Intel Mac — CPU only)\n"
  fi
  printf "  Models you install from the app are downloaded to this machine.\n"
else
  printf "  Ollama runs in:  ${BOLD}Docker${NC} (container — CPU only)\n"
  printf "  Manage and install models from the app's Model Engines page.\n"
fi
printf "\n"
printf "  Useful commands:\n"
printf "    Stop:     local-ai stop\n"
printf "    Start:    local-ai start\n"
printf "    Logs:     local-ai logs\n"
printf "    Help:     local-ai help\n"
printf "    Update:   Open the app -> Settings -> Check for Update\n"
printf "\n"
