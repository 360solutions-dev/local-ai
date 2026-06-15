from django.conf import settings
from django.db import models

from core.models import BaseModel


class NotificationPreference(BaseModel):
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notification_preferences",
    )
    model_download = models.BooleanField(default=True)
    file_indexing = models.BooleanField(default=True)
    system_errors = models.BooleanField(default=True)

    def __str__(self):
        return f"NotificationPreference({self.user})"


class Notification(BaseModel):
    class Type(models.TextChoices):
        MODEL_DOWNLOAD = "model_download", "Model Download"
        FILE_INDEXING = "file_indexing", "File Indexing"
        SYSTEM_ERROR = "system_error", "System Error"

    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="notifications",
    )
    notification_type = models.CharField(max_length=30, choices=Type.choices)
    title = models.CharField(max_length=255)
    message = models.TextField(blank=True, default="")
    is_read = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["user", "is_read", "-created_at"]),
        ]

    def __str__(self):
        return f"Notification({self.notification_type}: {self.title})"
