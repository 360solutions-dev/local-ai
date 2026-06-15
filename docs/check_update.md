# Check for Updates — Implementation Guide

## Overview

Add a "Check for Updates" button in **Settings > Advanced** that detects new versions, downloads the latest code, rebuilds all Docker containers, and restarts the platform automatically.

---

## How It Works

```
User clicks "Check for Updates"
  → Frontend calls Django API
    → Django proxies to Updater Service
      → Updater runs git fetch, compares version tags
        → Returns: update available or up-to-date

User clicks "Install Update"
  → Frontend calls Django API
    → Django proxies to Updater Service
      → Updater runs git pull + docker compose up -d --build
        → All services rebuild and restart
          → Frontend polls until backend comes back with new version
            → Shows success message
```

---

## Architecture

```
┌──────────────┐     ┌──────────────┐     ┌──────────────────┐
│   Frontend   │────▶│  Django API  │────▶│ Updater Service  │
│  (Settings)  │     │  (proxy)     │     │ (git + docker)   │
└──────────────┘     └──────────────┘     └──────────────────┘
                                                   │
                                          ┌────────┴────────┐
                                          │                 │
                                    ┌─────▼─────┐   ┌──────▼──────┐
                                    │ Git Repo  │   │ Docker      │
                                    │ (host)    │   │ Socket      │
                                    └───────────┘   └─────────────┘
```

**Why a sidecar?** Containers can't update the host's git repo or restart themselves. The updater service has the project directory + Docker socket mounted, so it can run `git pull` and `docker compose up` on behalf of the whole stack.

---

## Step-by-Step Implementation

---

### Step 1: Create the Updater Service

Create a new `updater/` directory at the project root with 3 files.

#### 1a. `updater/Dockerfile`

```dockerfile
FROM alpine:3.19

RUN apk add --no-cache git python3 docker-cli docker-cli-compose

WORKDIR /app
COPY server.py update.sh ./
RUN chmod +x update.sh

EXPOSE 8070

CMD ["python3", "server.py"]
```

- **Alpine-based** — tiny image (~50MB with git + docker CLI)
- **No pip dependencies** — uses Python stdlib only
- **Port 8070** — internal only, not exposed to host

#### 1b. `updater/server.py`

A stdlib-only Python HTTP server with 3 endpoints:

| Endpoint | Method | What It Does |
|----------|--------|-------------|
| `/health` | GET | Returns `{"status": "ok"}` for health checks |
| `/check` | GET | Runs `git fetch --tags`, compares current vs latest tag |
| `/update` | POST | Runs `update.sh` as background process, returns immediately |

**`GET /check` response:**
```json
{
  "current_version": "1.0.0",
  "latest_version": "1.1.0",
  "update_available": true,
  "changelog": [
    "feat: add voice input support",
    "fix: chat scroll position reset"
  ],
  "error": null
}
```

**`POST /update` response:**
```json
{
  "status": "updating",
  "target_version": "1.1.0"
}
```

**Security:** Every request must include `X-API-Key` header matching `UPDATER_API_KEY` env var.

#### 1c. `updater/update.sh`

```sh
#!/bin/sh
set -e
PROJECT_DIR="$1"
cd "$PROJECT_DIR"

# Save any local changes (e.g. .env edits won't block pull)
git stash 2>/dev/null || true

# Pull latest — ff-only prevents merge conflicts
git pull origin main --ff-only

# Rebuild and restart all services (detached)
docker compose up -d --build
```

Key decisions:
- `git stash` — protects user's local `.env` edits
- `--ff-only` — if there are local commits, the pull **fails safely** instead of creating merge conflicts
- `docker compose up -d --build` — rebuilds changed images and restarts containers

---

### Step 2: Add Updater to Docker Compose

**File:** `docker-compose.yml`

Add the new service:

