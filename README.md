# Local AI workspace

A self-hosted stack for **private document chat** (RAG), **web UI**, authentication, and optional **speech-to-text** — powered by **Ollama** on your machine. No cloud LLM APIs are required at runtime once images and models are available.

| Doc | Purpose |
|-----|---------|
| [docs/INSTALL.md](docs/INSTALL.md) | **Recommended:** Docker Compose — clone, `.env`, `up`, migrate, pull models |
| [`install.sh`](install.sh) | **Automated:** `./install.sh` (online) or `./install.sh --offline` with `docker-images/*.tar` |
| [docs/PACKAGING.md](docs/PACKAGING.md) | Maintainer: zip an offline bundle (source + `docker save` + optional `ollama_data.tgz`) |
| [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md) | Air-gapped installs — save/load Docker images, copy Ollama volume |
| [docs/VERSIONING.md](docs/VERSIONING.md) | Git branches, release tags `vX.Y.Z`, keeping secrets out of Git |
| [project_summary.md](project_summary.md) | Architecture and feature overview |
| [docs/LEGACY_STANDALONE_RAG.md](docs/LEGACY_STANDALONE_RAG.md) | Run only the `rag/` service with Python + Ollama (no full stack) |

## Quick start (Docker)

### Option A — automated installer

```bash
chmod +x install.sh
./install.sh
```

Creates `.env` from `.env.example` with generated secrets if needed, brings the stack up, migrates, and pulls default Ollama models. For air-gapped machines, use `./install.sh --offline` after loading image tarballs per [OFFLINE_INSTALL.md](OFFLINE_INSTALL.md).

### Option B — manual

1. **Clone** this repository and check out a [release tag](docs/VERSIONING.md) if you need a fixed version.

2. **Configure:**

   ```bash
   cp .env.example .env
   ```

   Set strong values for `DJANGO_SECRET_KEY`, `POSTGRES_PASSWORD`, `RAG_API_KEY`, and `WHISPER_API_KEY` (see comments in `.env.example`).

3. **Run:**

   ```bash
   docker compose up --build -d
   docker compose exec django python manage.py migrate
   docker compose exec ollama ollama pull llama3.1:8b
   docker compose exec ollama ollama pull nomic-embed-text
   ```

4. **Open** [http://local-ai.localhost](http://local-ai.localhost) (add `127.0.0.1 local-ai.localhost` and `127.0.0.1 api.local-ai.localhost` to your hosts file — see [Caddyfile](Caddyfile)). The Next.js and Django containers are not published on 3000/8000 by default; Caddy on **port 80** is the main entry. RAG Streamlit is on [http://localhost:8501](http://localhost:8501).

Full steps and ports: **[docs/INSTALL.md](docs/INSTALL.md)**.

## What’s in the stack

- **frontend/** — Next.js UI (dashboard, chat, settings, etc.)
- **backend/** — Django REST API (auth, JWT cookies)
- **rag/** — Streamlit document chat + FastAPI (`docker-compose` runs both on ports **8501** / **8080**)
- **whisper/** — Offline speech-to-text service
- **PostgreSQL**, **Ollama**, **Caddy** — defined in [`docker-compose.yml`](docker-compose.yml)

## Configuration template

Copy [`.env.example`](.env.example) to `.env`. Never commit `.env`. The example file contains **placeholders only** — replace every secret before production or shared deployments.

## Offline use

- **Day-to-day:** After install, the app works without internet; models run locally via Ollama.
- **Air-gapped install (no registry access):** Follow **[OFFLINE_INSTALL.md](OFFLINE_INSTALL.md)** to transfer Docker images and Ollama data.

## Git and releases

Use `main` for stable code; tag releases as `v1.0.0`, etc. See **[docs/VERSIONING.md](docs/VERSIONING.md)**.

## License / project notes

Internal project documentation includes [installer_plan.md](installer_plan.md) (future one-line installer) and [CLAUDE.md](CLAUDE.md) (contributor conventions).
