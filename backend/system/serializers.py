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
    chat_provider_id = serializers.UUIDField(required=False, allow_null=True)
    embedding_provider_id = serializers.UUIDField(required=False, allow_null=True)
    tts_provider_id = serializers.UUIDField(required=False, allow_null=True)

    # Read-only: provider name + endpoint for the frontend
    chat_provider_name = serializers.CharField(
        source="chat_provider.name", read_only=True, default=""
    )
    embedding_provider_name = serializers.CharField(
        source="embedding_provider.name", read_only=True, default=""
    )
    tts_provider_name = serializers.CharField(
        source="tts_provider.name", read_only=True, default=""
    )

    class Meta:
        model = ModelConfig
        fields = [
            "chat_model",
            "chat_provider_id",
            "chat_provider_name",
            "embedding_model",
            "embedding_provider_id",
            "embedding_provider_name",
            "tts_model",
            "tts_provider_id",
            "tts_provider_name",
            "summarizer_model",
        ]
