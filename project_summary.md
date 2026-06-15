# Project Summary — local-ai

## What Is This Project

A fully private, offline AI workspace that runs entirely on your machine via Docker. Users can chat with documents, generate audio, and use AI tools — all powered by local LLMs through Ollama. No cloud APIs, no internet required after setup.

---

## What Was Built

### 1. Django Authentication Backend (`backend/`)

A complete auth system built with Django 5 + Django REST Framework:

- **User Model** — custom `User` extending `AbstractUser` with `display_name`, email-based login
- **7 API Endpoints:**
  - `GET /api/auth/setup-status/` — check if any user exists (onboarding vs login)
  - `POST /api/auth/register/` — create first admin (only works when no users exist)
  - `POST /api/auth/login/` — authenticate, returns JWT in httpOnly cookies
  - `POST /api/auth/logout/` — clears auth cookies
  - `GET /api/auth/me/` — returns current user info
  - `POST /api/auth/token/refresh/` — refresh expired access token
  - `POST /api/auth/reset-password/` — reset password with CLI-generated token
- **JWT in httpOnly Cookies** — secure, no localStorage token exposure
- **Custom `CookieJWTAuthentication`** — reads JWT from cookies instead of Authorization header
- **Standard Error Format** — `{"error": {"code": "SNAKE_CASE", "message": "..."}}`
- **Password Reset CLI** — `docker exec local-ai-django python manage.py reset-password`
- **Tests** — setup-status, register, login, me endpoints

### 2. Onboarding-First Flow

Smart routing based on app state:

| Condition | Where user goes |
|-----------|----------------|
| No users in DB (fresh install) | `/onboarding` — 3-step setup wizard |
| User exists, not logged in | `/login` — sign in page |
| User exists, logged in | `/dashboard` — main app |
| Logged-in user visits `/onboarding` | Redirected to `/dashboard` |
| Logged-out user visits `/dashboard` | Redirected to `/login` |

Implemented via Next.js 16 `proxy.ts` (renamed from middleware) that checks Django's `/api/auth/setup-status/` API.

### 3. Docker Compose Setup

5 services orchestrated via `docker-compose.yml`:

| Service | Image | Port | Purpose |
|---------|-------|------|---------|
| `postgres` | postgres:16-alpine | 5433 | Shared database |
| `ollama` | ollama/ollama:latest | 11434 | Local LLM server |
| `django` | Custom (Python 3.12) | 8000 | Auth API backend |
| `nextjs` | Custom (Node 20) | 3000 | Frontend app |
| `rag` | Custom (Python 3.12) | 8501, 8080 | Streamlit chatbot + FastAPI |

Features:
- Shared Docker network (`local-ai-net`)
- Named volumes for data persistence (`postgres_data`, `ollama_data`)
- Volume mounts for hot reload in development
- Health checks on postgres and ollama
- Environment variables via `.env` file

### 4. Folder Restructuring

Reorganized from scattered root files to clean structure:

```
local-ai/
├── .env / .env.example / .gitignore
├── docker-compose.yml
├── project_plan.md / project_summary.md
│
├── backend/                    # Django auth API
│   ├── config/                 # Settings, URLs, WSGI
│   ├── accounts/               # User model, auth views, serializers
│   ├── core/                   # BaseModel, exceptions, permissions
│   ├── Dockerfile
│   └── requirements.txt
│
├── rag/                        # Streamlit RAG chatbot (moved from root)
│   ├── app.py, config.py, document_loader.py
│   ├── vector_store.py, rag_chain.py, query_history.py
│   ├── api/main.py             # FastAPI health checks
│   ├── migrations/             # Raw SQL migrations
│   ├── Dockerfile
│   └── requirements.txt
│
├── frontend/                   # Next.js 16 app
│   ├── app/                    # Pages (App Router)
│   ├── components/layout/      # Sidebar, SidebarUser
│   ├── hooks/                  # use-auth.ts, use-theme.ts
│   ├── lib/                    # api.ts, query-provider.tsx
│   ├── public/static-pages/    # Original HTML mockups (reference)
│   ├── Dockerfile
│   └── proxy.ts                # Route protection
│
├── tools/                      # Dev utilities
└── docs/mockups/               # HTML design mockups
```

### 5. Tailwind CSS Migration

Migrated ALL 7 pages from custom CSS files to Tailwind v4 utility classes:

