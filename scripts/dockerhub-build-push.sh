#!/usr/bin/env bash
# Build and push multi-platform Docker Hub images (amd64 + arm64).
# Reads LOCAL_AI_IMAGE_PREFIX and LOCAL_AI_IMAGE_TAG from .env when present.
#
# Usage (from repo root):
#   ./scripts/dockerhub-build-push.sh --push                        # all 6 images
#   ./scripts/dockerhub-build-push.sh --only app --push             # django + nextjs + updater
#   ./scripts/dockerhub-build-push.sh --only stable --push          # ollama + whisper + rag
#   ./scripts/dockerhub-build-push.sh --only django --push          # single image
#   ./scripts/dockerhub-build-push.sh --no-cache --only app --push

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
fi

PREFIX="${LOCAL_AI_IMAGE_PREFIX:?LOCAL_AI_IMAGE_PREFIX must be set in .env (see .env.example)}"
TAG="${LOCAL_AI_IMAGE_TAG:?LOCAL_AI_IMAGE_TAG must be set in .env (see .env.example)}"
PLATFORMS="linux/amd64,linux/arm64"

DO_PUSH=0
NO_CACHE=()
ONLY="all"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --push)     DO_PUSH=1; shift ;;
    --all)      ONLY="all"; shift ;;
    --no-cache) NO_CACHE=(--no-cache); shift ;;
    --only)
      ONLY="${2:?'--only requires a value (app, stable, django, nextjs, rag, whisper, ollama, updater)'}"; shift 2 ;;
    -h|--help)
      cat <<EOF
Usage: $0 [--push] [--no-cache] [--only <group|name>]

Builds multi-platform images (amd64 + arm64) for selected services.

Groups:
  --only app      django + nextjs + updater  (most common, ~5-10 min)
  --only stable   ollama + whisper + rag     (rarely changes)
  --only all      all 6 images               (default)

Single image:
  --only django | nextjs | rag | whisper | ollama | updater

Other options:
  --push          Push to Docker Hub (run docker login first).
  --no-cache      Pass --no-cache to every build.

Environment:
  LOCAL_AI_IMAGE_PREFIX / LOCAL_AI_IMAGE_TAG — from .env or defaults.

Note: Multi-platform builds require --push (cannot load to local Docker).

Examples:
  $0 --only app --push
  $0 --only django --push
  $0 --push                   # all images
  $0 --no-cache --only app --push
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

log "Namespace: ${PREFIX}  Tag: ${TAG}  Platforms: ${PLATFORMS}  Selection: ${ONLY}"

if [[ "$DO_PUSH" -eq 0 ]]; then
  log "NOTE: Multi-platform builds require --push to work."
  log "Run: ./scripts/dockerhub-build-push.sh --only app --push"
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

build_image() {
  local img="$1"
  case "$img" in
    django)  build_and_push "local-ai-django"  "./backend"  "backend/Dockerfile" ;;
    nextjs)  build_and_push "local-ai-nextjs"  "./frontend" "frontend/Dockerfile.prod" ;;
    rag)     build_and_push "local-ai-rag"     "./rag" ;;
    whisper) build_and_push "local-ai-whisper" "./whisper" ;;
    ollama)  build_and_push "local-ai-ollama"  "./ollama" ;;
    updater) build_and_push "local-ai-updater" "./updater" ;;
    *)       echo "Unknown image: $img" >&2; exit 1 ;;
  esac
}

case "$ONLY" in
  all)
    for img in django nextjs rag whisper ollama updater; do build_image "$img"; done
    ;;
  app)
    log "Building app group: django + nextjs + updater"
    for img in django nextjs updater; do build_image "$img"; done
    ;;
  stable)
    log "Building stable group: ollama + whisper + rag"
    for img in ollama whisper rag; do build_image "$img"; done
    ;;
  django|nextjs|rag|whisper|ollama|updater)
    build_image "$ONLY"
    ;;
  *)
    echo "Unknown --only value: '$ONLY'" >&2
    echo "Valid values: all, app, stable, django, nextjs, rag, whisper, ollama, updater" >&2
    exit 1
    ;;
esac

log "Done — pushed (${TAG} + latest) for platforms: ${PLATFORMS}  selection: ${ONLY}"
