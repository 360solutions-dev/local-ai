#!/bin/sh
set -e

PROJECT_DIR="${1:-/project}"
NEW_VERSION="${2:-}"

cd "$PROJECT_DIR"

# Pull new images first — only update .env if pull succeeds.
LOCAL_AI_IMAGE_TAG="${NEW_VERSION:-latest}" \
  docker compose -f "$PROJECT_DIR/docker-compose.release.yml" pull

# Persist the new version tag in .env so the stack stays on the right tag
# after the updater itself restarts.
if [ -n "$NEW_VERSION" ] && [ -f "$PROJECT_DIR/.env" ]; then
  if grep -q "^LOCAL_AI_IMAGE_TAG=" "$PROJECT_DIR/.env"; then
    sed -i "s/^LOCAL_AI_IMAGE_TAG=.*/LOCAL_AI_IMAGE_TAG=${NEW_VERSION}/" "$PROJECT_DIR/.env"
  else
    printf '\nLOCAL_AI_IMAGE_TAG=%s\n' "$NEW_VERSION" >> "$PROJECT_DIR/.env"
  fi
fi

LOCAL_AI_IMAGE_TAG="${NEW_VERSION:-latest}" \
  docker compose -f "$PROJECT_DIR/docker-compose.release.yml" up -d