- Login page
- Onboarding page
- Dashboard page
- Chat page
- Settings page (converted from iframe → React component)
- Model Engines page (converted from iframe → React component)
- Text to Audio page (converted from iframe → React component)

Deleted entire `styles/` directory. All styling is now inline Tailwind classes.

Theme system with custom colors defined in `globals.css` via CSS variables + `@theme`:
- Dark theme (default)
- Light theme
- System (follows OS preference)

### 6. Dark/Light Theme Switcher

Working theme system in Settings → Appearance → Theme dropdown:

- **Dark** — original design (dark backgrounds, light text)
- **Light** — white/gray backgrounds, dark text, adjusted accents
- **System** — follows OS `prefers-color-scheme`, updates live
- Persisted in `localStorage`, applied instantly via `<head>` script (no flash)
- Works across all pages via CSS custom properties

### 11. Profile Display Name Update

- `PATCH /api/auth/me/` endpoint updates `display_name` in the database
- `UserUpdateSerializer` + `apiPatch` frontend utility + `useUpdateProfile` mutation hook
- Settings > Profile "Save Changes" button persists display name
- Email field is read-only (non-editable)

### 12. Accent Color Selector

Working accent color system in Settings → Appearance → Accent Color dropdown:

- 5 palettes: **Emerald** (default), **Cyan**, **Violet**, **Amber**, **Rose**
- Each has dark and light theme variants
- `useAccentColor` hook with localStorage persistence
- Applies CSS variables (`--color-accent`, `--color-accent-secondary`, `--color-border-accent`, `--color-border-focus`)
- Initialization script in `layout.tsx` prevents flash of wrong color on load
- Re-applies correct palette when switching between dark/light themes

### 13. Full i18n / Internationalization

Lightweight i18n system (no external libraries) supporting 6 languages:

- **English**, **Spanish**, **French**, **German**, **Japanese**, **Chinese (Simplified)**
- `LanguageProvider` React Context + `useLanguage()` / `useTranslation()` hooks
- ~245 translation keys covering all 9 component files
- Language selector in Settings → Appearance → Language dropdown
- Persisted in `localStorage`, applies instantly, survives page refresh
- `{variable}` interpolation support for dynamic strings
- `DashboardClient.tsx` extracted from server page to enable translations

### 14. Notification Preferences System

Working notification toggles in Settings → General → Notifications:

- **3 toggles**: Model Download Complete, File Indexing Complete, System Errors
- Persisted in database via `NotificationPreference` model (OneToOne with User)
- **Integrated into `/api/auth/me/`** — prefs returned with user data, updated via PATCH
- **Optimistic updates** — toggles respond instantly, revert on API failure
- No separate API call, no flicker on reload
- `notifications` Django app also has `Notification` model for future notification history
- `create_notification()` service respects user prefs before creating notifications

### 15. Skeleton Loader

Settings page uses shimmer skeleton loader while user data loads:

- `SettingsSkeleton` component in `components/ui/Skeleton.tsx`
- Matches actual settings layout (header, tabs, form fields, toggle rows, buttons)
- Eliminates flash of default values before API data arrives
- Reusable `SkeletonBlock` primitive for future pages

### 16. Change Password (Settings > Security)

Working password change in Settings → Security → Change Password:

- **Backend**: `POST /api/auth/change-password/` endpoint with `ChangePasswordSerializer`
- Validates current password, sets new one (min 8 chars), re-issues JWT cookies so user stays logged in
- **Frontend**: `useChangePassword()` mutation hook + controlled form with validation
- Client-side checks: min 8 characters, confirm password match
- Server-side check: current password verification
- **UX**: inline error messages, loading state on button, success toast, fields clear on success
- **i18n**: `passwordsNoMatch` key added to all 6 languages

### 7. React Query (TanStack Query)

All API calls use React Query hooks instead of manual `useEffect` + `useState`:

| Hook | Type | Used by |
|------|------|---------|
| `useCurrentUser()` | Query | SidebarUser, SettingsClient |
| `useLogin()` | Mutation | LoginClient |
| `useLogout()` | Mutation | SidebarUser |
| `useRegister()` | Mutation | OnboardingClient |
| `useResetPassword()` | Mutation | LoginClient |
| `useUpdateNotificationPreferences()` | Mutation | SettingsClient |
| `useChangePassword()` | Mutation | SettingsClient |

