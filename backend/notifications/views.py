import uuid

from django.db.models import Count, Q
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .models import Notification, NotificationPreference
from .serializers import NotificationPreferenceSerializer, NotificationSerializer


class NotificationPreferenceView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(prefs)
        return Response({"preferences": serializer.data})

    def patch(self, request):
        prefs, _ = NotificationPreference.objects.get_or_create(user=request.user)
        serializer = NotificationPreferenceSerializer(prefs, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"preferences": serializer.data})


class NotificationListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        qs = Notification.objects.filter(user=request.user)
        if request.query_params.get("unread_only") == "true":
            qs = qs.filter(is_read=False)
        notifications = list(qs[:50])
        unread_count = Notification.objects.filter(
            user=request.user, is_read=False
        ).only("id").count()
        # If we already filtered to unread, we know the count from the list
        if request.query_params.get("unread_only") == "true":
            unread_count = len(notifications)
        serializer = NotificationSerializer(notifications, many=True)
        return Response({
            "notifications": serializer.data,
            "unread_count": unread_count,
        })


class NotificationMarkReadView(APIView):
    permission_classes = [IsAuthenticated]

    def patch(self, request):
        if request.data.get("all"):
            updated = Notification.objects.filter(
                user=request.user, is_read=False
            ).update(is_read=True)
        else:
            notification_ids = request.data.get("notification_ids", [])
            # Validate notification_ids is a list
            if not isinstance(notification_ids, list):
                return Response(
                    {"error": "notification_ids must be a list"},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            # Validate each ID is a valid UUID
            validated_ids = []
            for nid in notification_ids:
                try:
                    validated_ids.append(uuid.UUID(str(nid)))
                except (ValueError, AttributeError):
                    return Response(
                        {"error": f"Invalid UUID: {nid}"},
                        status=status.HTTP_400_BAD_REQUEST,
                    )
            updated = Notification.objects.filter(
                user=request.user, id__in=validated_ids, is_read=False
            ).update(is_read=True)
        return Response({"updated_count": updated})
