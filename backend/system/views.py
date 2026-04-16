import io
import json
import logging
import os
import time
import zipfile
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import requests as http_requests
from django.conf import settings
from django.contrib.auth import get_user_model
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.serializers import UserReadSerializer
from core.permissions import IsAdminUser
from notifications.models import Notification, NotificationPreference

from .models import InstanceSettings, ModelConfig, Provider
from .rag_queries import delete_all_chat_data, get_all_chat_data, get_query_history
from .serializers import (
    InstanceSettingsSerializer,
    ModelConfigSerializer,
    ProviderSerializer,
)

logger = logging.getLogger(__name__)

RAG_SERVICE_URL = os.environ.get("RAG_SERVICE_URL", "http://localhost:8080")
RAG_API_KEY = os.environ.get("RAG_API_KEY", "")


def _rag_headers():
    headers = {}
    if RAG_API_KEY:
        headers["X-API-Key"] = RAG_API_KEY
    return headers


def _format_uptime(seconds):
    """Format seconds into a human-readable uptime string."""
    days = int(seconds // 86400)
    hours = int((seconds % 86400) // 3600)
    minutes = int((seconds % 3600) // 60)

    parts = []
    if days > 0:
        parts.append(f"{days} day{'s' if days != 1 else ''}")
    if hours > 0:
        parts.append(f"{hours} hour{'s' if hours != 1 else ''}")
    if minutes > 0 and days == 0:
        parts.append(f"{minutes} minute{'s' if minutes != 1 else ''}")
    return ", ".join(parts) or "just started"


class StorageInfoView(APIView):
    """Aggregate storage metrics from host disk, Ollama, RAG, and PostgreSQL."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        import shutil

        breakdown = {
            "models": 0,
            "uploaded_files": 0,
            "vector_embeddings": 0,
            "chat_history": 0,
        }

        # 1. Host disk usage (container sees the host filesystem)
        try:
            disk = shutil.disk_usage("/")
            disk_total = disk.total
            disk_used = disk.used
            disk_free = disk.free
        except Exception:
            disk_total = disk_used = disk_free = 0

        # 2. Ollama models — sum sizes, separating user models from system models
        #    The embedding model (nomic-embed-text) is auto-pulled for RAG and
        #    shouldn't count as a user-downloaded model.
        SYSTEM_MODELS = {"nomic-embed-text"}
        try:
            ollama_url = os.environ.get("OLLAMA_HOST", "http://ollama:11434")
            resp = http_requests.get(
                f"{ollama_url.rstrip('/')}/api/tags", timeout=5
            )
            resp.raise_for_status()
            models = resp.json().get("models", [])
            user_total = 0
            system_total = 0
            for m in models:
                name = m.get("name", "")
                size = m.get("size", 0)
                # Check if any system model name is a prefix of this model's name
                if any(name.startswith(s) for s in SYSTEM_MODELS):
                    system_total += size
                else:
                    user_total += size
            breakdown["models"] = user_total
            breakdown["system_models"] = system_total
        except Exception as e:
            logger.warning("Failed to fetch Ollama model sizes: %s", e)

        # 3. RAG service — uploaded files + vector store size
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/storage-info")
            resp = http_requests.get(rag_url, headers=_rag_headers(), timeout=10)
            resp.raise_for_status()
            rag_data = resp.json()
            breakdown["uploaded_files"] = rag_data.get("uploaded_files_bytes", 0)
            breakdown["vector_embeddings"] = rag_data.get("vector_db_bytes", 0)
        except Exception as e:
            logger.warning("Failed to fetch RAG storage info: %s", e)

        # 4. PostgreSQL — only chat-related tables.
        # Resilient to any of the three tables not existing yet (e.g. before the
        # RAG migration for query_history has run): we count rows and sum sizes
        # only across tables that currently exist in the public schema.
        try:
            from django.db import connection as db_conn

            chat_tables = ("messages", "conversations", "query_history")

            with db_conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT c.relname
                    FROM pg_class c
                    JOIN pg_namespace n ON n.oid = c.relnamespace
                    WHERE n.nspname = 'public'
                      AND c.relkind = 'r'
                      AND c.relname = ANY(%s)
                    """,
                    [list(chat_tables)],
                )
                existing = [row[0] for row in cursor.fetchall()]

                if existing:
                    # Count rows across existing tables only
                    count_sql = " UNION ALL ".join(
                        f"SELECT count(*) AS cnt FROM {name}" for name in existing
                    )
                    cursor.execute(f"SELECT COALESCE(SUM(cnt), 0) FROM ({count_sql}) t")
                    row_count = cursor.fetchone()[0]

                    # Only report size if there are actual rows, otherwise
                    # empty tables still consume ~72 KB of PostgreSQL overhead.
                    if row_count > 0:
                        cursor.execute(
                            """
                            SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)
                            FROM pg_class c
                            JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'public'
                              AND c.relkind = 'r'
                              AND c.relname = ANY(%s)
                            """,
                            [existing],
                        )
                        breakdown["chat_history"] = cursor.fetchone()[0]
        except Exception as e:
            logger.warning("Failed to fetch chat history size: %s", e)

        total_used = sum(breakdown.values())

        return Response(
            {
                "disk": {
                    "total": disk_total,
                    # Report local-ai's app-data footprint here, not the shared
                    # Docker VM "used" — that includes overlay layers/build
                    # cache and is reported separately by /storage/docker/.
                    "used": total_used,
                    "free": disk_free,
                },
                "breakdown": breakdown,
                "total_tracked": total_used,
            }
        )


# ---------------------------------------------------------------------------
# Docker infrastructure usage (images + volumes + container layers)
# ---------------------------------------------------------------------------

DOCKER_SOCK_PATH = "/var/run/docker.sock"
COMPOSE_PROJECT = "local-ai"


def _docker_get(path: str):
    """GET request to the Docker Engine API over the unix socket. Stdlib only."""
    import http.client
    import socket as _socket

    class UnixHTTPConnection(http.client.HTTPConnection):
        def __init__(self, sock_path):
            super().__init__("localhost")
            self._sock_path = sock_path

        def connect(self):
            sock = _socket.socket(_socket.AF_UNIX, _socket.SOCK_STREAM)
            sock.connect(self._sock_path)
            self.sock = sock

    conn = UnixHTTPConnection(DOCKER_SOCK_PATH)
    try:
        conn.request("GET", path)
        resp = conn.getresponse()
        body = resp.read()
        if resp.status >= 400:
            raise RuntimeError(f"Docker API {path} returned {resp.status}: {body[:200]!r}")
        return json.loads(body)
    finally:
        conn.close()


class DockerUsageView(APIView):
    """Report Docker disk usage split into:
      - this compose project (local-ai), broken down per service
      - "other": everything else on the Docker host
    Each image, container, and volume is attributed to exactly one bucket.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        if not os.path.exists(DOCKER_SOCK_PATH):
            return Response(
                {
                    "available": False,
                    "error": (
                        "Docker socket not available. Mount "
                        "/var/run/docker.sock into the Django container to enable."
                    ),
                }
            )

        try:
            df = _docker_get("/v1.41/system/df")
        except Exception as e:
            logger.warning("Docker API call failed: %s", e)
            return Response({"available": False, "error": str(e)})

        all_containers = df.get("Containers") or []
        all_images = df.get("Images") or []
        all_volumes = df.get("Volumes") or []

        def _img_size(img):
            return int(img.get("Size") or 0)

        image_by_id = {img.get("Id"): img for img in all_images}
        volume_by_name = {v.get("Name"): v for v in all_volumes}

        # ---- This project ---------------------------------------------------
        project_containers = [
            c for c in all_containers
            if (c.get("Labels") or {}).get("com.docker.compose.project") == COMPOSE_PROJECT
        ]

        services_map: dict = {}
        for c in project_containers:
            labels = c.get("Labels") or {}
            svc_name = labels.get("com.docker.compose.service") or "unknown"
            entry = services_map.setdefault(svc_name, {
                "name": svc_name,
                "image_id": None,
                "image_name": None,
                "image_size": 0,
                "container_layer": 0,
                "volumes": [],
                "_volume_names": set(),
                "total": 0,
            })
            entry["image_id"] = c.get("ImageID") or entry["image_id"]
            entry["image_name"] = c.get("Image") or entry["image_name"]
            entry["container_layer"] += int(c.get("SizeRw") or 0)
            for m in c.get("Mounts") or []:
                if m.get("Type") == "volume" and m.get("Name"):
                    entry["_volume_names"].add(m["Name"])

        for entry in services_map.values():
            img = image_by_id.get(entry["image_id"])
            if img:
                entry["image_size"] = _img_size(img)
            for vname in sorted(entry.pop("_volume_names")):
                v = volume_by_name.get(vname)
                size = int((v.get("UsageData") or {}).get("Size") or 0) if v else 0
                entry["volumes"].append({"name": vname, "size": size})
            entry["total"] = (
                entry["image_size"]
                + entry["container_layer"]
                + sum(v["size"] for v in entry["volumes"])
            )

        services = sorted(services_map.values(), key=lambda s: s["total"], reverse=True)

        project_image_ids: set = set()
        project_image_size = 0
        for s in services:
            iid = s["image_id"]
            if iid and iid not in project_image_ids:
                project_image_ids.add(iid)
                project_image_size += s["image_size"]
        project_container_size = sum(s["container_layer"] for s in services)

        # Volumes attributable to this project: BOTH compose-labeled named
        # volumes AND any anonymous volume currently mounted by a project
        # container (anonymous volumes don't carry the compose project label
        # but morally belong to the service that mounts them).
        labeled_project_volume_names = {
            v.get("Name") for v in all_volumes
            if (v.get("Labels") or {}).get("com.docker.compose.project") == COMPOSE_PROJECT
        }
        mounted_volume_names = {
            m.get("Name")
            for c in project_containers
            for m in (c.get("Mounts") or [])
            if m.get("Type") == "volume" and m.get("Name")
        }
        project_volume_names = labeled_project_volume_names | mounted_volume_names
        project_volume_size = sum(
            int((v.get("UsageData") or {}).get("Size") or 0)
            for v in all_volumes
            if v.get("Name") in project_volume_names
        )

        project_total = project_image_size + project_container_size + project_volume_size

        # ---- Other (everything outside this project) -----------------------
        other_containers = [
            c for c in all_containers
            if (c.get("Labels") or {}).get("com.docker.compose.project") != COMPOSE_PROJECT
        ]
        other_images = [img for img in all_images if img.get("Id") not in project_image_ids]
        other_volumes = [v for v in all_volumes if v.get("Name") not in project_volume_names]

        other_image_size = sum(_img_size(img) for img in other_images)
        other_container_size = sum(int(c.get("SizeRw") or 0) for c in other_containers)
        other_volume_size = sum(
            int((v.get("UsageData") or {}).get("Size") or 0) for v in other_volumes
        )
        other_total = other_image_size + other_container_size + other_volume_size

        try:
            import shutil
            disk = shutil.disk_usage("/")
            disk_total = disk.total
            disk_free = disk.free
        except Exception:
            disk_total = disk_free = 0

        return Response(
            {
                "available": True,
                "project": {
                    "name": COMPOSE_PROJECT,
                    "services": services,
                    "totals": {
                        "images": project_image_size,
                        "containers": project_container_size,
                        "volumes": project_volume_size,
                        "total": project_total,
                    },
                },
                "other": {
                    "images_count": len(other_images),
                    "containers_count": len(other_containers),
                    "volumes_count": len(other_volumes),
                    "totals": {
                        "images": other_image_size,
                        "containers": other_container_size,
                        "volumes": other_volume_size,
                        "total": other_total,
                    },
                },
                "disk": {
                    "total": disk_total,
                    "free": disk_free,
                },
            }
        )


class ClearCacheView(APIView):
    """Clear vector DB cache via the RAG service."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/clear-cache")
            resp = http_requests.post(rag_url, headers=_rag_headers(), timeout=30)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            logger.warning("Clear cache failed: %s", e)
            return Response(
                {"error": {"code": "CACHE_ERROR", "message": str(e)}},
                status=status.HTTP_500_INTERNAL_SERVER_ERROR,
            )


class InstanceInfoView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        instance = InstanceSettings.get_or_create_singleton()
        now = datetime.now(timezone.utc)
        start = getattr(settings, "PROCESS_START_TIME", now)
        uptime_seconds = (now - start).total_seconds()

        return Response(
            {
                "version": getattr(settings, "VERSION", "1.0.0"),
                "instance_id": instance.instance_id,
                "uptime_seconds": int(uptime_seconds),
                "uptime_display": _format_uptime(uptime_seconds),
                "last_updated": instance.updated_at.isoformat(),
            }
        )


class InstanceSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        instance = InstanceSettings.get_or_create_singleton()
        serializer = InstanceSettingsSerializer(instance)
        return Response({"settings": serializer.data})

    def patch(self, request):
        instance = InstanceSettings.get_or_create_singleton()
        serializer = InstanceSettingsSerializer(instance, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"settings": serializer.data})


class ExportChatHistoryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        data = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "conversations": get_all_chat_data(),
        }
        response = HttpResponse(
            json.dumps(data, indent=2, default=str),
            content_type="application/json",
        )
        response["Content-Disposition"] = 'attachment; filename="chat-history.json"'
        return response


class ExportSettingsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        instance = InstanceSettings.get_or_create_singleton()

        notif_prefs = {}
        try:
            prefs = user.notification_preferences
            notif_prefs = {
                "model_download": prefs.model_download,
                "file_indexing": prefs.file_indexing,
                "system_errors": prefs.system_errors,
            }
        except NotificationPreference.DoesNotExist:
            notif_prefs = {
                "model_download": True,
                "file_indexing": True,
                "system_errors": True,
            }

        data = {
            "exported_at": datetime.now(timezone.utc).isoformat(),
            "user": {
                "display_name": user.display_name,
                "email": user.email,
                "is_staff": user.is_staff,
            },
            "notification_preferences": notif_prefs,
            "instance_settings": {
                "request_logging": instance.request_logging,
                "debug_mode": instance.debug_mode,
                "instance_id": instance.instance_id,
            },
        }
        response = HttpResponse(
            json.dumps(data, indent=2, default=str),
            content_type="application/json",
        )
        response["Content-Disposition"] = 'attachment; filename="settings.json"'
        return response