```yaml
  updater:
    build: ./updater
    container_name: local-ai-updater
    restart: unless-stopped
    environment:
      UPDATER_API_KEY: ${UPDATER_API_KEY:-defaultkey}
    volumes:
      - .:/project                                    # Host project directory (read-write)
      - /var/run/docker.sock:/var/run/docker.sock     # Docker socket (read-write)
    healthcheck:
      test: ["CMD", "wget", "--spider", "-q", "http://localhost:8070/health"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - local-ai-net
```

Add env vars to the `django` service's environment block:

```yaml
    environment:
      # ... existing vars ...
      UPDATER_SERVICE_URL: ${UPDATER_SERVICE_URL:-http://updater:8070}
      UPDATER_API_KEY: ${UPDATER_API_KEY:-defaultkey}
```

Add to `.env.example`:

```
UPDATER_SERVICE_URL=http://updater:8070
UPDATER_API_KEY=change-me
```

---

### Step 3: Add Django Backend Endpoints

**File:** `backend/system/views.py`

Add a base class following the existing `_WhisperBase` pattern:

```python
class _UpdaterBase(APIView):
    """Shared helpers for updater service views."""

    _UPDATER_URL = os.environ.get("UPDATER_SERVICE_URL", "http://updater:8070")
    _API_KEY = os.environ.get("UPDATER_API_KEY", "")

    def _headers(self) -> dict:
        return {"X-API-Key": self._API_KEY}
```

Add two view classes:

| View | Endpoint | Method | What It Does |
|------|----------|--------|-------------|
| `CheckUpdateView` | `/api/system/updates/check/` | GET | Proxies to updater `/check` |
| `ApplyUpdateView` | `/api/system/updates/apply/` | POST | Requires `{"confirm": true}`, proxies to updater `/update` |

Both return **502** with an error message if the updater service is unreachable.

**File:** `backend/system/urls.py`

Add two URL patterns:

```python
path("updates/check/", views.CheckUpdateView.as_view(), name="updates-check"),
path("updates/apply/", views.ApplyUpdateView.as_view(), name="updates-apply"),
```

---

### Step 4: Add Frontend UI

#### 4a. Create Hook — `frontend/hooks/use-updates.ts`

Following the pattern in `frontend/hooks/use-advanced-settings.ts`:

```typescript
interface UpdateInfo {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  changelog: string[];
  error: string | null;
}

useCheckUpdate()   // useMutation → GET /api/system/updates/check/
useApplyUpdate()   // useMutation → POST /api/system/updates/apply/ with {confirm: true}
```

#### 4b. Add UI to Settings — `frontend/app/settings/SettingsClient.tsx`

Add an **"Updates"** section in the Advanced tab, between Instance Info and Logging.

**UI States:**

| State | What the User Sees |
|-------|-------------------|
| **Idle** | "Check for Updates" button with refresh icon |
| **Checking** | Button with spinner, "Checking..." |
| **Up to date** | "You are running the latest version." |
| **Update available** | New version number + changelog + "Install Update" button |
| **Confirming** | ConfirmDialog: "Services will restart. Takes 1-3 min. Data is safe." |
| **Updating** | Spinner: "Updating to vX.Y.Z... Services are restarting." |
| **Complete** | Toast: "Successfully updated to vX.Y.Z!" |
| **Error** | Error message + suggestion to run `docker compose up -d` manually |

**Post-update detection:** After triggering the update, poll `GET /api/system/info/` every 5 seconds. Connection errors during restart are expected — keep polling silently. When the version in the response matches the target version → show success. After 5 minutes → show timeout error.

#### 4c. Add i18n Strings

Add ~16 new keys to all 6 translation files:

| File | Language |
|------|----------|
| `frontend/lib/i18n/translations/en.ts` | English |
| `frontend/lib/i18n/translations/de.ts` | German |
| `frontend/lib/i18n/translations/es.ts` | Spanish |
| `frontend/lib/i18n/translations/fr.ts` | French |
| `frontend/lib/i18n/translations/ja.ts` | Japanese |
| `frontend/lib/i18n/translations/zh.ts` | Chinese |

