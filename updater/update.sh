#!/bin/sh
set -e

PROJECT_DIR="${1:-/project}"
cd "$PROJECT_DIR"

# Detect the current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Convert SSH remote to HTTPS (public repo, no credentials needed)
REMOTE_URL=$(git remote get-url origin)
case "$REMOTE_URL" in
  git@*)
    # git@github.com:org/repo.git → https://github.com/org/repo.git
    HTTPS_URL=$(echo "$REMOTE_URL" | sed 's|git@\([^:]*\):|https://\1/|')
    ;;
  *)
    HTTPS_URL="$REMOTE_URL"
    ;;
esac

# Preserve local edits (.env tweaks, etc.) so git pull won't conflict
git stash 2>/dev/null || true

# Fast-forward only — if local commits exist, fail safely instead of merging
git pull "$HTTPS_URL" "$BRANCH" --ff-only

# Rebuild changed images and restart every container (detached).
# This command is sent to the Docker daemon via the socket; even if
# this container is killed mid-restart, the daemon finishes the job.
docker compose up -d --build