class ExportAllDataView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        now = datetime.now(timezone.utc).isoformat()

        chat_data = json.dumps(
            {"exported_at": now, "conversations": get_all_chat_data()},
            indent=2,
            default=str,
        )

        user = request.user
        instance = InstanceSettings.get_or_create_singleton()
        notif_prefs = {}
        try:
            prefs = user.notification_preferences
            notif_prefs = {
                "model_download": prefs.model_download,
                "file_indexing": prefs.file_indexing,
                "system_errors": prefs.system_errors,
            }
        except NotificationPreference.DoesNotExist:
            notif_prefs = {
                "model_download": True,
                "file_indexing": True,
                "system_errors": True,
            }

        settings_data = json.dumps(
            {
                "exported_at": now,
                "user": {
                    "display_name": user.display_name,
                    "email": user.email,
                    "is_staff": user.is_staff,
                },
                "notification_preferences": notif_prefs,
                "instance_settings": {
                    "request_logging": instance.request_logging,
                    "debug_mode": instance.debug_mode,
                    "instance_id": instance.instance_id,
                },
            },
            indent=2,
            default=str,
        )

        query_data = json.dumps(
            {"exported_at": now, "query_history": get_query_history()},
            indent=2,
            default=str,
        )

        buffer = io.BytesIO()
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("chat_history.json", chat_data)
            zf.writestr("settings.json", settings_data)
            zf.writestr("query_history.json", query_data)
        buffer.seek(0)

        response = HttpResponse(buffer.read(), content_type="application/zip")
        response["Content-Disposition"] = 'attachment; filename="local-ai-export.zip"'
        return response


