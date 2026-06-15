from rest_framework import serializers


class CreateConversationSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, allow_blank=True)


class RenameConversationSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)


class SendMessageSerializer(serializers.Serializer):
    content = serializers.CharField(max_length=50000)
    model = serializers.CharField(required=False, allow_blank=True)
    file_filter = serializers.CharField(required=False, allow_blank=True)
    turn_id = serializers.CharField(required=False, allow_blank=True, max_length=64)


class ConversationFileUploadSerializer(serializers.Serializer):
    """Validates the conversation_id form field sent with file uploads.

    File data itself is validated separately (size + emptiness) inside the
    view because DRF doesn't parse it into validated_data when it's a real
    multipart file.
    """
    conversation_id = serializers.IntegerField(min_value=1)
