# One-Command Setup — Complete Guide

## Overview

Users can set up the entire local-ai platform with a single command:

```bash
bash <(curl -fsSL https://get.local-ai.run)
```

No git clone. No source code downloaded. No manual configuration. Just Docker.

---

## How It Works

The command downloads a small setup script (~5 KB) that:

1. Checks your system has Docker and Docker Compose v2
2. Creates a `~/local-ai/` directory with 3 tiny config files
3. Pulls pre-built Docker images from GitHub Container Registry (GHCR)
4. Starts all 7 services via Docker Compose
5. Runs database migrations automatically
6. Prints the URL to open in your browser

After setup, you open `http://local-ai.localhost`, create your account, and install AI models from the app UI.

---

## What the Command Does (Step by Step)

```
bash <(curl -fsSL https://get.local-ai.run)
│
├─ 1. Checks prerequisites
│     ├─ Docker installed?
│     ├─ Docker Compose v2 available? (falls back to docker-compose v1)
│     └─ openssl available? (for generating secrets)
│
├─ 2. Checks disk space
│     └─ Warns if less than 1 GB free
│
├─ 3. Creates ~/local-ai/ directory
│
├─ 4. Generates .env file
│     ├─ Random DJANGO_SECRET_KEY (via openssl rand -hex 32)
│     ├─ Random RAG_API_KEY (via openssl rand -hex 24)
│     ├─ Random WHISPER_API_KEY (via openssl rand -hex 24)
│     ├─ PostgreSQL credentials
│     ├─ Internal service URLs (Django, RAG, Whisper, Ollama)
│     └─ CORS and allowed hosts configuration
│
├─ 5. Generates Caddyfile
│     ├─ Routes http://local-ai.localhost → Next.js frontend
│     └─ Routes http://api.local-ai.localhost → Django API
│
├─ 6. Generates docker-compose.prod.yml
│     ├─ 4 custom images from GHCR (pinned version tags, e.g. v1.0.0)
│     ├─ 3 public images (caddy, postgres, ollama — pinned versions)
│     ├─ All health checks configured
│     ├─ Service dependency ordering with health conditions
│     └─ Persistent volumes for data (postgres, ollama, whisper)
│
├─ 7. Configures /etc/hosts (if needed)
│     ├─ Tests if local-ai.localhost resolves to 127.0.0.1
│     ├─ macOS/most Linux: .localhost resolves automatically (RFC 6761)
│     └─ If not, adds entries with sudo prompt (one-time, persists across reboots)
│
├─ 8. Runs: docker compose up -d
│     └─ Pulls all images from GHCR and Docker Hub, starts containers
│
├─ 9. Waits for services to be healthy
│     └─ Polls Django health endpoint (up to 180 seconds)
│     └─ PostgreSQL must pass health check BEFORE Django starts (enforced by depends_on + condition)
│
├─ 10. Runs database migrations
│      └─ docker compose exec django python manage.py migrate --noinput
│      └─ Safe: only runs after PostgreSQL is confirmed healthy via health check
│
└─ 11. Prints success message
       ├─ App URL: http://local-ai.localhost
       ├─ API URL: http://api.local-ai.localhost
       ├─ Next steps (create account, install models)
       └─ Management commands (start, stop, logs, update)
```

**No AI models are installed automatically.** You choose and install models from the app's Model Engines page after setup.

---

## What Gets Created on Your Machine

Only **3 small config files** — no source code, no binaries, no scripts:

```
~/local-ai/
├── docker-compose.prod.yml   (~3 KB — tells Docker which images to run and how)
├── .env                      (~0.5 KB — auto-generated secrets and config)
└── Caddyfile                 (~0.2 KB — reverse proxy routing rules)
```

Everything else lives inside Docker containers and volumes:

| Docker Volume | Contents |
|---------------|----------|
| `postgres_data` | Your database (users, chats, settings) |
| `ollama_data` | AI models you install |
| `whisper_models` | Speech-to-text models |

---

## Design Decisions & Edge Cases

### 1. Security — Protecting `curl | bash` Against Tampering

