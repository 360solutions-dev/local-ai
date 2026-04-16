# Install and run (Docker — recommended)

## One-command setup (optional)

From the repository root (same directory as `docker-compose.yml`):

```bash
chmod +x install.sh
./install.sh
```

- **Online:** builds/pulls images, creates `.env` with generated secrets if missing, waits for Django, runs migrations, pulls default Ollama models (`llama3.1:8b`, `nomic-embed-text`). Override with `OLLAMA_CHAT_MODEL` / `OLLAMA_EMBED_MODEL`.
- **Air-gapped:** place `docker-images/*.tar` (and optionally `ollama_data.tgz`) as described in [OFFLINE_INSTALL.md](../OFFLINE_INSTALL.md), then run `./install.sh --offline`.

See also [PACKAGING.md](PACKAGING.md) for how maintainers zip a full offline bundle.

---

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

Run inside the **ollama** container (adjust model names if your app config differs):

```bash
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull nomic-embed-text
```

Verify:

```bash
docker compose exec ollama ollama list
```

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

For installs **without internet** (air-gap), follow [OFFLINE_INSTALL.md](../OFFLINE_INSTALL.md).
