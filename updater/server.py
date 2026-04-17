"""
Updater service — a tiny stdlib-only HTTP server that checks for new
versions (git tags) and triggers updates (git pull + docker compose up).

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
from http.server import HTTPServer, BaseHTTPRequestHandler

API_KEY = os.environ.get("UPDATER_API_KEY", "")
PROJECT_DIR = os.environ.get("PROJECT_DIR", "/project")
PORT = int(os.environ.get("UPDATER_PORT", "8070"))

# Cached HTTPS URL — computed once on first use
_HTTPS_URL: str | None = None


def _run(cmd: list[str], timeout: int = 30) -> tuple[str, str, int]:
    """Run a command and return (stdout, stderr, returncode)."""
    proc = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
    return proc.stdout.strip(), proc.stderr.strip(), proc.returncode


def _get_https_url() -> str | None:
    """Get the HTTPS version of the origin remote URL.

    The host uses SSH (git@github.com:org/repo.git) for push, but the
    updater container has no SSH keys. For a public repo, HTTPS works
    without credentials. This converts SSH → HTTPS automatically.
    """
    global _HTTPS_URL
    if _HTTPS_URL is not None:
        return _HTTPS_URL

    out, _, rc = _run(["git", "-C", PROJECT_DIR, "remote", "get-url", "origin"])
    if rc != 0 or not out:
        return None
    url = out.strip()

    if url.startswith("https://"):
        _HTTPS_URL = url
    else:
        # git@github.com:org/repo.git → https://github.com/org/repo.git
        m = re.match(r"git@([^:]+):(.+)", url)
        if m:
            _HTTPS_URL = f"https://{m.group(1)}/{m.group(2)}"

    return _HTTPS_URL


def _current_branch() -> str:
    """Return the active git branch name."""
    out, _, rc = _run(["git", "-C", PROJECT_DIR, "rev-parse", "--abbrev-ref", "HEAD"])
    return out if rc == 0 else "unknown"


def _current_version() -> str:
    """Read VERSION from Django settings.py as the single source of truth."""
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


def _latest_remote_tag() -> str | None:
    """Return the highest semver tag on the remote (after git fetch)."""
    https_url = _get_https_url()
    if not https_url:
        return None

    # Use HTTPS URL directly so we don't need SSH keys
    _run(["git", "-C", PROJECT_DIR, "fetch", https_url, "--tags", "--force"], timeout=60)

    out, _, rc = _run(
        ["git", "-C", PROJECT_DIR, "tag", "-l", "v*", "--sort=-version:refname"]
    )
    if rc != 0 or not out:
        return None
    return out.splitlines()[0].lstrip("v")


def _changelog(current: str, latest: str) -> list[str]:
    """Return commit subjects between current and latest version tags."""
    out, _, rc = _run([
        "git", "-C", PROJECT_DIR, "log",
        f"v{current}..v{latest}", "--oneline", "--no-merges",
    ])
    if rc != 0 or not out:
        return []
    return out.splitlines()[:20]


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
                latest = _latest_remote_tag()
                branch = _current_branch()

                if latest is None:
                    self._send_json({
                        "current_version": current,
                        "latest_version": current,
                        "update_available": False,
                        "branch": branch,
                        "changelog": [],
                        "error": "Could not fetch remote tags. Check your internet connection.",
                    })
                    return

                available = _compare_versions(current, latest)
                changelog = _changelog(current, latest) if available else []

                self._send_json({
                    "current_version": current,
                    "latest_version": latest,
                    "update_available": available,
                    "branch": branch,
                    "changelog": changelog,
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
                latest = _latest_remote_tag()

                if latest is None or not _compare_versions(current, latest):
                    self._send_json({
                        "error": "No update available.",
                    }, 400)
                    return

                subprocess.Popen(
                    ["/app/update.sh", PROJECT_DIR],
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
