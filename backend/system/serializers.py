from rest_framework import serializers

from .models import InstanceSettings


class InstanceSettingsSerializer(serializers.ModelSerializer):
    class Meta:
        model = InstanceSettings
        fields = ["request_logging", "debug_mode"]
