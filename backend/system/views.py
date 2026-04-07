import io
import json
import zipfile
from datetime import datetime, timezone

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.serializers import UserReadSerializer
from notifications.models import Notification, NotificationPreference

from .models import InstanceSettings
from .rag_queries import delete_all_chat_data, get_all_chat_data, get_query_history
from .serializers import InstanceSettingsSerializer


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
    permission_classes = [IsAuthenticated]

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
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.data.get("confirm"):
            return Response(
                {"error": {"code": "CONFIRMATION_REQUIRED", "message": "Confirm deletion."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        delete_all_chat_data()

        Notification.objects.filter(user=request.user).delete()

        instance = InstanceSettings.get_or_create_singleton()
        instance.request_logging = True
        instance.debug_mode = False
        instance.save()

        return Response({"message": "All data deleted."})


class FactoryResetView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        if not request.data.get("confirm"):
            return Response(
                {"error": {"code": "CONFIRMATION_REQUIRED", "message": "Confirm factory reset."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        delete_all_chat_data()

        Notification.objects.filter(user=request.user).delete()
        NotificationPreference.objects.filter(user=request.user).delete()
        InstanceSettings.objects.all().delete()

        user = request.user
        user.delete()

        response = Response({"message": "Factory reset complete."})
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/api/auth/token/refresh/")
        return response
