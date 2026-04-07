import uuid

from django.db import models

from core.models import BaseModel


class InstanceSettings(BaseModel):
    """Singleton settings row — one per instance."""

    instance_id = models.CharField(max_length=50, unique=True)
    request_logging = models.BooleanField(default=True)
    debug_mode = models.BooleanField(default=False)

    class Meta:
        verbose_name = "Instance Settings"
        verbose_name_plural = "Instance Settings"

    def __str__(self):
        return f"InstanceSettings({self.instance_id})"

    @classmethod
    def load(cls):
        """Return the singleton instance, creating it if needed."""
        obj, _ = cls.objects.get_or_create(
            defaults={"instance_id": f"local-{uuid.uuid4().hex[:12]}"},
            pk=cls.objects.first().pk if cls.objects.exists() else None,
        )
        return obj

    @classmethod
    def get_or_create_singleton(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create(instance_id=f"local-{uuid.uuid4().hex[:12]}")
        return obj
