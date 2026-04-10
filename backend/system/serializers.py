from rest_framework import serializers

from .models import InstanceSettings, ModelConfig, Provider


class InstanceSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstanceSettings
        fields = ["request_logging", "debug_mode", "max_file_size_mb", "max_files_per_chat"]


class ProviderSerializer(serializers.ModelSerializer):
    class Meta:
        model = Provider
        fields = [
            "id",
            "name",
            "icon",
            "description",
            "endpoint",
            "type",
            "is_default",
            "is_connected",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "created_at", "updated_at"]


class ModelConfigSerializer(serializers.ModelSerializer):
    class Meta:
        model = ModelConfig
        fields = [
            "chat_model",
            "embedding_model",
            "tts_model",
            "summarizer_model",
        ]
