#!/usr/bin/env bash
# Build and push multi-platform Docker Hub images (amd64 + arm64).
# Reads LOCAL_AI_IMAGE_PREFIX and LOCAL_AI_IMAGE_TAG from .env when present.
#
# Usage (from repo root):
#   ./scripts/dockerhub-build-push.sh --push
#   ./scripts/dockerhub-build-push.sh --no-cache --push

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PREFIX="${LOCAL_AI_IMAGE_PREFIX:-aqibbuttportfolio}"
TAG="${LOCAL_AI_IMAGE_TAG:-1.0.0}"
PLATFORMS="linux/amd64,linux/arm64"

DO_PUSH=0
NO_CACHE=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push) DO_PUSH=1; shift ;;
    --no-cache) NO_CACHE=(--no-cache); shift ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--push] [--no-cache]

Builds multi-platform images (amd64 + arm64) for:
  \${LOCAL_AI_IMAGE_PREFIX}/local-ai-{django,nextjs,rag,whisper,ollama,updater}:\${LOCAL_AI_IMAGE_TAG}

Environment:
  LOCAL_AI_IMAGE_PREFIX / LOCAL_AI_IMAGE_TAG — from .env or defaults.

Options:
  --push     Push to Docker Hub (run docker login first).
  --no-cache Pass --no-cache to every build.

Note: Multi-platform builds require --push (cannot load to local Docker).
EOF
      exit 0
      ;;
    *)
      echo "Unknown option: $1 (try --help)" >&2
      exit 1
      ;;
  esac
done

log() { printf '[dockerhub] %s\n' "$*"; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Required command not found: $1" >&2
    exit 1
  }
}

require_cmd docker

# Ensure buildx builder with multi-platform support exists
if ! docker buildx inspect multiplatform-builder &>/dev/null; then
  log "Creating buildx multi-platform builder..."
  docker buildx create --name multiplatform-builder --driver docker-container --bootstrap
fi
docker buildx use multiplatform-builder

log "Namespace: ${PREFIX}  Tag: ${TAG}  Platforms: ${PLATFORMS}"

if [[ "$DO_PUSH" -eq 0 ]]; then
  log "NOTE: Multi-platform builds require --push to work."
  log "Run: ./scripts/dockerhub-build-push.sh --push"
  exit 0
fi

build_and_push() {
  local name="$1"
  local context="$2"
  local dockerfile="${3:-}"

  log "Building + pushing ${name} (${PLATFORMS})"

  local args=(
    buildx build
    --platform "$PLATFORMS"
    "${NO_CACHE[@]+"${NO_CACHE[@]}"}"
    --tag "${PREFIX}/${name}:${TAG}"
    --tag "${PREFIX}/${name}:latest"
    --push
  )

  if [[ -n "$dockerfile" ]]; then
    args+=(-f "$dockerfile")
  fi

  args+=("$context")
  docker "${args[@]}"
}

build_and_push "local-ai-django"  "./backend"  "backend/Dockerfile"
build_and_push "local-ai-nextjs"  "./frontend" "frontend/Dockerfile.prod"
build_and_push "local-ai-rag"     "./rag"
build_and_push "local-ai-whisper" "./whisper"
build_and_push "local-ai-ollama"  "./ollama"
build_and_push "local-ai-updater" "./updater"

log "All images pushed (${TAG} + latest) for platforms: ${PLATFORMS}"
