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

        # 4. PostgreSQL — only chat-related tables
        try:
            from django.db import connection as db_conn

            with db_conn.cursor() as cursor:
                # Only report size if there are actual rows, otherwise
                # empty tables still consume ~72 KB of PostgreSQL overhead.
                cursor.execute("""
                    SELECT COALESCE(SUM(cnt), 0) FROM (
                        SELECT count(*) AS cnt FROM messages
                        UNION ALL
                        SELECT count(*) FROM conversations
                        UNION ALL
                        SELECT count(*) FROM query_history
                    ) t
                """)
                row_count = cursor.fetchone()[0]
                if row_count > 0:
                    cursor.execute("""
                        SELECT COALESCE(SUM(pg_total_relation_size(c.oid)), 0)
                        FROM pg_class c
                        JOIN pg_namespace n ON n.oid = c.relnamespace
                        WHERE n.nspname = 'public'
                          AND c.relkind = 'r'
                          AND c.relname IN ('messages', 'conversations', 'query_history')
                    """)
                    breakdown["chat_history"] = cursor.fetchone()[0]
        except Exception as e:
            logger.warning("Failed to fetch chat history size: %s", e)

        total_used = sum(breakdown.values())

        return Response(
            {
                "disk": {
                    "total": disk_total,
                    "used": disk_used,
                    "free": disk_free,
                },
                "breakdown": breakdown,
                "total_tracked": total_used,
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
