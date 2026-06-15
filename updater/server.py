"""
Updater service — a tiny stdlib-only HTTP server that checks for new
versions (Docker Hub tags) and triggers updates (docker compose pull + up).

Endpoints
---------
GET  /health  → {"status": "ok"}
GET  /check   → {"current_version", "latest_version", "update_available", "changelog", "error"}
POST /update  → SSE stream of {"stage", "status", "percent"} events while update.sh runs.
"""

import json
import os
import subprocess
import re
import time
import urllib.request
import urllib.error
from http.server import ThreadingHTTPServer, BaseHTTPRequestHandler

# The bundled docker compose plugin negotiates an older Docker API (1.43) than
# newer Docker Engines accept (min 1.44+). Pin a supported version so every
# `docker compose` subprocess we spawn (update / engine-switch) works.
os.environ.setdefault("DOCKER_API_VERSION", "1.44")

API_KEY = os.environ.get("UPDATER_API_KEY", "")
LOCAL_AI_IMAGE_PREFIX = os.environ.get("LOCAL_AI_IMAGE_PREFIX", "").strip()
if not LOCAL_AI_IMAGE_PREFIX:
    raise RuntimeError("LOCAL_AI_IMAGE_PREFIX env var is required (set in .env)")
DOCKER_HUB_IMAGE = f"{LOCAL_AI_IMAGE_PREFIX}/local-ai-django"
CURRENT_VERSION_ENV = os.environ.get("CURRENT_VERSION", "")
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/project")
PORT = int(os.environ.get("UPDATER_PORT", "8070"))

# Bundled Ollama service/container used by the "switch engine" feature.
OLLAMA_SERVICE = "ollama"
OLLAMA_CONTAINER = "local-ai-ollama"


def _compose_file() -> str:
    """Pick the compose file the running stack uses (release first)."""
    for name in ("docker-compose.release.yml", "docker-compose.yml"):
        path = os.path.join(PROJECT_DIR, name)
        if os.path.exists(path):
            return path
    return os.path.join(PROJECT_DIR, "docker-compose.release.yml")


def _run(args: list[str]):
    """Run a command in the project dir, capturing output."""
    return subprocess.run(args, cwd=PROJECT_DIR, capture_output=True, text=True)


def _compose_project() -> str:
    """The compose project name the running stack uses. The updater's working
    dir is /project, so compose would otherwise default to "project" and put
    the Ollama container in a SEPARATE project + network — unreachable by
    django/rag. Read the real name off an existing stack container instead."""
    for name in ("local-ai-django", "local-ai-updater", "local-ai-caddy", "local-ai-postgres"):
        r = subprocess.run(
            ["docker", "inspect", "--format",
             '{{index .Config.Labels "com.docker.compose.project"}}', name],
            capture_output=True, text=True,
        )
        proj = (r.stdout or "").strip()
        if proj:
            return proj
    return "local-ai"


def _current_version() -> str:
    if CURRENT_VERSION_ENV:
        return CURRENT_VERSION_ENV
    # Dev fallback: read from source-mounted settings.py
    settings_path = os.path.join(PROJECT_DIR, "backend", "config", "settings.py")
    try:
        with open(settings_path) as f:
            for line in f:
                match = re.match(r'^VERSION\s*=\s*["\']([^"\']+)["\']', line)
                if match:
                    return match.group(1)
    except FileNotFoundError:
        pass
    return "0.0.0"


