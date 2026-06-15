# Offline and air-gapped installation

Use this when the target machine **cannot** pull Docker images or Ollama models from the internet. Prepare everything on a **connected** machine, then transfer files via USB, internal share, or sneakernet.

Runtime behavior is still **local-only** (no cloud LLM APIs) once images and models are present.

## What you need to transfer

1. **Source tree** — Git checkout at a release tag, or a zip of the same commit.
2. **Docker images** — Saved as tarballs and loaded with `docker load`.
3. **Ollama models** — Pre-populated data (Docker volume backup is the most reliable for this stack).

## 1. On a connected machine: build and save images

From the project root, with `.env` present:

```bash
docker compose build
docker compose pull   # for images that use prebuilt tags (postgres, caddy, ollama)
```

Identify images used by the stack:

```bash
docker compose images -q
```

Save **public** images (examples — verify names with `docker images` on your machine):

```bash
docker save -o caddy-2-alpine.tar caddy:2-alpine
docker save -o postgres-16-alpine.tar postgres:16-alpine
docker save -o ollama-latest.tar ollama/ollama:latest
```

Save **locally built** images (names match `docker compose images` after build; often prefixed with project folder name):

```bash
# Replace PROJECT with the compose project name (directory name by default, e.g. llm-ops-backend)
docker images | grep -E 'backend|frontend|rag|whisper'
docker save -o local-ai-backend.tar    PROJECT-backend:latest
docker save -o local-ai-frontend.tar   PROJECT-frontend:latest
docker save -o local-ai-rag.tar        PROJECT-rag:latest
docker save -o local-ai-whisper.tar    PROJECT-whisper:latest
```

You can combine into one file:

```bash
docker save -o local-ai-all-images.tar \
  caddy:2-alpine postgres:16-alpine ollama/ollama:latest \
  PROJECT-backend:latest PROJECT-frontend:latest PROJECT-rag:latest PROJECT-whisper:latest
```

Copy `*.tar` plus the **project source** to the offline host.

## 2. On the offline machine: load images

```bash
docker load -i caddy-2-alpine.tar
docker load -i postgres-16-alpine.tar
docker load -i ollama-latest.tar
docker load -i local-ai-backend.tar
# ... load each tarball you transferred
```

If you used a single combined tar, one `docker load` is enough.

Then either run the **automated installer** (from the project root next to `docker-compose.yml`):

```bash
chmod +x install.sh
./install.sh --offline
```

The script loads `docker-images/*.tar`, restores `ollama_data.tgz` if present, runs `docker compose up -d`, waits for Django, and runs migrations (see [`install.sh`](install.sh)).

Or run Compose manually:

```bash
cp .env.example .env
# Edit .env — same variables as docs/INSTALL.md
docker compose up -d
```

Compose should **not** need to pull from a registry if every referenced image already exists locally. If Compose still tries to pull, ensure image names/tags match what `docker compose` expects (re-tag with `docker tag` if needed).

## 3. Ollama models without `ollama pull`

Models are stored in the **`ollama_data`** named volume (see [`docker-compose.yml`](docker-compose.yml)).

**Option A — Copy the volume from the connected machine**

On the **connected** machine, after `ollama pull` has been run inside the stack:

```bash
docker run --rm -v PROJECT_ollama_data:/from -v "$(pwd):/backup" alpine tar czf /backup/ollama_data.tgz -C /from .
```

Transfer `ollama_data.tgz` to the air-gapped host. On the **offline** machine, create the volume and restore:

```bash
docker volume create PROJECT_ollama_data
docker run --rm -v PROJECT_ollama_data:/to -v "$(pwd):/backup" alpine sh -c "cd /to && tar xzf /backup/ollama_data.tgz"
```

Replace `PROJECT` with your Compose project name (`docker compose ls` shows it).

**Option B — Export from a standalone Ollama install**

If you use Ollama on the host (not only in Docker), you can copy `~/.ollama` from the connected machine into the volume using a similar `alpine` helper container, or document a one-time import path for your team. Paths must match what the `ollama/ollama` container expects inside `/root/.ollama` (the volume mount in compose).

After restore, start the stack and confirm:

```bash
docker compose exec ollama ollama list
```

## 4. Database and application setup

Same as online install:

```bash
docker compose exec django python manage.py migrate
```

Do **not** copy `postgres_data` between unrelated machines unless you intend to clone exact user data; for a fresh offline install, let Postgres initialize from empty volume, then migrate.

## 5. Verification checklist

- [ ] `docker compose ps` shows services healthy
- [ ] `docker compose exec ollama ollama list` shows expected models
- [ ] Web UI reachable at `http://local-ai.localhost` (hosts + Caddy on port 80) or your documented URL
- [ ] Document chat / RAG works against local Ollama

## Updates in air-gapped environments

For a new release: check out the new Git tag, rebuild or re-save images on a connected machine, transfer new tarballs, load with `docker load`, and run migrations again. Re-bundle Ollama volume if models changed.

See [docs/VERSIONING.md](docs/VERSIONING.md) for tagging releases and [docs/INSTALL.md](docs/INSTALL.md) for the standard install path.
