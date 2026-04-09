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


class Provider(BaseModel):
    """A configured inference provider (Ollama, LM Studio, vLLM, etc.)."""

    PROVIDER_TYPES = [
        ("ollama", "Ollama"),
        ("openai", "OpenAI-compatible"),
    ]

    name = models.CharField(max_length=100)
    icon = models.CharField(max_length=10, default="🌐")
    description = models.TextField(blank=True, default="")
    endpoint = models.CharField(max_length=500)
    type = models.CharField(max_length=20, choices=PROVIDER_TYPES, default="ollama")
    is_default = models.BooleanField(default=False)
    is_connected = models.BooleanField(default=False)

    class Meta:
        ordering = ["-is_default", "-created_at"]

    def __str__(self):
        return f"{self.name} ({self.endpoint})"

    def save(self, *args, **kwargs):
        if self.is_default:
            Provider.objects.filter(is_default=True).exclude(pk=self.pk).update(
                is_default=False
            )
        super().save(*args, **kwargs)


class ModelConfig(BaseModel):
    """Singleton — persists which model is assigned to each feature."""

    chat_model = models.CharField(max_length=200, blank=True, default="")
    embedding_model = models.CharField(max_length=200, blank=True, default="")
    tts_model = models.CharField(max_length=200, blank=True, default="")
    summarizer_model = models.CharField(max_length=200, blank=True, default="")

    class Meta:
        verbose_name = "Model Configuration"
        verbose_name_plural = "Model Configuration"

    def __str__(self):
        return "ModelConfig"

    @classmethod
    def get_or_create_singleton(cls):
        obj = cls.objects.first()
        if obj is None:
            obj = cls.objects.create()
        return obj
