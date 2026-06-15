# Packaging an offline release bundle

End users with **no registry access** need: application source, pre-saved Docker images, and optionally a pre-filled Ollama volume archive. The root [`install.sh`](../install.sh) script automates setup once those files are in place.

## Layout to ship (USB, internal share, or zip)

**Recommended:** one directory that contains **both** `install.sh` and `docker-compose.yml` (same as this repository’s root layout).

```
local-ai-release/
  install.sh                 # chmod +x
  docker-compose.yml
  .env.example
  ollama_data.tgz            # optional; from connected machine backup (see OFFLINE_INSTALL.md)
  docker-images/
    caddy.tar                # docker save output (any *.tar names work)
    postgres.tar
    ollama.tar
    django.tar
    frontend.tar
    rag.tar
    whisper.tar
  backend/
  frontend/
  rag/
  ...
```

Run from that directory:

```bash
./install.sh --offline
```

If you distribute only `app-src.tar.gz` from [`scripts/package-offline-bundle.sh`](../scripts/package-offline-bundle.sh), extract it — it expands with an `app/` prefix — then **copy `install.sh` into `app/`** (next to `docker-compose.yml`), copy `docker-images/` and optional `ollama_data.tgz` beside them, and run `./install.sh --offline` from inside `app/`.

## Maintainer steps (connected machine)

1. **Tag a release** — see [VERSIONING.md](VERSIONING.md).

2. **Build and save images** (from project root with `.env` present):

   ```bash
   docker compose build
   docker compose pull
   mkdir -p docker-images
   # Save each image — names from: docker compose images
   docker save -o docker-images/caddy.tar caddy:2-alpine
   docker save -o docker-images/postgres.tar postgres:16-alpine
   docker save -o docker-images/ollama.tar ollama/ollama:latest
   docker save -o docker-images/django.tar "$(docker compose images -q django | head -1)"
   # ... repeat for nextjs, rag, whisper using actual image IDs/names from docker images
   ```

   Alternatively use one combined tarball (single `docker load`).

3. **Optional Ollama volume** — after `ollama pull` inside a running stack:

   ```bash
   docker run --rm -v "${COMPOSE_PROJECT}_ollama_data:/from" -v "$(pwd):/backup" postgres:16-alpine \
     tar czf /backup/ollama_data.tgz -C /from .
   ```

   Use the real volume name from `docker volume ls` (see [OFFLINE_INSTALL.md](../OFFLINE_INSTALL.md)).

4. **Create a zip** for distribution:

   ```bash
   zip -r local-ai-offline-v1.0.0.zip install.sh docker-images ollama_data.tgz \
     --exclude '*.git*' -x '*/node_modules/*' -x '*/.next/*'
   ```

   Or ship a **full git archive** plus `docker-images/` and `ollama_data.tgz`:

   ```bash
   git archive --format=tar.gz --prefix=app/ HEAD > app-src.tar.gz
   ```

## Automated helper

Run [`scripts/package-offline-bundle.sh`](../scripts/package-offline-bundle.sh) to create a `dist/` folder with `git archive` output and placeholders for `docker-images/`. You still must populate image tarballs (and optionally `ollama_data.tgz`) on a connected machine.