| Threat | Mitigation |
|--------|-----------|
| **MITM / network tampering** | Script is served over **HTTPS only** (`curl -fsSL https://...`). TLS ensures integrity and authenticity in transit. |
| **Script tampered at source** | Script lives in the main GitHub repo — protected by branch protection rules, commit signing, and GitHub's infrastructure. Any change is auditable via git history. |
| **Verify-then-run option** | Users who prefer not to pipe to bash can download first and inspect: |

```bash
# Option 1: Pipe directly (most convenient)
bash <(curl -fsSL https://get.local-ai.run)

# Option 2: Download, inspect, then run (most cautious)
curl -fsSL https://get.local-ai.run -o setup.sh
cat setup.sh          # inspect the script
sha256sum setup.sh    # verify checksum against published hash
bash setup.sh
```

We publish the SHA-256 checksum of each release's `setup-remote.sh` in the GitHub release notes so users can verify integrity before running.

### 2. `local-ai.localhost` DNS — Handled Automatically

The app uses `local-ai.localhost` and `api.local-ai.localhost` as access URLs for a clean, branded experience.

**DNS resolution by OS:**

| OS | `.localhost` resolves? | Action needed |
|----|----------------------|---------------|
| **macOS** | Yes (built-in) | None |
| **Most Linux** (Ubuntu, Fedora, Arch) | Yes (systemd-resolved, RFC 6761) | None |
| **Some minimal Linux** | No | Setup script auto-adds `/etc/hosts` entry |
| **Windows (WSL)** | No | Setup script auto-adds `/etc/hosts` entry |

**The setup script handles this automatically:**

```bash
# Script tests DNS resolution:
if ! getent hosts local-ai.localhost | grep -q "127.0.0.1"; then
    echo "Adding local-ai.localhost to /etc/hosts (requires sudo)..."
    echo "127.0.0.1 local-ai.localhost api.local-ai.localhost" | sudo tee -a /etc/hosts
fi
```

- On macOS and most Linux: nothing happens, DNS already works
- On systems where it doesn't resolve: one-time `sudo` prompt, entry persists across reboots
- User is informed before `sudo` is requested — no silent privilege escalation

The Caddyfile routes by hostname:

```caddy
http://local-ai.localhost {
    reverse_proxy nextjs:3000 {
        flush_interval -1
    }
}

http://api.local-ai.localhost {
    reverse_proxy django:8000
}
```

| URL | Routes To |
|-----|-----------|
| `http://local-ai.localhost` | Next.js frontend (web app) |
| `http://api.local-ai.localhost` | Django API (direct access) |
| `http://localhost:11434` | Ollama API (advanced users) |

### 3. Database Migration Race Conditions — Fully Prevented

Migrations never race against PostgreSQL because of **three layers of protection**:

```yaml
# Layer 1: Docker Compose dependency chain
django:
  depends_on:
    postgres:
      condition: service_healthy    # Django container won't START until Postgres is healthy

# Layer 2: PostgreSQL health check
postgres:
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
    interval: 5s
    timeout: 5s
    retries: 5

# Layer 3: Setup script waits for Django's own health check
# (which internally connects to the database)
wait_for_healthy "django" "http://localhost:8000/api/auth/setup-status/" 180
# Only THEN runs migrations:
docker compose exec -T django python manage.py migrate --noinput
```

**Sequence guarantee**: PostgreSQL healthy → Django starts → Django healthy → script runs migrations. No race condition possible.

### 4. Pinned Version Tags — No `latest` in Production

**Problem**: `latest` tags are mutable — they point to whatever was pushed last. Two users installing on different days could get different versions with no way to reproduce issues.

**Solution**: The setup script pins **every image to a specific version**:

```yaml
# Production compose file uses pinned versions:
services:
  django:
    image: ghcr.io/360solutions-dev/local-ai/backend:v1.0.0    # pinned
  nextjs:
    image: ghcr.io/360solutions-dev/local-ai/frontend:v1.0.0   # pinned
  rag:
    image: ghcr.io/360solutions-dev/local-ai/rag:v1.0.0        # pinned
  whisper:
    image: ghcr.io/360solutions-dev/local-ai/whisper:v1.0.0    # pinned
  caddy:
    image: caddy:2-alpine                                       # pinned major
  postgres:
    image: postgres:16-alpine                                   # pinned major
  ollama:
    image: ollama/ollama:latest                                 # exception: user controls model versions
```

