# One-Line Installer Plan — local-ai.run

## Goal

```bash
# macOS / Linux
curl -sSL https://get.local-ai.run | bash

# Windows (PowerShell)
irm https://get.local-ai.run/install.ps1 | iex
```

User runs one command → AI system installs locally → works offline.

---

## How It Works

```
User runs curl command
        │
        ▼
Downloads install.sh from hosting (GitHub / custom domain)
        │
        ▼
Script runs locally on user's machine:
        │
        ├── 1. Check prerequisites (Docker, RAM, disk)
        ├── 2. Download project files (git clone or tarball)
        ├── 3. Create .env config
        ├── 4. Run docker compose up -d
        ├── 5. Run database migrations
        ├── 6. Pull Ollama LLM models
        └── 7. Open http://local-ai.localhost (Caddy; add hosts entries) or publish Next.js on 3000 for dev
```

---

## What the Install Script Does

### Step 1: Check Prerequisites

| Check | Required | Why |
|-------|----------|-----|
| Docker Desktop / Engine | Yes | All services run in containers |
| Docker Compose v2+ | Yes | Orchestration |
| 8GB+ RAM | Yes | Ollama needs memory for LLMs |
| 15GB+ disk space | Yes | Models + DB + Docker images |
| Port 3000 free | Yes | Next.js frontend |
| Port 8000 free | Yes | Django API |
| Port 11434 free | Yes | Ollama LLM server |
| Port 5433 free | Yes | PostgreSQL |

### Step 2: Download Project

Two options (script tries git first, falls back to tarball):

```bash
# Option A: Git clone
git clone https://github.com/YOUR_USERNAME/local-ai.git ~/local-ai

# Option B: Download release tarball
curl -L https://github.com/YOUR_USERNAME/local-ai/archive/main.tar.gz | tar -xz
```

### Step 3: Configure Environment

```bash
cd ~/local-ai
cp .env.example .env
# Generate random Django secret key
sed -i "s/change-me-in-production/$(openssl rand -hex 32)/" .env
```

### Step 4: Start Docker Services

```bash
docker compose up -d
# Waits for healthchecks (postgres, ollama)
```

### Step 5: Run Database Migrations

```bash
docker compose exec django python manage.py migrate
```

### Step 6: Pull LLM Models

```bash
docker compose exec ollama ollama pull llama3.1:8b        # 4.7 GB
docker compose exec ollama ollama pull nomic-embed-text    # 274 MB
```

### Step 7: Done

```bash
# Print success + open browser (Caddy front door; ensure hosts file has local-ai.localhost)
open http://local-ai.localhost   # macOS
xdg-open http://local-ai.localhost   # Linux
```

---

## User Experience

```bash
$ curl -sSL https://get.local-ai.run | bash

  ╔══════════════════════════════════╗
  ║   local-ai.run installer v1.0   ║
  ╚══════════════════════════════════╝

  Checking prerequisites...
  ✓ Docker found (v27.1.1)
  ✓ Docker Compose found (v2.29.1)
  ✓ 16 GB RAM available
  ✓ 42 GB disk space available

  Downloading local-ai...
  ✓ Downloaded to ~/local-ai

  Starting services...
  ✓ PostgreSQL ready
  ✓ Django ready
  ✓ Next.js ready
  ✓ Ollama ready

  Running setup...
  ✓ Database migrated
  ✓ Pulling llama3.1:8b (4.7 GB)... done
  ✓ Pulling nomic-embed-text (274 MB)... done

  ══════════════════════════════════
  ✅ local-ai is ready!

  Open:    http://local-ai.localhost (see Caddyfile / README)
  Stop:    cd ~/local-ai && docker compose down
  Start:   cd ~/local-ai && docker compose up -d
  Uninstall: cd ~/local-ai && bash scripts/uninstall.sh
  ══════════════════════════════════
```

---

## Files to Create

| File | Purpose |
|------|---------|
| `install.sh` | Bash installer for macOS / Linux |
| `install.ps1` | PowerShell installer for Windows |
| `scripts/uninstall.sh` | Clean uninstaller (stops containers, removes images, deletes files) |

---

## Hosting Options for the Script

### Option A: GitHub Raw (Free, Easiest)

```bash
# User runs:
curl -sSL https://raw.githubusercontent.com/YOUR_USERNAME/local-ai/main/install.sh | bash
```

- Free
- No domain needed
- URL is long but works

### Option B: Custom Domain (Professional)

```bash
# User runs:
curl -sSL https://get.local-ai.run | bash
```

Setup:
1. Buy domain `local-ai.run` (~$10/year from Namecheap, Cloudflare, etc.)
2. Create subdomain `get.local-ai.run`
3. Point it to GitHub Pages or a simple server that serves `install.sh`
4. Or use Cloudflare Workers to redirect to GitHub raw URL

### Option C: GitHub Pages (Free, Custom URL)

```bash
# User runs:
curl -sSL https://YOUR_USERNAME.github.io/local-ai/install.sh | bash
```

- Free
- Shorter than raw.githubusercontent.com
- Enable in repo Settings → Pages

---

## Windows Support

`curl | bash` doesn't work on native Windows. Two options:

### Option 1: PowerShell Script

```powershell
# User runs in PowerShell:
irm https://get.local-ai.run/install.ps1 | iex
```

The `install.ps1` does the same as `install.sh` but in PowerShell syntax.

### Option 2: WSL (Windows Subsystem for Linux)

```bash
# User runs in WSL terminal:
curl -sSL https://get.local-ai.run | bash
```

Same bash script works inside WSL.

---

## Uninstaller

```bash
$ cd ~/local-ai && bash scripts/uninstall.sh

  Stopping containers...
  ✓ All containers stopped

  Remove Docker images? (y/n): y
  ✓ Images removed

  Remove database data? (y/n): y
  ✓ Volumes removed

  Remove Ollama models? (y/n): y
  ✓ Models removed

  Remove project files? (y/n): y
  ✓ ~/local-ai removed

  ✅ local-ai has been completely uninstalled.
```

---

## Prerequisites for This to Work

Before building the installer, you need:

| # | What | Why |
|---|------|-----|
| 1 | **Push project to GitHub** | Script needs to download code from somewhere |
| 2 | **Public repo** (or release tarball) | Users need access without auth |
| 3 | **Working docker-compose.yml** | Already done |
| 4 | **Test on clean machine** | Verify install works from scratch |
| 5 | **(Optional) Buy domain** | For `get.local-ai.run` URL |

---

## Implementation Order

| Step | What | Depends On |
|------|------|------------|
| 1 | Push project to GitHub | Nothing |
| 2 | Create `install.sh` | Step 1 (needs repo URL) |
| 3 | Create `install.ps1` | Step 1 |
| 4 | Create `scripts/uninstall.sh` | Nothing |
| 5 | Test on clean Mac | Steps 1-2 |
| 6 | Test on clean Linux (Ubuntu) | Steps 1-2 |
| 7 | Test on Windows (WSL + PowerShell) | Steps 1-3 |
| 8 | (Optional) Setup `get.local-ai.run` domain | Steps 1-2 |
