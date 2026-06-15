from datetime import datetime, timezone as dt_timezone

from django.apps import AppConfig


class SystemConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "system"

    def ready(self):
        from django.conf import settings

        if not hasattr(settings, "PROCESS_START_TIME"):
            settings.PROCESS_START_TIME = datetime.now(dt_timezone.utc)
