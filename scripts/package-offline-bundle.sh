#!/usr/bin/env bash
# Maintainer helper: stage a distributable folder with app source archive + install.sh
# Docker image tarballs must be added manually after docker save (see docs/PACKAGING.md).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
VERSION="${1:-snapshot}"
OUT="${ROOT}/dist/local-ai-offline-${VERSION}"

log() { printf '[package] %s\n' "$*"; }

require_cmd() { command -v "$1" >/dev/null 2>&1 || { echo "Missing: $1" >&2; exit 1; }; }

require_cmd git
require_cmd mkdir

rm -rf "$OUT"
mkdir -p "$OUT/docker-images"

cp "$ROOT/install.sh" "$OUT/install.sh"
chmod +x "$OUT/install.sh"

git archive --format=tar.gz --prefix=app/ HEAD > "${OUT}/app-src.tar.gz"
log "Wrote ${OUT}/app-src.tar.gz"

cat > "$OUT/docker-images/README.txt" <<'EOF'
Place Docker image archives here (*.tar), for example:
  caddy.tar postgres:16-alpine
  ollama.tar ollama/ollama:latest
  django.tar, frontend.tar, rag.tar, whisper.tar (from docker save after docker compose build)

Then extract app-src.tar.gz, merge into a single app/ tree with install.sh at the same level as docker-compose.yml,
or extract app-src.tar.gz and copy install.sh into the extracted app/ folder.

Run: ./install.sh --offline
Optional: place ollama_data.tgz next to install.sh (see OFFLINE_INSTALL.md).
EOF

cat > "$OUT/README.txt" <<EOF
Offline bundle skeleton (version label: ${VERSION})

1. On a connected machine: docker compose build && docker compose pull, then docker save each image into docker-images/
2. Optional: create ollama_data.tgz per OFFLINE_INSTALL.md
3. Extract app-src.tar.gz:  mkdir -p app && tar xzf app-src.tar.gz -C .
4. Copy install.sh into app/ (same directory as docker-compose.yml), copy docker-images/ and ollama_data.tgz beside it
5. cd app && ../install.sh --offline   OR place everything so install.sh and docker-compose.yml are in one directory

See docs/PACKAGING.md in the repository for the full procedure.
EOF

log "Staged: $OUT"
log "Next: add *.tar to docker-images/, add ollama_data.tgz (optional), zip the dist folder for end users."
