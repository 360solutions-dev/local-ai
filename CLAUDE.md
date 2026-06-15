# local-ai.run

## Project Overview
A self-hosted, single-user AI platform running locally via Docker. Stack: Django backend, Next.js frontend, Ollama for models, PostgreSQL, Caddy reverse proxy, RAG service.

## Custom Commands
- `/audit` — Runs a full project audit. Reports all issues but does NOT auto-fix. Asks user before making any changes.

## CRITICAL — Do NOT Touch
- **entrypoint.sh** — Has its own fallback logic (gunicorn || runserver). NEVER modify.
- **Dockerfiles** — NEVER change without explicit user approval.
- **Page layouts** — NEVER change sidebar placement or page structure.
- **loading.tsx** — NEVER add these files. They cause lag/flash on navigation.

## Code Standards
- **No hardcoded URLs** — use environment variables (.env) for all service endpoints
- **No `window.alert()` or `confirm()`** — use ErrorAlert, ConfirmDialog components
- **No hardcoded colors** — use CSS variables (accent, accent-secondary, danger, etc.)
- **Icons** — use lucide-react only
- **Reusable components** — Input, Button, InfoCard, ErrorAlert, Logo, Toast, NoProviderGuard in components/ui/
- **i18n** — every user-facing string must be in ALL 6 translation files (en, de, es, fr, ja, zh)
- **Error boundaries** — every route directory needs error.tsx (NOT loading.tsx)
- **Auto-refresh** — use refetchOnWindowFocus and refetchInterval on queries so UI updates without page reload
- **Loaders** — every slow API call must show a spinner, "Loading..." text, or disabled button state
- **Single-user optimized** — no complex auth flows, polling-based updates are fine

## Safety Rules
- Always REPORT issues first, ask before fixing
- Never break the running server
- Test with `npx tsc --noEmit` before saying "done"
- If a fix could change existing behavior, ask user first
