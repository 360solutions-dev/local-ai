from rest_framework import serializers

from .models import Notification, NotificationPreference


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ["model_download", "file_indexing", "system_errors"]


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "notification_type", "title", "message", "is_read", "created_at"]
        read_only_fields = ["id", "notification_type", "title", "message", "created_at"]