class ResetInstanceView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request):
        if not request.data.get("confirm"):
            return Response(
                {"error": {"code": "CONFIRMATION_REQUIRED", "message": "Confirm reset."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        instance = InstanceSettings.get_or_create_singleton()
        instance.request_logging = True
        instance.debug_mode = False
        instance.save()

        # Reset notification preferences to defaults
        try:
            prefs = request.user.notification_preferences
            prefs.model_download = True
            prefs.file_indexing = True
            prefs.system_errors = True
            prefs.save()
        except NotificationPreference.DoesNotExist:
            pass

        return Response({"message": "Instance settings reset to defaults."})


class DeleteAllDataView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request):
        if not request.data.get("confirm"):
            return Response(
                {"error": {"code": "CONFIRMATION_REQUIRED", "message": "Confirm deletion."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        delete_all_chat_data()

        Notification.objects.filter(user=request.user).delete()

        # Reset RAG service (indexed files + vector store)
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/reset")
            http_requests.post(rag_url, headers=_rag_headers(), timeout=30)
        except Exception as e:
            logger.warning("RAG reset failed during delete-all-data: %s", e)

        instance = InstanceSettings.get_or_create_singleton()
        instance.request_logging = True
        instance.debug_mode = False
        instance.save()

        return Response({"message": "All data deleted."})


class ProviderTestView(APIView):
    """Test connectivity to a model provider endpoint."""

    permission_classes = [IsAuthenticated]

    # Allowed URL schemes and private-network hosts only (prevent SSRF to external targets)
    _ALLOWED_HOSTS = frozenset({"localhost", "127.0.0.1", "::1"})

    # Map well-known localhost ports to Docker service hostnames so the backend
    # container can reach sibling services on the Docker network.
    _DOCKER_HOST_MAP = {
        ("localhost", 11434): "ollama",
        ("127.0.0.1", 11434): "ollama",
    }

    def _resolve_endpoint(self, endpoint: str) -> str:
        """Translate localhost endpoints to Docker-internal hostnames."""
        parsed = urlparse(endpoint)
        hostname = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        docker_host = self._DOCKER_HOST_MAP.get((hostname, port))
        if docker_host:
            return f"{parsed.scheme}://{docker_host}:{port}"
        return endpoint

    def post(self, request):
        endpoint = (request.data.get("endpoint") or "").strip().rstrip("/")
        provider_type = request.data.get("type", "ollama")  # "ollama" or "openai"

        if not endpoint:
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Endpoint is required."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Basic SSRF protection: only allow localhost / docker-internal hosts
        parsed = urlparse(endpoint)
        hostname = parsed.hostname or ""
        if hostname not in self._ALLOWED_HOSTS and not hostname.endswith(".local"):
            return Response(
                {"error": {"code": "VALIDATION_ERROR", "message": "Only local endpoints are allowed."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # Resolve to Docker-internal hostname if running inside Docker
        resolved = self._resolve_endpoint(endpoint)

        # Choose the health-check path based on provider type
        if provider_type == "openai":
            test_url = f"{resolved}/v1/models"
        else:
            test_url = f"{resolved}/api/tags"

        try:
            start = time.monotonic()
            resp = http_requests.get(test_url, timeout=5)
            latency_ms = round((time.monotonic() - start) * 1000)
            resp.raise_for_status()
            return Response({"connected": True, "latency_ms": latency_ms})
        except http_requests.ConnectionError:
            return Response({"connected": False, "error": "Connection refused"})
        except http_requests.Timeout:
            return Response({"connected": False, "error": "Connection timed out"})
        except http_requests.HTTPError as e:
            return Response({"connected": False, "error": f"HTTP {e.response.status_code}"})
        except Exception as e:
            return Response({"connected": False, "error": str(e)})


class _WhisperBase(APIView):
    """Shared helpers for all Whisper-related views."""

    _WHISPER_URL = os.environ.get("WHISPER_SERVICE_URL", "http://localhost:8090")
    _API_KEY = os.environ.get("WHISPER_API_KEY", "")

    _DOCKER_HOST_MAP = {
        ("localhost", 8090): "whisper",
        ("127.0.0.1", 8090): "whisper",
    }

    def _resolve_url(self) -> str:
        parsed = urlparse(self._WHISPER_URL)
        hostname = parsed.hostname or ""
        port = parsed.port or 80
        docker_host = self._DOCKER_HOST_MAP.get((hostname, port))
        if docker_host:
            return f"{parsed.scheme}://{docker_host}:{port}"
        return self._WHISPER_URL

    def _headers(self) -> dict:
        h = {}
        if self._API_KEY:
            h["X-API-Key"] = self._API_KEY
        return h


class WhisperHealthView(_WhisperBase):
    """Check connectivity to the local Whisper speech-to-text service."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        health_url = f"{self._resolve_url().rstrip('/')}/health"
        endpoint = self._WHISPER_URL.replace("http://", "").replace("https://", "")
        try:
            start = time.monotonic()
            resp = http_requests.get(health_url, timeout=5)
            latency_ms = round((time.monotonic() - start) * 1000)
            resp.raise_for_status()
            data = resp.json()
            return Response({
                "connected": True,
                "model": data.get("model", ""),
                "has_model": data.get("has_model", False),
                "models": data.get("models", []),
                "available_models": data.get("available_models", []),
                "endpoint": endpoint,
                "latency_ms": latency_ms,
            })
        except http_requests.ConnectionError:
            return Response({"connected": False, "model": "", "has_model": False, "models": [], "available_models": [], "endpoint": endpoint, "error": "Connection refused"})
        except http_requests.Timeout:
            return Response({"connected": False, "model": "", "has_model": False, "models": [], "available_models": [], "endpoint": endpoint, "error": "Connection timed out"})
        except Exception as e:
            return Response({"connected": False, "model": "", "has_model": False, "models": [], "available_models": [], "endpoint": endpoint, "error": str(e)})


class WhisperModelsView(_WhisperBase):
    """List downloaded whisper models."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        url = f"{self._resolve_url().rstrip('/')}/models"
        try:
            resp = http_requests.get(url, headers=self._headers(), timeout=10)
            resp.raise_for_status()
            return Response(resp.json())
        except Exception as e:
            return Response(
                {"error": {"message": str(e)}},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class WhisperPullModelView(_WhisperBase):
    """Download a whisper model by name — streams SSE progress."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        from django.http import StreamingHttpResponse

        name = request.data.get("name", "").strip()
        if not name:
            return Response(
                {"error": {"message": "Missing model name."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        url = f"{self._resolve_url().rstrip('/')}/models/pull"

        def stream():
            try:
                resp = http_requests.post(
                    url,
                    json={"name": name},
                    headers=self._headers(),
                    timeout=600,
                    stream=True,
                )
                resp.raise_for_status()
                # Use chunk_size=None to read data as soon as it arrives
                # from the upstream socket (avoids buffering multiple SSE
                # events into a single chunk like iter_lines does).
                buf = b""
                for chunk in resp.iter_content(chunk_size=None):
                    if not chunk:
                        continue
                    buf += chunk
                    while b"\n" in buf:
                        line, buf = buf.split(b"\n", 1)
                        line = line.strip()
                        if not line:
                            continue
                        decoded = line.decode()
                        if decoded.startswith("data: "):
                            yield decoded + "\n\n"
                        else:
                            yield f"data: {decoded}\n\n"
                # Flush any remaining data in the buffer
                if buf.strip():
                    decoded = buf.strip().decode()
                    if decoded.startswith("data: "):
                        yield decoded + "\n\n"
                    else:
                        yield f"data: {decoded}\n\n"
            except Exception as e:
                yield f"data: {json.dumps({'status': 'error', 'error': str(e)})}\n\n"

        response = StreamingHttpResponse(stream(), content_type="text/event-stream")
        response["Cache-Control"] = "no-cache"
        response["X-Accel-Buffering"] = "no"
        return response


class WhisperDeleteModelView(_WhisperBase):
    """Delete a downloaded whisper model."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, model_name: str):
        url = f"{self._resolve_url().rstrip('/')}/models/{model_name}"
        try:
            resp = http_requests.delete(url, headers=self._headers(), timeout=30)
            resp.raise_for_status()
            return Response(resp.json())
        except http_requests.HTTPError as e:
            try:
                detail = e.response.json().get("detail", str(e))
            except Exception:
                detail = str(e)
            return Response(
                {"error": {"message": detail}},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except Exception as e:
            return Response(
                {"error": {"message": str(e)}},
                status=status.HTTP_502_BAD_GATEWAY,
            )


class FactoryResetView(APIView):
    permission_classes = [IsAdminUser]

    def post(self, request):
        if not request.data.get("confirm"):
            return Response(
                {"error": {"code": "CONFIRMATION_REQUIRED", "message": "Confirm factory reset."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        # 1. Delete all chat data (messages, conversations, query_history)
        delete_all_chat_data()

        # 2. Delete all notifications and preferences for all users
        Notification.objects.all().delete()
        NotificationPreference.objects.all().delete()

        # 3. Delete all instance settings
        InstanceSettings.objects.all().delete()

        # 4. Reset RAG service (indexed files metadata + vector store)
        try:
            rag_url = urljoin(RAG_SERVICE_URL, "/api/reset")
            http_requests.post(rag_url, headers=_rag_headers(), timeout=30)
        except Exception as e:
            logger.warning("RAG reset failed during factory reset: %s", e)

        # 5. Delete all users
        User = get_user_model()
        User.objects.all().delete()

        response = Response({"message": "Factory reset complete."})
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/api/auth/token/refresh/")
        return response


class ProviderListCreateView(APIView):
    """List all providers or create a new one."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        providers = Provider.objects.all()
        serializer = ProviderSerializer(providers, many=True)
        return Response({"providers": serializer.data})

    def post(self, request):
        serializer = ProviderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        provider = serializer.save()

        # Test connectivity on creation
        connected = self._check_connection(provider)
        provider.is_connected = connected
        provider.save(update_fields=["is_connected"])

        return Response(
            {"provider": ProviderSerializer(provider).data},
            status=status.HTTP_201_CREATED,
        )

    def _check_connection(self, provider):
        """Quick connectivity check when adding a provider."""
        endpoint = provider.endpoint.rstrip("/")
        parsed = urlparse(endpoint)
        hostname = parsed.hostname or ""

        # Resolve Docker hostnames
        docker_map = {
            ("localhost", 11434): "ollama",
            ("127.0.0.1", 11434): "ollama",
        }
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        docker_host = docker_map.get((hostname, port))
        if docker_host:
            endpoint = f"{parsed.scheme}://{docker_host}:{port}"

        test_url = (
            f"{endpoint}/v1/models"
            if provider.type == "openai"
            else f"{endpoint}/api/tags"
        )
        try:
            resp = http_requests.get(test_url, timeout=3)
            resp.raise_for_status()
            return True
        except Exception:
            return False


class ProviderDetailView(APIView):
    """Retrieve, update, or delete a provider."""

    permission_classes = [IsAuthenticated]

    def _get_provider(self, provider_id):
        try:
            return Provider.objects.get(pk=provider_id)
        except Provider.DoesNotExist:
            return None

    def get(self, request, provider_id):
        provider = self._get_provider(provider_id)
        if not provider:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Provider not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        return Response({"provider": ProviderSerializer(provider).data})

    def patch(self, request, provider_id):
        provider = self._get_provider(provider_id)
        if not provider:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Provider not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        serializer = ProviderSerializer(provider, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"provider": ProviderSerializer(provider).data})

    def delete(self, request, provider_id):
        provider = self._get_provider(provider_id)
        if not provider:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Provider not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        provider.delete()
        return Response({"message": "Provider deleted."})


class ProviderSetDefaultView(APIView):
    """Set a provider as the default."""

    permission_classes = [IsAuthenticated]

    def post(self, request, provider_id):
        try:
            provider = Provider.objects.get(pk=provider_id)
        except Provider.DoesNotExist:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Provider not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )
        provider.is_default = True
        provider.save()
        return Response({"provider": ProviderSerializer(provider).data})


class ProviderModelsView(APIView):
    """List models available on a specific provider."""

    permission_classes = [IsAuthenticated]

    _DOCKER_HOST_MAP = {
        ("localhost", 11434): "ollama",
        ("127.0.0.1", 11434): "ollama",
    }

    def _resolve_endpoint(self, endpoint: str) -> str:
        parsed = urlparse(endpoint)
        hostname = parsed.hostname or ""
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        docker_host = self._DOCKER_HOST_MAP.get((hostname, port))
        if docker_host:
            return f"{parsed.scheme}://{docker_host}:{port}"
        return endpoint

    def get(self, request, provider_id):
        try:
            provider = Provider.objects.get(pk=provider_id)
        except Provider.DoesNotExist:
            return Response(
                {"error": {"code": "NOT_FOUND", "message": "Provider not found."}},
                status=status.HTTP_404_NOT_FOUND,
            )

        endpoint = self._resolve_endpoint(provider.endpoint.rstrip("/"))

        if provider.type == "openai":
            url = f"{endpoint}/v1/models"
        else:
            url = f"{endpoint}/api/tags"

        try:
            resp = http_requests.get(url, timeout=5)
            resp.raise_for_status()
            data = resp.json()
        except Exception as e:
            return Response(
                {"models": [], "error": str(e)},
                status=status.HTTP_200_OK,
            )

        # Normalise into a flat list of {id, name, size?, ...}
        models = []
        if provider.type == "ollama":
            for m in data.get("models", []):
                models.append({
                    "id": m.get("name", ""),
                    "name": m.get("name", ""),
                    "size": m.get("size", 0),
                    "provider_id": str(provider.id),
                    "provider_name": provider.name,
                })
        else:
            for m in data.get("data", []):
                models.append({
                    "id": m.get("id", ""),
                    "name": m.get("id", ""),
                    "size": 0,
                    "provider_id": str(provider.id),
                    "provider_name": provider.name,
                })

        return Response({"models": models})


class ModelConfigView(APIView):
    """Get or update the feature → model mapping."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        config = ModelConfig.get_or_create_singleton()
        serializer = ModelConfigSerializer(config)
        return Response({"config": serializer.data})

    def patch(self, request):
        config = ModelConfig.get_or_create_singleton()
        serializer = ModelConfigSerializer(config, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"config": serializer.data})