Benefits:
- Shared cache — SidebarUser and Settings fetch `/me` once, not twice
- Automatic loading/error states via `isPending`, `isError`
- No manual `useEffect` for data fetching anywhere

### 8. Shared Components

| Component | Purpose |
|-----------|---------|
| `Sidebar` | Shared navigation sidebar with active page highlighting |
| `SidebarUser` | User info + logout button (uses `useCurrentUser` + `useLogout`) |
| `QueryProvider` | React Query client wrapper |
| `SettingsSkeleton` | Shimmer skeleton loader for settings page |

### 9. Icon System

Using `lucide-react` library for all icons:
- `LogOut`, `Loader2` — sidebar logout
- `Check` — checkbox tick
- `Eye`, `EyeOff` — password visibility toggle

Brand logo uses inline SVG (custom, not a standard icon).

### 10. Environment Configuration

All secrets and URLs use environment variables:

| Variable | Purpose | Default |
|----------|---------|---------|
| `POSTGRES_USER` | Database user | localai |
| `POSTGRES_PASSWORD` | Database password | localai_dev |
| `POSTGRES_DB` | Database name | localai |
| `DATABASE_URL` | Full connection string | postgresql://... |
| `DJANGO_SECRET_KEY` | Django secret | dev key |
| `DJANGO_DEBUG` | Debug mode | true |
| `OLLAMA_BASE_URL` | Ollama server URL | http://ollama:11434 |
| `BACKEND_URL` | Django URL for Next.js | http://localhost:8000 |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS v4 |
| Icons | lucide-react |
| Data Fetching | TanStack React Query |
| Backend | Django 5, Django REST Framework |
| Auth | JWT (SimpleJWT) in httpOnly cookies |
| Database | PostgreSQL 16 |
| LLM | Ollama (local) |
| Embeddings | Ollama + FAISS |
| RAG UI | Streamlit |
| RAG API | FastAPI |
| Containerization | Docker Compose |

---

## Pages

| Route | Description | Status |
|-------|------------|--------|
| `/` | Redirects based on auth state | Working |
| `/onboarding` | 3-step setup wizard (Welcome → Create Admin → Success) | Working |
| `/login` | Email/password sign in with forgot password flow | Working |
| `/dashboard` | Main dashboard with stats + feature cards | Working |
| `/chat` | Chat with Files interface (demo data) | UI complete |
| `/settings` | 4-tab settings (General, Storage, Security, Advanced) | UI complete |
| `/model-engines` | LLM provider management + model downloads | UI complete |
| `/text-to-audio` | Text-to-speech with audio player + waveform | UI complete |

---

### 17. Advanced Settings Tab (Fully Functional)

Settings → Advanced tab — previously all hardcoded/non-functional, now fully wired to backend APIs:

**New Django app: `system`** (`backend/system/`)
- `InstanceSettings` model — singleton for instance config (instance_id, request_logging, debug_mode)
- `rag_queries.py` — raw SQL helpers to query RAG tables (conversations, messages, query_history) in the shared PostgreSQL