def _latest_docker_hub_version() -> str | None:
    """Return the highest semver tag published on Docker Hub for DOCKER_HUB_IMAGE."""
    if not DOCKER_HUB_IMAGE or "/" not in DOCKER_HUB_IMAGE:
        return None

    namespace, repository = DOCKER_HUB_IMAGE.split("/", 1)
    url = (
        f"https://hub.docker.com/v2/repositories/{namespace}/{repository}"
        f"/tags/?page_size=100&ordering=-last_updated"
    )

    try:
        req = urllib.request.Request(url, headers={"Accept": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as resp:
            data = json.loads(resp.read().decode())
    except (urllib.error.URLError, json.JSONDecodeError):
        return None

    semver_pattern = re.compile(r'^v?(\d+\.\d+\.\d+)$')
    versions: list[str] = []
    for tag in data.get("results", []):
        name = tag.get("name", "")
        m = semver_pattern.match(name)
        if m:
            versions.append(m.group(1))

    if not versions:
        return None

    versions.sort(key=lambda v: tuple(int(x) for x in v.split(".")), reverse=True)
    return versions[0]


def _compare_versions(current: str, latest: str) -> bool:
    """Return True if latest is newer than current (semver comparison)."""
    def to_tuple(v: str) -> tuple[int, ...]:
        return tuple(int(x) for x in re.findall(r'\d+', v))
    try:
        return to_tuple(latest) > to_tuple(current)
    except (ValueError, TypeError):
        return False


class Handler(BaseHTTPRequestHandler):
    """Handle HTTP requests for the updater service."""

    def _send_json(self, data: dict, status_code: int = 200):
        body = json.dumps(data).encode()
        self.send_response(status_code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _check_auth(self) -> bool:
        if not API_KEY:
            return True
        provided = self.headers.get("X-API-Key", "")
        if provided != API_KEY:
            self._send_json({"error": "Unauthorized"}, 401)
            return False
        return True

    def _write_sse(self, payload: dict):
        line = f"data: {json.dumps(payload)}\n\n".encode()
        self.wfile.write(line)
        self.wfile.flush()

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"status": "ok"})
            return

        if self.path == "/check":
            if not self._check_auth():
                return
            try:
                current = _current_version()
                latest = _latest_docker_hub_version()

                if latest is None:
                    self._send_json({
                        "current_version": current,
                        "latest_version": current,
                        "update_available": False,
                        "changelog": [],
                        "error": "Could not fetch tags from Docker Hub. Check your internet connection.",
                    })
                    return

                available = _compare_versions(current, latest)

                self._send_json({
                    "current_version": current,
                    "latest_version": latest,
                    "update_available": available,
                    "changelog": [],
                    "error": None,
                })
            except Exception as e:
                self._send_json({
                    "current_version": _current_version(),
                    "latest_version": None,
                    "update_available": False,
                    "changelog": [],
                    "error": str(e),
                }, 500)
            return

        self._send_json({"error": "Not found"}, 404)

    def do_POST(self):
        if self.path == "/update":
            if not self._check_auth():
                return
            self._stream_update()
            return

        if self.path == "/engine-switch":
            if not self._check_auth():
                return
            self._engine_switch()
            return

        self._send_json({"error": "Not found"}, 404)

    def _engine_switch(self):
        """Start (docker) or stop+remove (machine) the bundled Ollama container,
        streaming progress as SSE so the UI can show a progress bar.

        body: {"engine": "docker"}  → pull + start the ollama container
              {"engine": "machine"} → stop+remove the container AND its image
        Emits `data: {"stage","status","percent"}` frames; final frame has
        stage "done" (percent 100) or "error".
        """
        length = int(self.headers.get("Content-Length", 0) or 0)
        raw = self.rfile.read(length) if length else b"{}"
        try:
            engine = (json.loads(raw or b"{}").get("engine") or "").strip()
        except json.JSONDecodeError:
            engine = ""
        if engine not in ("docker", "machine"):
            self._send_json({"error": "engine must be 'docker' or 'machine'"}, 400)
            return

        # Switch to SSE — from here we own the connection.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        def emit(stage, status, percent):
            self._write_sse({"stage": stage, "status": status, "percent": percent})

        cf = _compose_file()
        proj = _compose_project()
        # Base compose invocation pinned to the real project name so the Ollama
        # container joins the existing "local-ai" stack + network (not a stray
        # "project" group).
        base = ["docker", "compose", "-p", proj, "-f", cf, "--profile", "container-ollama"]
        try:
            if engine == "docker":
                emit("start", "Preparing…", 5)
                # Pull the image with live output so the bar advances.
                proc = subprocess.Popen(
                    base + ["pull", OLLAMA_SERVICE],
                    cwd=PROJECT_DIR, stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT, text=True, bufsize=1,
                )
                pct = 10
                assert proc.stdout is not None
                for line in proc.stdout:
                    if not line.strip():
                        continue
                    if pct < 85:
                        pct += 3
                    emit("pull", "Downloading Ollama image…", min(pct, 85))
                proc.wait()
                emit("start", "Starting container…", 90)
                r = _run(base + ["up", "-d", OLLAMA_SERVICE])
                if r.returncode != 0:
                    emit("error", ((r.stderr or r.stdout or "Failed to start container").strip())[-300:], 0)
                    return
                # Wait until Ollama is actually reachable/healthy so the app
                # doesn't briefly mark the provider disconnected ("No active
                # provider connected") right after the switch.
                ready = False
                for i in range(30):
                    h = subprocess.run(
                        ["docker", "inspect", "--format",
                         "{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}",
                         OLLAMA_CONTAINER],
                        capture_output=True, text=True,
                    ).stdout.strip()
                    if h == "healthy":
                        ready = True
                        break
                    emit("start", "Waiting for Ollama to be ready…", min(90 + i, 99))
                    time.sleep(2)
                emit("done", "Docker engine ready" if ready else "Started (still warming up)", 100)
            else:
                emit("start", "Stopping container…", 20)
                img = subprocess.run(
                    ["docker", "inspect", "--format", "{{.Image}}", OLLAMA_CONTAINER],
                    capture_output=True, text=True,
                ).stdout.strip()
                _run(base + ["rm", "-sf", OLLAMA_SERVICE])
                emit("remove", "Removing image…", 70)
                if img:
                    subprocess.run(["docker", "image", "rm", "-f", img],
                                   capture_output=True, text=True)
                emit("done", "Switched to machine", 100)
        except (BrokenPipeError, ConnectionResetError):
            return
        except Exception as e:
            try:
                emit("error", str(e), 0)
            except (BrokenPipeError, ConnectionResetError):
                pass

    def _stream_update(self):
        """Run update.sh as a subprocess and stream its line-delimited
        progress events back to the client as Server-Sent Events.

        update.sh prints one JSON object per line; we wrap each as an
        `data: <json>\\n\\n` SSE frame so the frontend can parse with the
        same pattern used for model pulls.
        """
        current = _current_version()
        latest = _latest_docker_hub_version()

        # SSE response headers — once we send these we own the connection
        # and can no longer use _send_json for errors.
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache, no-transform")
        self.send_header("Connection", "keep-alive")
        self.send_header("X-Accel-Buffering", "no")
        self.end_headers()

        if latest is None or not _compare_versions(current, latest):
            self._write_sse({
                "stage": "error",
                "status": "No update available.",
                "percent": 0,
            })
            return

        proc = subprocess.Popen(
            ["/app/update.sh", PROJECT_DIR, latest],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            bufsize=1,
            text=True,
        )

        try:
            assert proc.stdout is not None
            for line in proc.stdout:
                line = line.strip()
                if not line:
                    continue
                # Lines are JSON objects from update.sh emit() / docker output.
                # If parsing fails, forward as a plain log line.
                try:
                    payload = json.loads(line)
                except json.JSONDecodeError:
                    payload = {"stage": "log", "status": line, "percent": None}
                try:
                    self._write_sse(payload)
                except (BrokenPipeError, ConnectionResetError):
                    # Client disconnected — keep the subprocess running so
                    # the update still completes in the background.
                    return
            proc.wait()
        except Exception as e:
            try:
                self._write_sse({
                    "stage": "error",
                    "status": str(e),
                    "percent": 0,
                })
            except (BrokenPipeError, ConnectionResetError):
                pass

    def log_message(self, format, *args):
        """Suppress default stderr logging to keep container logs clean."""
        pass


if __name__ == "__main__":
    # ThreadingHTTPServer so a long request (engine-switch / update pulls an
    # image for minutes) doesn't block health checks or other requests — that
    # blocking caused "connect timed out" when a second request arrived.
    server = ThreadingHTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Updater service listening on port {PORT}")
    server.serve_forever()