Key strings needed:

```
settings.advanced.updates
settings.advanced.softwareUpdates
settings.advanced.checkForUpdates
settings.advanced.checking
settings.advanced.upToDate
settings.advanced.updateAvailable          (with {version} placeholder)
settings.advanced.changelog
settings.advanced.installUpdate
settings.advanced.confirmUpdateTitle
settings.advanced.confirmUpdateDesc
settings.advanced.updatingTo               (with {version} placeholder)
settings.advanced.updateInProgress
settings.advanced.updateComplete           (with {version} placeholder)
settings.advanced.updateFailed
settings.advanced.updateTimeout
settings.advanced.updateServiceUnavailable
```

---

## Self-Restart: How It Works Safely

This is the trickiest part. When the updater runs `docker compose up -d --build`, it restarts **itself** too. Here's why it's safe:

1. `POST /update` returns **immediately** (HTTP 200) before starting the update
2. The update script runs as a **background subprocess**
3. `docker compose up -d` sends the restart command to the **Docker daemon** via the socket
4. The Docker daemon manages the restart **independently** — even if the updater container is killed mid-script, the daemon completes the operation
5. The frontend keeps **polling** `/api/system/info/` — connection errors during restart are expected and silently retried

---

## Error Handling

| Scenario | What Happens |
|----------|-------------|
| **Updater container not running** | Django returns 502 → frontend shows "Update service unavailable" |
| **No internet** | `git fetch` fails → frontend shows "Could not check for updates" |
| **Local commits exist** | `git pull --ff-only` fails safely → error returned to user |
| **Docker build fails** | Old containers keep running → error reported to user |
| **Connection lost during restart** | Expected behavior → frontend keeps polling silently |
| **User navigates away** | Update continues server-side → version updates when they return |
| **Already on latest version** | `update_available: false` → "You are running the latest version" |

---

## Files Summary

### New Files to Create

| File | Purpose |
|------|---------|
| `updater/Dockerfile` | Alpine container with git + docker CLI |
| `updater/server.py` | Stdlib HTTP server (`/health`, `/check`, `/update`) |
| `updater/update.sh` | Git pull + docker compose rebuild script |
| `frontend/hooks/use-updates.ts` | React Query hooks for check/apply |

### Existing Files to Modify

| File | Change |
|------|--------|
| `docker-compose.yml` | Add `updater` service + env vars to `django` |
| `.env.example` | Add `UPDATER_SERVICE_URL`, `UPDATER_API_KEY` |
| `backend/system/views.py` | Add `_UpdaterBase`, `CheckUpdateView`, `ApplyUpdateView` |
| `backend/system/urls.py` | Add 2 URL patterns |
| `frontend/app/settings/SettingsClient.tsx` | Add Updates section to Advanced tab |
| `frontend/lib/i18n/translations/*.ts` | Add ~16 i18n keys (all 6 files) |

### Files NOT Modified

| File | Reason |
|------|--------|
| `backend/entrypoint.sh` | Has fallback logic — never modify |
| `backend/Dockerfile` | No changes needed |
| `frontend/Dockerfile` | No changes needed |

---

## Testing & Verification

1. **Build and start:** `docker compose up -d --build`
2. **Verify updater is running:** `docker compose ps updater`
3. **Test check endpoint:** Go to Settings > Advanced, click "Check for Updates"
4. **Create a test release:**
   ```bash
   git tag -a v1.0.1 -m "Test release"
   git push origin v1.0.1
   ```
5. **Check again:** Should now show "Version 1.0.1 is available"
6. **Install update:** Click "Install Update" → confirm → wait for restart
7. **Verify:** Version in Settings should show v1.0.1
8. **Test errors:** Stop updater container, try checking — should show "service unavailable"
9. **Type check:** `npx tsc --noEmit` — no TypeScript errors
