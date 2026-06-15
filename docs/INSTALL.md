# Install and run

## Recommended: one-command install (all platforms)

Run the official installer — it works on **macOS, Linux, and Windows**, detects Docker, pulls the pre-built images, sets up `.env`, and brings the whole stack up.

**macOS / Linux** (Terminal):

```bash
curl -fsSL https://get.local-ai.run/install.sh | bash
```

**Windows** (PowerShell):

```powershell
irm https://get.local-ai.run/install.ps1 | iex
```

Then open **http://local-ai.localhost** in your browser.

### What the installer does on each OS

| Step | macOS | Linux | Windows |
|---|---|---|---|
| Checks | Docker Desktop running, RAM/disk, port 80 | Docker Engine + Compose v2 | Docker Desktop running |
| Asks | **Where Ollama runs: [1] Machine or [2] Docker** (same prompt on all) | | |
| Auto-installs host Ollama (if MACHINE chosen) | Homebrew cask, or downloads Ollama.app | `curl ollama.com/install.sh \| sh` (systemd) | `winget`, or downloads OllamaSetup.exe |
| GPU used (MACHINE mode) | Apple Metal (Apple Silicon) / CPU (Intel) | NVIDIA CUDA if present, else CPU | NVIDIA CUDA if present, else CPU |
| Fallback | If host Ollama can't be set up → **bundled Docker container** (works everywhere) | | |
| Pulls models | `llama3.1:8b`, `nomic-embed-text` into the chosen engine | | |

> **Machine vs Docker** — Machine (host) is faster (uses the GPU); Docker is the simplest, fully self-contained option. You can change it later from **Model Engines** in the app. Models you install go to whichever engine is active. See the README's *Ollama: Machine or Docker* section.

Non-interactive / scripted installs:

```bash
# Force a placement without the prompt:
LOCAL_AI_OLLAMA_PLACEMENT=docker  curl -fsSL https://get.local-ai.run/install.sh | bash
FORCE_CONTAINER_OLLAMA=1          curl -fsSL https://get.local-ai.run/install.sh | bash
```

**Air-gapped / offline:** place `docker-images/*.tar` (and optionally `ollama_data.tgz`) as in [OFFLINE_INSTALL.md](../OFFLINE_INSTALL.md), then run `./install.sh --offline`. See [PACKAGING.md](PACKAGING.md) for building a bundle.

## Uninstall

```bash
curl -fsSL https://get.local-ai.run/uninstall.sh | bash       # macOS / Linux
```

Removes containers, project images, volumes, the install folder, and the `local-ai` command. It confirms first and asks **separately** before removing host Ollama. Flags: `--keep-volumes`, `--keep-ollama`, `--yes`.

---

## Manual setup (golden path)

This is the **golden path** for running the full stack manually: Next.js frontend, Django API, PostgreSQL, Ollama, RAG (document chat + API), Whisper, and Caddy. See [project_summary.md](../project_summary.md) for architecture.

## Prerequisites

- **Docker Desktop** (macOS/Windows) or **Docker Engine + Compose v2** (Linux)
- Roughly **8 GB+ RAM** (more is better for LLMs), **~15 GB+ free disk** for images and models
- Ports published on the host (defaults in [`docker-compose.yml`](../docker-compose.yml)): **80** (Caddy reverse proxy), **5433** (PostgreSQL), **11434** (Ollama), **8501** (RAG Streamlit). Next.js, Django, Whisper, and RAG FastAPI listen **inside** the Docker network only — the usual entry point is **Caddy on port 80** (see below). Add explicit `ports:` to `nextjs` / `django` if you need `localhost:3000` / `:8000` for debugging.

## 1. Get the code

```bash
git clone <YOUR_REPO_URL> local-ai
cd local-ai
```

For a specific release:

```bash
git checkout v1.0.0
```

## 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set at least:

- **`DJANGO_SECRET_KEY`** — use a long random value (e.g. `openssl rand -hex 32`)
- **`POSTGRES_PASSWORD`** — strong password; keep `DATABASE_URL` / compose vars consistent
- **`RAG_API_KEY`** — shared secret (Django and Next.js call the RAG service with this)
- **`WHISPER_API_KEY`** — shared secret for the Whisper service
- **`CORS_ALLOWED_ORIGINS`** — origins allowed to call the Django API (include your real frontend URL if not localhost)