**8 API Endpoints** (`/api/system/`):

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/system/info/` | GET | Real instance info (version, stable ID, live uptime, last updated) |
| `/api/system/settings/` | GET/PATCH | Logging toggle persistence (request logging, debug mode) |
| `/api/system/export/chat-history/` | GET | Download all chat history as JSON |
| `/api/system/export/settings/` | GET | Download user + instance settings as JSON |
| `/api/system/export/all/` | GET | Download all data as ZIP (chat history + settings + query history) |
| `/api/system/danger/reset-instance/` | POST | Reset all settings to defaults (backend + client-side: theme, accent, language) |
| `/api/system/danger/delete-all-data/` | POST | Delete all conversations, messages, query history, notifications |
| `/api/system/danger/factory-reset/` | POST | Wipe everything, delete user account, redirect to onboarding |

**Frontend:**
- `use-advanced-settings.ts` — 9 React Query hooks (queries with optimistic updates + mutations)
- `ConfirmDialog.tsx` — reusable confirmation dialog with optional typed confirmation (Factory Reset requires typing "FACTORY RESET")
- `apiDownload()` — new API helper for file downloads via blob + anchor
- Instance Info section shows real data with 60s auto-refresh for uptime
- Logging toggles persist to backend with optimistic UI updates
- Export buttons download real files with loading states
- Danger zone buttons open confirmation dialogs before executing
- Reset Instance also resets client-side preferences (theme → dark, accent → emerald, language → English)
- Factory Reset cancels all queries, clears cookies, hard-redirects to `/onboarding`
- i18n keys added to all 6 languages
- Next.js proxy rewrite added for `/api/system/` routes

---

### 18. Flickering Fixes & Dynamic Data (April 10, 2026)

Fixed page flickering issues across the entire app and made static data dynamic.

**Flickering — `useHasActiveProvider` rework:**
- Changed `useHasActiveProvider()` in `hooks/use-chat.ts` from returning a bare `boolean` to `{ active: boolean, isLoading: boolean }`
- **Chat page** — shows spinner while provider/model state loads; previously flashed "No provider" screen for ~1 second
- **Text-to-Audio page** — same spinner guard added
- **Model Engines page** — updated to match new hook signature

**Factory Reset flicker:**
- `SettingsClient.tsx` — added `resettingFactory` flag; immediately shows full-screen "Resetting instance..." overlay on confirm, preventing the ConfirmDialog from flashing back before redirect

**Onboarding — Dynamic health status:**
- "All services running" now checks real system health via `useSystemHealth()`
- Shows spinner + "Checking services..." while loading
- Shows "Some services are offline" when services are down
- Auto-updates every 10 seconds without page reload

**Login page — Dynamic host:**
- Replaced hardcoded `localhost:3000` with `window.location.host`

**System health polling:**
- `useSystemHealth` refetch interval changed from 30s → 10s for faster status updates

**Chat blocking screen — Sidebar navigation:**
- When no provider/model is available, the shared `<Sidebar>` component is now visible so users can navigate
- Previously the entire screen was replaced with no navigation

**Arrow icons:**
- Replaced all `&rarr;` HTML entities with Lucide `<ArrowRight />` component on blocking screens

**i18n keys added (all 6 languages):**
- `onboarding.checkingServices`
- `onboarding.someServicesOffline`
- `settings.advanced.factoryResetting`

**Files Modified:**
- `frontend/hooks/use-chat.ts`
- `frontend/app/chat/ChatClient.tsx`
- `frontend/app/text-to-audio/TextToAudioClient.tsx`
- `frontend/app/model-engines/ModelEnginesClient.tsx`
- `frontend/app/settings/SettingsClient.tsx`
- `frontend/app/onboarding/OnboardingClient.tsx`
- `frontend/app/login/LoginClient.tsx`
- `frontend/lib/i18n/translations/{en,es,fr,de,ja,zh}.ts`

---

### 19. Caddy Reverse Proxy — Custom Local Domain (April 10, 2026)

Added Caddy as a reverse proxy so the app runs on a clean custom domain instead of `localhost:PORT`:

| URL | Routes to |
|-----|-----------|
| `http://local-ai.localhost` | Next.js frontend (port 3000) |
| `http://api.local-ai.localhost` | Django backend (port 8000) |

**Changes:**
- Added `caddy` service (caddy:2-alpine) to `docker-compose.yml` listening on port 80
- Created `Caddyfile` with HTTP-only reverse proxy rules
- Removed direct host port mappings from `nextjs` and `django` services (traffic goes through Caddy)
- Added `api.local-ai.localhost` to Django's `ALLOWED_HOSTS`
- RAG service `8080` host port removed (Caddy doesn't conflict, RAG still reachable internally)

**Cross-platform note:** `*.localhost` resolves automatically on macOS but requires a hosts file entry on Windows/Linux:
```
127.0.0.1 local-ai.localhost api.local-ai.localhost
```

---

## What Was NOT Changed

- All RAG logic (app.py, document_loader.py, vector_store.py, rag_chain.py, query_history.py) — only moved to `rag/`, code untouched
- `frontend/AGENTS.md` — untouched
- `frontend/public/static-pages/*.html` — kept as design reference
- `README.md` — untouched
- `tools/scope_page_css.py` — untouched

---

## How to Run

```bash
# Start all services
docker compose up --build -d

# Run Django migrations (first time only)
docker compose exec django python manage.py migrate

# Pull Ollama models (first time only)
docker compose exec ollama ollama pull llama3.1:8b
docker compose exec ollama ollama pull nomic-embed-text

# Open in browser
open http://local-ai.localhost
```

**Note (Windows/Linux only):** Add to your hosts file first:
```
127.0.0.1 local-ai.localhost api.local-ai.localhost
```

First visit → Onboarding → Create admin → Dashboard.
