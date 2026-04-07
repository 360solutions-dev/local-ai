from django.apps import AppConfig
from django.utils import timezone


class SystemConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "system"

    def ready(self):
        from django.conf import settings

        if not hasattr(settings, "PROCESS_START_TIME"):
            settings.PROCESS_START_TIME = timezone.now()