Never commit `.env`.

## 3. Start services

From the repository root:

```bash
docker compose up --build -d
```

Wait until containers are healthy (first build may take several minutes).

## 4. Run database migrations

```bash
docker compose exec django python manage.py migrate
```

## 5. Pull Ollama models

**If Ollama runs in Docker** (container engine):

```bash
docker compose --profile container-ollama exec ollama ollama pull llama3.1:8b
docker compose --profile container-ollama exec ollama ollama pull nomic-embed-text
docker compose --profile container-ollama exec ollama ollama list
```

**If Ollama runs on the host machine** (MACHINE mode — recommended), pull directly on the host:

```bash
ollama pull llama3.1:8b
ollama pull nomic-embed-text
ollama list
```

> You can also pull models from the app's **Model Engines → Pull Model** screen, which lets you choose **Machine** or **Docker** as the install target.

## 6. Open the app

With the default Compose file, **Caddy** on port **80** fronts the UI and API:

- **Web app:** [http://local-ai.localhost](http://local-ai.localhost) — add a hosts entry: `127.0.0.1 local-ai.localhost`
- **Django API (via Caddy):** [http://api.local-ai.localhost](http://api.local-ai.localhost) — add `127.0.0.1 api.local-ai.localhost`

See [`Caddyfile`](../Caddyfile). **RAG Streamlit** is exposed directly at [http://localhost:8501](http://localhost:8501) if you use the document UI outside the Next.js shell.

To use `http://localhost:3000` / `http://localhost:8000` instead, publish those ports on the `nextjs` and `django` services (not enabled by default).

First-time users may need to complete **onboarding** (create an admin account) when no users exist — see [project_summary.md](../project_summary.md).

## RAG / document chat

The document Q&A UI is served by the **RAG** service (Streamlit on port **8501** in compose; FastAPI on **8080**). The Next.js app integrates with the backend; configure `RAG_URL` / `RAG_API_KEY` in the environment for the frontend build if you customize URLs.

## Troubleshooting

- **Docker daemon not running** — start Docker Desktop (or `dockerd` on Linux).
- **Missing `.env`** — Compose will warn that variables are empty; copy from `.env.example` (see [VERSIONING.md](VERSIONING.md)).
- **Port conflicts** — change host port mappings in `docker-compose.yml`.
- **"Could not set up host Ollama → falling back to the container"** — the host Ollama couldn't start. Either pick **Docker** at the prompt, or fix host Ollama (below) and re-run.
- **TLS error pulling models on macOS** (`tls: failed to verify certificate: SecPolicyCreateSSL`) — caused by a manually-extracted/quarantined Ollama.app. Do a clean reinstall:

  **macOS** (Intel or Apple Silicon):

  ```bash
  ./scripts/uninstall-ollama-mac.sh     # or the manual steps below
  ./scripts/install-ollama-mac.sh       # clean install + headless start + verify
  ```

  Or manually:

  ```bash
  pkill -9 -f ollama 2>/dev/null
  brew uninstall --cask --force ollama-app ollama 2>/dev/null; brew uninstall --force ollama 2>/dev/null
  rm -rf /Applications/Ollama.app
  brew install --cask ollama
  xattr -dr com.apple.quarantine /Applications/Ollama.app 2>/dev/null
  nohup /Applications/Ollama.app/Contents/Resources/ollama serve >/tmp/ollama.log 2>&1 &
  sleep 5 && curl -s http://localhost:11434/api/version   # expect {"version":"..."}
  ```

  **Linux:** `curl -fsSL https://ollama.com/install.sh | sh` (needs sudo), then `systemctl status ollama`.
  **Windows:** reinstall via `winget install --id Ollama.Ollama` or the installer from https://ollama.com/download.

- **Port 11434 "already in use" / "Using existing host Ollama" but it's broken** — something else is on 11434, or a stale Ollama. Check with `lsof -nP -iTCP:11434 -sTCP:LISTEN` (macOS/Linux), stop it, then re-run.

For installs **without internet** (air-gap), follow [OFFLINE_INSTALL.md](../OFFLINE_INSTALL.md).