The setup script fetches the **latest stable version tag** from GitHub API at install time and writes it into the compose file. This means:
- Every install gets a known, tested version
- Reproducible: same version = same behavior
- Updates are explicit: user runs the update command to pull a newer version

```bash
# How the setup script resolves the version:
VERSION=$(curl -fsSL https://api.github.com/repos/360solutions-dev/local-ai/releases/latest | grep '"tag_name"' | cut -d'"' -f4)
# Falls back to "latest" if GitHub API is unreachable
```

### 5. Rollback & Recovery — Handling Partial Failures

The setup script is designed to be **idempotent** (safe to run multiple times) and includes a cleanup strategy:

| Failure Point | What Happens | Recovery |
|---------------|-------------|----------|
| Prerequisites missing | Script exits with clear error message | User installs Docker, re-runs script |
| .env already exists | Script **skips** .env generation (preserves existing secrets) | Safe to re-run |
| docker-compose.prod.yml exists | Script **overwrites** (config only, no data) | Safe to re-run |
| Image pull fails (network) | `docker compose up` fails, script shows error | User fixes network, re-runs script |
| Container won't start | Script shows logs for the failing container | User checks logs, re-runs script |
| Migration fails | Script shows Django error output | User checks logs, runs migration manually |
| Partial running state | Re-running script calls `docker compose up -d` which reconciles state | Existing healthy containers are untouched |

```bash
# Manual rollback (nuclear option):
cd ~/local-ai
docker compose -f docker-compose.prod.yml down -v   # stop everything, delete data
rm -rf ~/local-ai                                     # remove config files
# Then re-run the setup command fresh
```

```bash
# Soft retry (preserves data):
cd ~/local-ai
docker compose -f docker-compose.prod.yml down       # stop containers
bash <(curl -fsSL https://get.local-ai.run)          # re-run (skips existing .env)
```

### 6. Docker Compose v1 and v2 Compatibility

The setup script auto-detects and supports both versions:

```bash
# Detection logic in setup-remote.sh:
if docker compose version >/dev/null 2>&1; then
    COMPOSE_CMD="docker compose"                # v2 (plugin)
elif command -v docker-compose >/dev/null 2>&1; then
    COMPOSE_CMD="docker-compose"                # v1 (standalone)
else
    die "Docker Compose is required. Install: https://docs.docker.com/compose/install/"
fi
```

All compose commands in the script use `$COMPOSE_CMD` instead of hardcoding either version. The management commands printed at the end also use the detected version.

### 7. Safe Updates — No Data Loss

User data lives in **Docker volumes** which persist across updates:

```bash
# Update to latest version:
cd ~/local-ai

# 1. Pull new images (volumes are untouched)
docker compose -f docker-compose.prod.yml pull

# 2. Recreate containers with new images (volumes stay mounted)
docker compose -f docker-compose.prod.yml up -d

# 3. Run any new migrations (additive, never destructive)
docker compose -f docker-compose.prod.yml exec -T django python manage.py migrate --noinput
```

**What's preserved**: database (chats, users, settings), Ollama models, whisper models.
**What's replaced**: container code (new features, bug fixes).

The setup script also supports a `--update` flag for convenience:

```bash
bash <(curl -fsSL https://get.local-ai.run) --update
```

This pulls the latest version, recreates containers, and runs migrations — all while preserving data.

### 8. Checksum Verification

Each GitHub release includes a `checksums.txt` file:

```
# SHA-256 checksums for v1.0.0
a1b2c3d4...  setup-remote.sh
e5f6g7h8...  docker-compose.prod.yml
```

Users can verify before running:

```bash
curl -fsSL https://get.local-ai.run -o setup.sh
curl -fsSL https://github.com/360solutions-dev/local-ai/releases/latest/download/checksums.txt -o checksums.txt
sha256sum -c checksums.txt --ignore-missing
bash setup.sh
```

---

## Services Architecture

The platform runs 7 Docker containers:

```
┌─────────────────────────────────────────────────────────────┐
│                        User's Browser                        │
│                  http://local-ai.localhost                    │
└──────────────────────────┬──────────────────────────────────┘
                           │ port 80
                           ▼
                    ┌──────────────┐
                    │    Caddy     │ (reverse proxy)
                    │ caddy:2-alpine│
                    └──────┬───────┘
                           │
              ┌────────────┴────────────┐
              ▼                         ▼
     ┌────────────────┐      ┌──────────────────┐
     │   Next.js      │      │    Django API     │
     │   (frontend)   │      │    (backend)      │
     │ GHCR: frontend │      │ GHCR: backend     │
     └───────┬────────┘      └──┬────────┬───────┘
             │                  │        │
             │     ┌────────────┘        │
             ▼     ▼                     ▼
     ┌────────────────┐      ┌──────────────────┐
     │   RAG Service  │      │  Whisper Service  │
     │ (document chat)│      │ (speech-to-text)  │
     │  GHCR: rag     │      │ GHCR: whisper     │
     └───────┬────────┘      └──────────────────┘
             │
             ▼
     ┌────────────────┐      ┌──────────────────┐
     │    Ollama      │      │   PostgreSQL      │
     │  (AI models)   │      │   (database)      │
     │ ollama/ollama  │      │ postgres:16-alpine│
     └────────────────┘      └──────────────────┘
```

| Service | Image | Purpose |
|---------|-------|---------|
| **Caddy** | `caddy:2-alpine` | Reverse proxy — routes `local-ai.localhost` and `api.local-ai.localhost` |
| **Next.js** | `ghcr.io/.../frontend:v1.0.0` | Web UI (also proxies `/api/*` to Django internally) |
| **Django** | `ghcr.io/.../backend:v1.0.0` | REST API |
| **RAG** | `ghcr.io/.../rag:v1.0.0` | Document chat (PDFs, search) |
| **Whisper** | `ghcr.io/.../whisper:v1.0.0` | Offline speech-to-text |
| **Ollama** | `ollama/ollama:latest` | Runs AI models locally |
| **PostgreSQL** | `postgres:16-alpine` | Database |

---

## Domain Setup (`get.local-ai.run`)

To make `bash <(curl -fsSL https://get.local-ai.run)` work, you need the `local-ai.run` domain configured to serve the setup script.

### Option A: Cloudflare Redirect (Simplest — Recommended)

1. Buy `local-ai.run` domain (any registrar)
2. Use Cloudflare (free plan) to manage DNS
3. Add a redirect rule:
   - **When**: `get.local-ai.run/*`
   - **Then**: Redirect to `https://raw.githubusercontent.com/360solutions-dev/local-ai/main/setup-remote.sh`
   - **Type**: 302 (temporary redirect)

The script lives in your main GitHub repo. The domain is just a pretty URL. No infrastructure to maintain.

### Option B: GitHub Pages

1. Create a repo `360solutions-dev/get.local-ai.run`
2. Add the setup script as `index.html` (with correct `Content-Type: text/plain`)
3. Enable GitHub Pages
4. Add DNS CNAME: `get.local-ai.run` → `360solutions-dev.github.io`

### Option C: Cloudflare Worker (Most Control)

```javascript
export default {
  async fetch(request) {
    const scriptUrl = 'https://raw.githubusercontent.com/360solutions-dev/local-ai/main/setup-remote.sh';
    const response = await fetch(scriptUrl);
    return new Response(response.body, {
      headers: { 'Content-Type': 'text/plain' },
    });
  },
};
```

Benefits: download analytics, caching, version routing, geo-based logic.

---

## Pre-Built Docker Images (GHCR)

We publish 4 custom images to GitHub Container Registry:

| Image | Registry Path | Built From |
|-------|--------------|------------|
| Backend | `ghcr.io/360solutions-dev/local-ai/backend` | `backend/Dockerfile` |
| Frontend | `ghcr.io/360solutions-dev/local-ai/frontend` | `frontend/Dockerfile.prod` |
| RAG | `ghcr.io/360solutions-dev/local-ai/rag` | `rag/Dockerfile` |
| Whisper | `ghcr.io/360solutions-dev/local-ai/whisper` | `whisper/Dockerfile` |

### Why `Dockerfile.prod` for Frontend?

