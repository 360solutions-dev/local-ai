# Plan: Django Auth + Onboarding Flow + Docker + Project Structure + API Standards

## What We're Building

| # | What | Why |
|---|------|-----|
| 1 | **Onboarding-first flow** | First visit → onboarding; returning user → login |
| 2 | **Django backend** | Real auth API (register, login, logout, JWT) |
| 3 | **Docker Compose** | 5 services: postgres, ollama, django, nextjs, rag |
| 4 | **Folder restructure** | Move scattered root Python files into `rag/`, clean layout |
| ~~5~~ | ~~**CLAUDE.md system**~~ | ~~Auto-enforced API standards when building endpoints~~ **DONE** |

---

## Final Folder Structure

```
local-ai/
├── .env.example                  # Template (committed)
├── .env                          # Secrets (gitignored)
├── .gitignore
├── docker-compose.yml
├── CLAUDE.md                     # Project-wide standards
├── README.md
│
├── backend/                      # Django auth backend
│   ├── Dockerfile
│   ├── CLAUDE.md                 # Django API standards
│   ├── requirements.txt
│   ├── manage.py
│   ├── config/                   # Django project config
│   │   ├── __init__.py
│   │   ├── settings.py
│   │   ├── urls.py
│   │   ├── wsgi.py
│   │   └── asgi.py
│   ├── accounts/                 # Auth app
│   │   ├── __init__.py
│   │   ├── apps.py
│   │   ├── models.py
│   │   ├── serializers.py
│   │   ├── views.py
│   │   ├── urls.py
│   │   ├── authentication.py     # CookieJWTAuthentication
│   │   ├── tests/
│   │   │   └── test_auth_views.py
│   │   └── management/
│   │       └── commands/
│   │           └── reset_password.py
│   └── core/                     # Shared utilities
│       ├── __init__.py
│       ├── models.py             # BaseModel (UUID pk, timestamps)
│       ├── exceptions.py         # Standard error handler
│       └── permissions.py
│
├── rag/                          # Streamlit RAG app (moved from root)
│   ├── Dockerfile
│   ├── requirements.txt
│   ├── config.py                 # Updated: reads env vars
│   ├── app.py
│   ├── document_loader.py
│   ├── vector_store.py
│   ├── rag_chain.py
│   ├── query_history.py
│   ├── run_migrations.py
│   ├── migrations/               # Raw SQL migrations
│   └── api/
│       └── main.py               # FastAPI health checks
│
├── frontend/                     # Next.js 16 frontend
│   ├── Dockerfile
│   ├── CLAUDE.md                 # Frontend standards
│   ├── AGENTS.md
│   ├── proxy.ts                  # NEW: route protection
│   ├── next.config.ts            # Modified: API rewrites
│   ├── app/
│   │   ├── login/
│   │   │   └── LoginClient.tsx   # Modified: real API calls
│   │   ├── onboarding/
│   │   │   ├── page.tsx          # Modified: no iframe
│   │   │   └── OnboardingClient.tsx  # NEW: React 3-step
│   │   ├── dashboard/
│   │   ├── chat/
│   │   ├── settings/
│   │   ├── model-engines/
│   │   └── text-to-audio/
│   ├── components/               # NEW
│   │   ├── ui/
│   │   └── layout/
│   ├── lib/                      # NEW
│   │   └── api.ts
│   ├── hooks/                    # NEW
│   │   └── use-auth.ts
│   ├── types/                    # NEW
│   │   └── api.ts
│   ├── styles/
│   └── public/
│
├── tools/
│   └── scope_page_css.py
│
└── docs/
    └── mockups/                  # Renamed from images/
```

---

## Phase 1: Environment & Config

**Step 1:** Create `.env.example` and `.env` with: `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, `DATABASE_URL`, `DJANGO_SECRET_KEY`, `DJANGO_DEBUG`, `OLLAMA_BASE_URL`

**Step 2:** Create `.gitignore` — exclude `.env`, `__pycache__/`, `node_modules/`, `.next/`, `vector_db/`

**Step 3:** Update `config.py` — replace hardcoded values with `os.environ.get()` with current values as fallbacks

---

## Phase 2: Folder Restructuring

**Step 4:** Move RAG files to `rag/` — `app.py`, `config.py`, `document_loader.py`, `vector_store.py`, `rag_chain.py`, `query_history.py`, `run_migrations.py`, `requirements.txt`, `api/`, `migrations/`

**Step 5:** Move `images/` → `docs/mockups/`, create frontend scaffold dirs: `components/ui/`, `components/layout/`, `lib/`, `hooks/`, `types/`

---

## Phase 3: Django Backend

**Step 6:** Create Django project skeleton

```bash
cd backend
django-admin startproject config .
python manage.py startapp accounts
python manage.py startapp core
```

**Step 7:** User Model (`backend/accounts/models.py`)

```python
class User(AbstractUser):
    display_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(unique=True)
    USERNAME_FIELD = 'email'
    REQUIRED_FIELDS = ['username', 'display_name']
