# Contributing to local-ai.run

Thanks for your interest in contributing. This project welcomes PRs that fix bugs, improve docs, add features, or polish the UX. Be kind. Assume good intent. Use [Discord](https://discord.gg/vndd7TzhVU) for chat, GitHub Issues for bugs, Discussions for ideas.

## Prerequisites

You'll need:

- **Docker Desktop** (Mac/Windows) or **Docker Engine 20.10+** (Linux)
- **Git**
- **Node.js 20+** — only if you want to run the frontend outside Docker for faster iteration
- **Python 3.12+** — only if you want to run the backend outside Docker

8 GB RAM minimum. 16 GB recommended if you'll be running Ollama locally.

---

## Local Setup

```bash
# 1. Fork and clone
git clone https://github.com/360solutions-dev/local-ai.git
cd local-ai

# 2. Copy env template
cp .env.example .env

# 3. (Optional) Edit .env — defaults work for dev
# Change DJANGO_SECRET_KEY and DJANGO_DEBUG=true is fine for dev

# 4. Build and start the stack
docker compose up --build -d

# 5. Wait ~60 seconds for healthchecks, then open
open http://local-ai.localhost
```

First-time build takes 5–10 minutes (downloading Python/Node base images, installing deps). Subsequent rebuilds are cached.

**Add to `/etc/hosts`** if `local-ai.localhost` doesn't resolve:
```
127.0.0.1 local-ai.localhost api.local-ai.localhost
```

### Hot reload + stop

Source dirs are bind-mounted — frontend `.tsx` changes refresh the page, backend `.py` changes reload Django automatically.

```bash
docker compose down              # stop, keep data
docker compose down -v           # stop AND wipe all data
```

---

## Project Structure

- `backend/` — Django REST API
- `frontend/` — Next.js UI (App Router + Tailwind)
- `rag/` — FastAPI RAG service
- `whisper/`, `ollama/`, `updater/` — supporting services
- `docker-compose.yml` (dev, source build) · `docker-compose.release.yml` (prod, pulls Hub images)

---

## Code Style

### Frontend (TypeScript)

```bash
cd frontend
npm run lint              # ESLint check
npx tsc --noEmit          # TypeScript check — must pass before PR
```

Conventions:
- **Tailwind** for styling — no CSS files
- **lucide-react** for icons — no custom SVGs
- **CSS variables** for colors (`accent`, `accent-secondary`, `danger`, etc.) — no hex values
- **i18n** — every user-facing string must be in all 6 translation files (`frontend/lib/i18n/translations/{en,de,es,fr,ja,zh}.ts`)
- **No `loading.tsx` files** — they cause flash on navigation. Use `error.tsx` per route instead.
- **Reusable components** live in `frontend/components/ui/` — check before adding a duplicate Button/Input/etc.

### Backend (Python)

```bash
cd backend
python -m pytest          # if pytest is installed
docker compose exec django python manage.py test  # via Docker
```

Conventions:
- **PEP 8** standard formatting
- Use `f-strings` over `.format()` or `%`
- All API responses follow `{"error": {"code": "...", "message": "..."}}` pattern on failure
- Singleton models (`InstanceSettings`, `ModelConfig`) use `get_or_create_singleton()` helper
- All `requests.*` calls must have `timeout=N` set
- Parametrized SQL queries only — never f-string SQL

---

## Running Tests

### Backend
```bash
docker compose exec django python manage.py test accounts
docker compose exec django python manage.py test                # all apps
```

Existing test file: `backend/accounts/tests/test_auth_views.py`. New features should include test coverage where reasonable.

### Frontend
No automated tests yet. Manual verification expected:
1. `npx tsc --noEmit` passes
2. `npm run lint` passes
3. Run the changed flow in browser (login → relevant page → action → verify result)

---

## Pull Request Process

### 1. Open an Issue First (For Big Changes)

For anything beyond a small bug fix or doc tweak, open an issue describing what you want to change and why. This avoids wasted work if the maintainers want a different approach.

Skip this for: typos, doc fixes, obvious bugs, small refactors.

### 2. Branch Naming

Use prefixes:
- `feat/` — new feature: `feat/folder-tree-in-sidebar`
- `fix/` — bug fix: `fix/empty-file-upload-400`
- `docs/` — documentation only: `docs/troubleshooting-port-conflict`
- `refactor/` — code restructure, no behavior change: `refactor/extract-chat-pane`
- `chore/` — tooling/deps: `chore/bump-next-to-16.3`

### 3. Commit Message Style

Conventional commits — short, present tense, scope optional:

```
feat(chat): add ⌘+Shift+O shortcut for new chat
fix(backend): reject empty file uploads with clear error
docs(readme): add architecture diagram
refactor(rag): split api/main.py into routers
chore: bump LOCAL_AI_IMAGE_TAG to 1.0.4
```

Keep the subject under 72 characters. Add a body paragraph if context isn't obvious from the diff.

### 4. Before Pushing

```bash
# Frontend
cd frontend && npx tsc --noEmit && npm run lint && cd ..

# Backend (if touched)
docker compose exec django python manage.py test

# Compose changes
docker compose config --quiet                                  # dev
docker compose -f docker-compose.release.yml config --quiet    # release
```

All three must exit 0.

### 5. PR Description

Use the PR template. Minimum required:
- **Summary** — what changed in 1–3 sentences
- **Why** — problem being solved or feature motivation
- **Test plan** — how you verified the change works
- **Screenshots** — for any UI change

Link related issues with `Closes #123` or `Refs #456`.

### 6. Review

Maintainers review within 3–5 days. Address feedback by pushing new commits to the same branch (no force-push during review). Once approved, a maintainer squash-merges.

---

## PR Tips

**Accept-friendly**: single focused change · tests or verification steps · follows conventions · backwards compatible · clear commits.

**Slowdowns**: mixed unrelated changes · new deps without discussion · touching `entrypoint.sh` or Dockerfiles without approval · creating `loading.tsx` · breaking i18n parity · hardcoded colors or English-only UI strings.

---

## Need Help?

- **Discord** — `#contributors` channel: [Join](https://discord.gg/vndd7TzhVU)
- **Bug reports** — GitHub Issues with the bug template
- **Feature ideas** — GitHub Discussions
- **Security issues** — Email `security@local-ai.run` (do not open a public issue)

Thanks for contributing.