The existing `frontend/Dockerfile` runs `npm run dev` (hot-reload dev server). For production:
- `frontend/Dockerfile.prod` runs `npm run build` then `npm run start`
- Produces optimized, minified output
- No hot-reload, no dev overhead
- The original `frontend/Dockerfile` stays unchanged for development

### Image Tag Strategy

| Tag | Purpose | Example |
|-----|---------|---------|
| `v1.0.0` | Immutable release tag | `ghcr.io/.../backend:v1.0.0` |
| `latest` | Points to newest release (mutable) | For manual pulls only |

The setup script always writes **pinned version tags** into `docker-compose.prod.yml`, not `latest`.

---

## GitHub Actions CI/CD Pipeline

File: `.github/workflows/publish-images.yml`

### When It Runs

- **On version tag push**: `git tag v1.0.0 && git push --tags`
- **Manual trigger**: `workflow_dispatch` from GitHub UI

### What It Does

1. Checks out the repo
2. Logs into GHCR using `GITHUB_TOKEN`
3. Sets up Docker Buildx (for multi-arch builds)
4. Builds all 4 images **in parallel** (matrix strategy)
5. Pushes each image with tags: `latest` + version tag
6. Builds for both `linux/amd64` (Intel) and `linux/arm64` (Apple Silicon/ARM)
7. Generates `checksums.txt` and attaches to GitHub release

### Releasing a New Version

```bash
# 1. Make your changes, commit
git add .
git commit -m "Your changes"

# 2. Tag the release
git tag v1.0.0

# 3. Push code and tag
git push origin main --tags

# 4. GitHub Actions automatically:
#    - Builds 4 Docker images (amd64 + arm64)
#    - Pushes to GHCR with version tag + latest
#    - Generates checksums
#
# 5. New users get this version automatically
# 6. Existing users update with:
#    bash <(curl -fsSL https://get.local-ai.run) --update
```

---

## Production vs Development

| Aspect | Development | Production (One-Command) |
|--------|-------------|--------------------------|
| **Setup** | `git clone` + `./install.sh` | `bash <(curl ...)` |
| **Source code** | Required on disk | Not needed |
| **Images** | Built locally from Dockerfiles | Pre-built, pulled from GHCR |
| **Image tags** | N/A (built locally) | Pinned versions (e.g. `v1.0.0`) |
| **Frontend** | `npm run dev` (hot-reload) | `npm run build` + `npm run start` |
| **Volumes** | Source code mounted for live editing | No source volumes, code baked in |
| **AI Models** | Auto-pulled by install.sh | User installs from app UI |
| **Secrets** | Copied from .env.example | Auto-generated random values |
| **Debug mode** | `DJANGO_DEBUG=true` | `DJANGO_DEBUG=false` |
| **Access URL** | `http://local-ai.localhost` | `http://local-ai.localhost` |
| **DNS/hosts** | Manual /etc/hosts entry | Auto-configured by setup script |
| **Compose cmd** | `docker compose` | Auto-detects v1 or v2 |
| **Use case** | Contributing to the project | Running the platform |

---

## User Management Commands

After setup, all management happens from `~/local-ai/`:

```bash
cd ~/local-ai

# Start all services
docker compose -f docker-compose.prod.yml up -d

# Stop all services
docker compose -f docker-compose.prod.yml down

# View logs (all services)
docker compose -f docker-compose.prod.yml logs -f

# View logs (specific service)
docker compose -f docker-compose.prod.yml logs -f django
docker compose -f docker-compose.prod.yml logs -f nextjs

# Restart a specific service
docker compose -f docker-compose.prod.yml restart django

# Update to latest version (preserves all data)
bash <(curl -fsSL https://get.local-ai.run) --update

# Manual update (same as above, step by step)
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
docker compose -f docker-compose.prod.yml exec -T django python manage.py migrate --noinput

# Check service status
docker compose -f docker-compose.prod.yml ps
```

---

## Uninstall

```bash
cd ~/local-ai

# Stop services and remove containers (keeps your data in volumes)
docker compose -f docker-compose.prod.yml down

# Stop services and DELETE ALL DATA (database, models, everything)
docker compose -f docker-compose.prod.yml down -v

# Remove config files
rm -rf ~/local-ai

# (Optional) Remove downloaded Docker images
docker rmi $(docker images 'ghcr.io/360solutions-dev/local-ai/*' -q) 2>/dev/null
docker rmi caddy:2-alpine postgres:16-alpine ollama/ollama:latest 2>/dev/null
```