```

Onboarding status = `User.objects.exists()` (no extra table needed)

**Step 8:** Django Settings — DB from env var, `AUTH_USER_MODEL = 'accounts.User'`, DRF + SimpleJWT + CORS, custom `EXCEPTION_HANDLER`

**Step 9:** Run migrations — creates Django tables, leaves existing RAG tables untouched

**Step 10:** API Endpoints

| Method | Endpoint | Purpose | Auth? |
|--------|----------|---------|-------|
| GET | `/api/auth/setup-status/` | `{"is_setup_complete": bool}` | No |
| POST | `/api/auth/register/` | Create first admin (onboarding only) | No |
| POST | `/api/auth/login/` | Authenticate, set JWT cookies | No |
| POST | `/api/auth/logout/` | Clear auth cookies | Yes |
| GET | `/api/auth/me/` | Current user info | Yes |
| POST | `/api/auth/token/refresh/` | Refresh access token | No |
| POST | `/api/auth/reset-password/` | Reset with CLI token | No |

- **RegisterView** guards with `if User.objects.exists(): return 403`
- **CookieJWTAuthentication** reads JWT from `access_token` httpOnly cookie
- All errors return `{"error": {"code": "SNAKE_CASE", "message": "..."}}`

**Step 11:** `reset_password` management command — generates `XXXX-XXXX-XXXX` token via CLI (already referenced in forgot-password UI)

---

## Phase 4: Docker Setup

**Step 12:** Dockerfiles for `backend/`, `frontend/`, `rag/`

**Step 13:** `docker-compose.yml` with 5 services:

| Service | Image/Build | Ports | Depends On |
|---------|------------|-------|------------|
| `postgres` | `postgres:16-alpine` | 5432 | — |
| `ollama` | `ollama/ollama:latest` | 11434 | — |
| `django` | build `./backend` | 8000 | postgres |
| `nextjs` | build `./frontend` | 3000 | django |
| `rag` | build `./rag` | 8501, 8080 | postgres, ollama |

- Shared network `local-ai-net`
- Named volumes: `postgres_data`, `ollama_data`
- Dev volume mounts for hot reload
- Healthchecks on postgres and ollama

---

## Phase 5: Frontend Changes

**Step 14:** `proxy.ts` — route protection (Next.js 16 renamed middleware to proxy)

| setup_complete? | access_token? | Action |
|-----------------|---------------|--------|
| No | — | Check API → redirect to `/onboarding` |
| Yes | No | Redirect protected routes → `/login` |
| Yes | Yes | Allow; redirect `/login` & `/onboarding` → `/dashboard` |

**Step 15:** `next.config.ts` — add rewrite: `/api/auth/*` → `http://localhost:8000/api/auth/*`

**Step 16:** `frontend/lib/api.ts` — fetch wrapper with `credentials: 'include'`

**Step 17:** Rewrite `LoginClient.tsx` — replace hardcoded check with `apiPost('/api/auth/login/', ...)`

**Step 18:** Rewrite onboarding — convert iframe to `OnboardingClient.tsx` React component:

- Step 1: Welcome → Step 2: Form calls `POST /api/auth/register/` → Step 3: Success → Dashboard

**Step 19:** Add logout button + fetch real user info via `GET /api/auth/me/`

---

## ~~Phase 6: CLAUDE.md (API Standards Agent)~~ COMPLETED

Created:
- `CLAUDE.md` (root) — project-wide standards
- `backend/CLAUDE.md` — Django API standards
- `frontend/CLAUDE.md` — frontend standards

---

## Implementation Order

| Phase | Steps | Depends On | Status |
|-------|-------|------------|--------|
| 1. Environment | 1-3 | Nothing | **Done** |
| 2. Restructure | 4-5 | Phase 1 | **Done** |
| 3. Django | 6-11 | Phase 2 | **Done** |
| 4. Docker | 12-13 | Phase 3 | **Done** |
| 5. Frontend | 14-19 | Phase 3 | **Done** |
| ~~6. CLAUDE.md~~ | ~~20-22~~ | — | **Done** |

---

## Verification

1. `docker compose up --build` starts all 5 services
2. Visit `localhost:3000` → redirects to `/onboarding` (fresh DB)
3. Complete onboarding → creates admin → redirects to `/dashboard`
4. Logout → redirects to `/login`
5. Visit `/dashboard` logged out → redirects to `/login`
6. Login → redirects to `/dashboard`
7. Visit `/onboarding` after setup → redirects to `/dashboard`
8. Existing RAG tables untouched
