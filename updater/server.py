"""
Updater service — a tiny stdlib-only HTTP server that checks for new
versions (Docker Hub tags) and triggers updates (docker compose pull + up).

Endpoints
---------
GET  /health  → {"status": "ok"}
GET  /check   → {"current_version", "latest_version", "update_available", "changelog", "error"}
POST /update  → {"status": "updating", "target_version"}  (kicks off update.sh in background)
"""

import json
import os
import subprocess
import re
import urllib.request
import urllib.error
from http.server import HTTPServer, BaseHTTPRequestHandler

API_KEY = os.environ.get("UPDATER_API_KEY", "")
LOCAL_AI_IMAGE_PREFIX = os.environ.get("LOCAL_AI_IMAGE_PREFIX", "aqibbuttportfolio")
DOCKER_HUB_IMAGE = f"{LOCAL_AI_IMAGE_PREFIX}/local-ai-django"
CURRENT_VERSION_ENV = os.environ.get("CURRENT_VERSION", "")
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/project")
PORT = int(os.environ.get("UPDATER_PORT", "8070"))


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
            try:
                current = _current_version()
                latest = _latest_docker_hub_version()

                if latest is None or not _compare_versions(current, latest):
                    self._send_json({
                        "error": "No update available.",
                    }, 400)
                    return

                subprocess.Popen(
                    ["/app/update.sh", PROJECT_DIR, latest],
                    stdout=subprocess.DEVNULL,
                    stderr=subprocess.DEVNULL,
                    start_new_session=True,
                )

                self._send_json({
                    "status": "updating",
                    "target_version": latest,
                })
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        self._send_json({"error": "Not found"}, 404)

    def log_message(self, format, *args):
        """Suppress default stderr logging to keep container logs clean."""
        pass


if __name__ == "__main__":
    server = HTTPServer(("0.0.0.0", PORT), Handler)
    print(f"Updater service listening on port {PORT}")
    server.serve_forever()