---

## Troubleshooting

### `local-ai.localhost` doesn't load in browser

The `.localhost` domain should resolve automatically on macOS and most Linux. If it doesn't:

```bash
# Check if it resolves:
ping -c 1 local-ai.localhost

# If not, add manually:
echo "127.0.0.1 local-ai.localhost api.local-ai.localhost" | sudo tee -a /etc/hosts
```

On **Windows (WSL)**, edit `C:\Windows\System32\drivers\etc\hosts` and add:
```
127.0.0.1 local-ai.localhost
127.0.0.1 api.local-ai.localhost
```

### Port 80 is already in use

Another service (Apache, Nginx, etc.) is using port 80. Either stop it or edit `docker-compose.prod.yml` to change Caddy's port:

```yaml
ports:
  - "8080:80"  # Change 80 to any available port
```

Then access via `http://local-ai.localhost:8080`.

### Services won't start

```bash
cd ~/local-ai
docker compose -f docker-compose.prod.yml ps        # Check status
docker compose -f docker-compose.prod.yml logs       # Check all logs
docker compose -f docker-compose.prod.yml down       # Stop everything
docker compose -f docker-compose.prod.yml up -d      # Restart fresh
```

### Migration errors

```bash
# Check Django logs for details:
docker compose -f docker-compose.prod.yml logs django

# Retry migration manually:
docker compose -f docker-compose.prod.yml exec -T django python manage.py migrate --noinput
```

### Re-run setup (safe, idempotent)

```bash
# Re-running the setup script is always safe:
# - Preserves existing .env (your secrets stay)
# - Regenerates compose file (picks up any fixes)
# - Reconciles container state (starts what's missing)
bash <(curl -fsSL https://get.local-ai.run)
```

### Not enough disk space

The platform needs approximately:
- ~2-3 GB for Docker images
- ~1 GB for PostgreSQL data
- AI models vary by size (shown in the app's Model Engines page before you install)

---

## Security Notes

- All secrets are randomly generated during setup — unique to each installation
- The platform runs locally only — not exposed to the internet
- No data leaves your machine (all AI models run locally via Ollama)
- The `.env` file contains your secrets — don't share it
- Setup script is served over HTTPS — protected against MITM in transit
- Script can be downloaded and inspected before running
- SHA-256 checksums published in GitHub releases for verification

---

## Files Reference

### Files created by setup script (on user's machine)

| File | Purpose |
|------|---------|
| `~/local-ai/docker-compose.prod.yml` | Docker service definitions with pinned GHCR image versions |
| `~/local-ai/.env` | Environment variables with auto-generated secrets |
| `~/local-ai/Caddyfile` | Reverse proxy routing (`local-ai.localhost` + `api.local-ai.localhost`) |

### Files in the source repo (for developers/CI)

| File | Purpose |
|------|---------|
| `setup-remote.sh` | The setup script served via `get.local-ai.run` |
| `frontend/Dockerfile.prod` | Production frontend build (used by CI) |
| `docker-compose.prod.yml` | Reference copy of the production compose file |
| `.github/workflows/publish-images.yml` | CI pipeline to build and push images |

---

## Implementation Checklist (for developers)

- [ ] Create `frontend/Dockerfile.prod` — production multi-stage build
- [ ] Create `docker-compose.prod.yml` — GHCR images, no source volumes, pinned versions
- [ ] Create `setup-remote.sh` — self-contained installer with all config as heredocs
- [ ] Create `.github/workflows/publish-images.yml` — CI to build + push images
- [ ] Update `.env.example` — add missing `RAG_SERVICE_URL`, `RAG_URL`, `WHISPER_SERVICE_URL`
- [ ] Set up `get.local-ai.run` domain — Cloudflare redirect to raw script
- [ ] Push first version tag (`v1.0.0`) to trigger image builds
- [ ] Test on clean machine: `bash <(curl -fsSL https://get.local-ai.run)`
