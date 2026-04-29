# Full Project Audit

Perform a **complete and thorough audit** of the entire local-ai project. Run ALL checks below in parallel using agents. **ONLY REPORT issues — do NOT fix anything automatically.** Present all findings and ask the user what to fix.

## CRITICAL SAFETY RULES

- **NEVER modify entrypoint.sh or Dockerfile** without explicit user approval
- **NEVER add loading.tsx skeleton files** — they cause lag/flash on navigation
- **NEVER replace runserver with gunicorn** — the entrypoint has its own fallback logic
- **NEVER change the layout structure of pages** (sidebar placement, page wrappers)
- **NEVER add new dependencies** without asking first
- **REPORT ONLY** — list all issues with file:line and let the user decide what to fix
- **If unsure whether something is a bug or intentional**, ask the user first

## Phase 1: Discovery (run all 4 agents in parallel)

### Agent 1: Backend API Audit
- Read EVERY views.py, models.py, serializers.py, urls.py, authentication.py, settings.py
- Check all API endpoints return correct status codes and responses
- Check for N+1 queries, race conditions, missing error handling
- Check for SQL injection, SSRF, missing input validation
- Check no hardcoded URLs/IPs — everything must use environment variables
- Check SSE/streaming format is correct
- Check all serializers have proper max_length, validators
- Check singleton models use atomic operations
- Check authentication flow (cookies, JWT, refresh) is correct
- Report every bug with file:line and impact

### Agent 2: Frontend Code Audit
- Read EVERY page, component, hook, and lib file
- Check all buttons have onClick handlers and disabled states during loading
- Check no `window.alert()` or `confirm()` — use proper UI components
- Check no hardcoded colors (hex values like #8b5cf6, indigo-500 etc) — must use CSS variables
- Check ALL icons use lucide-react — no custom SVGs for standard icons
- Check all API calls handle errors (res.ok check, JSON parse safety)
- Check no duplicate code that should be reusable components
- Check all forms have proper validation
- Check no memory leaks in hooks (cleanup in useEffect, AbortController)
- Check real-time updates work (refetchOnWindowFocus, refetchInterval, query invalidation)
- Check all i18n translation keys exist in ALL 6 language files (en, de, es, fr, ja, zh)
- Check middleware.ts is properly named and exported
- Check every slow API call shows a loader (spinner, "Loading..." text, or disabled button)
- Report every bug with file:line and impact

### Agent 3: Docker & Infrastructure Audit
- Read docker-compose.yml, all Dockerfiles, entrypoint scripts, Caddyfile, .env
- Check all services have health checks
- Check timeouts are consistent
- Check .env has ALL required variables referenced in docker-compose and settings
- Check CORS_ALLOWED_ORIGINS is configured
- Check port mappings don't conflict
- Check volume mounts are correct
- **DO NOT suggest changing entrypoint.sh or Dockerfiles** — only report issues
- Report every issue with file:line

### Agent 4: UX & Performance Audit
- Check every page has error.tsx boundary (NOT loading.tsx — we don't use those)
- Check theme is consistent: dark/light mode works, accent colors apply everywhere
- Check no unnecessary re-renders, proper React Query caching
- Check the app is optimized for single-user local usage
- Check all modals, overlays, and toasts work properly
- Check file uploads show progress, model downloads show progress
- Check navigation flows are smooth (login -> onboarding -> dashboard -> chat)
- Check sidebar stays consistent when provider state changes
- Report every issue

## Phase 2: Present Findings

After all 4 agents report:
1. Present a **summary table** with all issues found
2. Group by severity: Critical, High, Medium
3. **Ask the user which ones to fix** — do NOT auto-fix anything

## Phase 3: Fix (only after user approval)

Only fix what the user approves. After fixing:
1. `npx tsc --noEmit` — must be 0 errors
2. `docker compose config --quiet` — must be valid
3. Python syntax check on all .py files — must pass
4. Confirm no existing functionality was broken
