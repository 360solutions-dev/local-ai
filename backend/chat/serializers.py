from rest_framework import serializers


class CreateConversationSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255, required=False, allow_blank=True)


class RenameConversationSerializer(serializers.Serializer):
    title = serializers.CharField(max_length=255)


class SendMessageSerializer(serializers.Serializer):
    content = serializers.CharField()
    model = serializers.CharField(required=False, allow_blank=True)
    file_filter = serializers.CharField(required=False, allow_blank=True)
