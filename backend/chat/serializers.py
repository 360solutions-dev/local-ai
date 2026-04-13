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
