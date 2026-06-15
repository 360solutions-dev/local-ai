# Git versioning and releases

This project uses **Git** for source control and **annotated tags** for end-user releases. Secrets never belong in the repository.

## What is tracked

- Application source, Dockerfiles, `docker-compose.yml`, and [`.env.example`](../.env.example) (placeholders only).
- [`.gitignore`](../.gitignore) excludes `.env`, `venv/`, `node_modules/`, `.next/`, `vector_db/`, and other generated paths.

## Branch workflow

| Branch | Purpose |
|--------|---------|
| `main` | Default, deployable branch. Keep it stable. |
| `feature/<name>` | Short-lived branches for changes; merge via pull request when ready. |

```bash
git checkout main
git pull
git checkout -b feature/my-change
# ... commit work ...
git push -u origin feature/my-change
```

## Release tags (semantic versioning)

Tag a commit when you ship a build to end users or cut a support bundle.

```bash
git checkout main
git pull
git tag -a v1.0.0 -m "Release v1.0.0: short description"
git push origin main
git push origin v1.0.0
```

- Use **annotated tags** (`-a`) so the tag carries a message and author.
- Version format: **`vMAJOR.MINOR.PATCH`** (e.g. `v1.2.0`).

End users can check out an exact tree:

```bash
git fetch origin tag v1.0.0
git checkout v1.0.0
```

## Secrets and `.env`

1. Copy the template: `cp .env.example .env`
2. Replace every `change-me` value. For `DJANGO_SECRET_KEY`, generate a random string, for example:

   ```bash
   openssl rand -hex 32
   ```

3. Never commit `.env`. If you accidentally committed secrets, rotate them everywhere and use Git history cleanup tools appropriate for your host (GitHub/GitLab docs cover removing secrets from history).

## Optional: GitHub / GitLab Releases

Attach a **source archive** (zip/tar) of the tagged commit for users who cannot run `git clone`. Keep attaching the same **offline bundle** instructions in [OFFLINE_INSTALL.md](../OFFLINE_INSTALL.md) for air-gapped installs.
