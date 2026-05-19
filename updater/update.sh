#!/bin/sh
set -e

PROJECT_DIR="${1:-/project}"
NEW_VERSION="${2:-}"

cd "$PROJECT_DIR"

emit() {
  # Emit a progress event as a single JSON line so the streaming endpoint
  # can forward it verbatim to the frontend.
  printf '{"stage":"%s","status":"%s","percent":%s}\n' "$1" "$2" "$3"
}

emit "starting" "Starting update to ${NEW_VERSION:-latest}" 0

emit "pulling" "Pulling new images" 10
LOCAL_AI_IMAGE_TAG="${NEW_VERSION:-latest}" \
  docker compose -f "$PROJECT_DIR/docker-compose.release.yml" pull 2>&1 | while IFS= read -r line; do
    # Strip control characters and quotes that would break JSON
    clean=$(printf '%s' "$line" | tr -d '\r"' | tr '\\' '/')
    printf '{"stage":"log","status":"%s","percent":40}\n' "$clean"
done

emit "writing-env" "Saving new version to .env" 60
if [ -n "$NEW_VERSION" ] && [ -f "$PROJECT_DIR/.env" ]; then
  if grep -q "^LOCAL_AI_IMAGE_TAG=" "$PROJECT_DIR/.env"; then
    sed -i "s/^LOCAL_AI_IMAGE_TAG=.*/LOCAL_AI_IMAGE_TAG=${NEW_VERSION}/" "$PROJECT_DIR/.env"
  else
    printf '\nLOCAL_AI_IMAGE_TAG=%s\n' "$NEW_VERSION" >> "$PROJECT_DIR/.env"
  fi
fi

emit "starting-containers" "Starting updated containers" 75
LOCAL_AI_IMAGE_TAG="${NEW_VERSION:-latest}" \
  docker compose -f "$PROJECT_DIR/docker-compose.release.yml" up -d 2>&1 | while IFS= read -r line; do
    clean=$(printf '%s' "$line" | tr -d '\r"' | tr '\\' '/')
    printf '{"stage":"log","status":"%s","percent":90}\n' "$clean"
done

emit "complete" "Update complete" 100
