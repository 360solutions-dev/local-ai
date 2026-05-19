#!/usr/bin/env bash
# Friendly wrapper around dockerhub-build-push.sh.
# Usage: ./scripts/push.sh <target>
# Targets: frontend, backend, rag, whisper, ollama, updater, app, stable, all
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PUSH="$ROOT/scripts/dockerhub-build-push.sh"

show_help() {
  cat <<EOF
Usage: ./scripts/push.sh <target> [--no-cache]

Single services:
  frontend   Push Next.js (UI)              ~5 min
  backend    Push Django (API)              ~5 min
  rag        Push RAG (knowledge base)      ~5 min
  whisper    Push Whisper (speech-to-text)  ~5 min
  ollama     Push Ollama (slow!)            ~30 min
  updater    Push updater service           ~3 min

Groups:
  app        Push frontend + backend + updater   ~10 min (most common)
  stable     Push ollama + whisper + rag         ~40 min
  all        Push everything                     ~50 min

Examples:
  ./scripts/push.sh frontend
  ./scripts/push.sh backend
  ./scripts/push.sh app
  ./scripts/push.sh frontend --no-cache

Note:
  - Run docker login first (account: rizwanhameed360s).
  - Tag and prefix come from .env (LOCAL_AI_IMAGE_TAG, LOCAL_AI_IMAGE_PREFIX).
EOF
}

target="${1:-help}"
shift || true

extra_args=()
for arg in "$@"; do
  case "$arg" in
    --no-cache) extra_args+=(--no-cache) ;;
    *) echo "Unknown option: $arg" >&2; exit 1 ;;
  esac
done

case "$target" in
  frontend) "$PUSH" --only nextjs  "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  backend)  "$PUSH" --only django  "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  rag)      "$PUSH" --only rag     "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  whisper)  "$PUSH" --only whisper "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  ollama)   "$PUSH" --only ollama  "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  updater)  "$PUSH" --only updater "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  app)      "$PUSH" --only app     "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  stable)   "$PUSH" --only stable  "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  all)      "$PUSH"                "${extra_args[@]+"${extra_args[@]}"}" --push ;;
  help|-h|--help) show_help ;;
  *)
    echo "Unknown target: $target" >&2
    echo "Run: ./scripts/push.sh help" >&2
    exit 1
    ;;
esac
