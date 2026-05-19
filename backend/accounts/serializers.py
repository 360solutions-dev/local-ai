from rest_framework import serializers

from notifications.models import NotificationPreference

from .models import User


class RegisterSerializer(serializers.Serializer):
    display_name = serializers.CharField(max_length=150)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)

    def validate_email(self, value):
        if User.objects.filter(email=value).exists():
            raise serializers.ValidationError("A user with this email already exists.")
        return value.lower()


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)


class NotificationPreferenceSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationPreference
        fields = ["model_download", "file_indexing", "system_errors"]


class UserReadSerializer(serializers.ModelSerializer):
    notification_preferences = serializers.SerializerMethodField()
    has_recovery_code = serializers.SerializerMethodField()

    class Meta:
        model = User
        fields = ["id", "email", "display_name", "is_staff", "date_joined", "notification_preferences", "has_recovery_code"]
        read_only_fields = fields

    def get_notification_preferences(self, user):
        prefs, _ = NotificationPreference.objects.get_or_create(user=user)
        return NotificationPreferenceSerializer(prefs).data

    def get_has_recovery_code(self, user) -> bool:
        return bool(user.recovery_code_hash) and user.recovery_code_used_at is None


class UserUpdateSerializer(serializers.ModelSerializer):
    notification_preferences = NotificationPreferenceSerializer(required=False)

    class Meta:
        model = User
        fields = ["display_name", "notification_preferences"]

    def update(self, instance, validated_data):
        notif_data = validated_data.pop("notification_preferences", None)
        instance = super().update(instance, validated_data)
        if notif_data is not None:
            prefs, _ = NotificationPreference.objects.get_or_create(user=instance)
            for key, value in notif_data.items():
                setattr(prefs, key, value)
            prefs.save()
        return instance


class ChangePasswordSerializer(serializers.Serializer):
    current_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(min_length=8, write_only=True)


class ResetPasswordSerializer(serializers.Serializer):
    token = serializers.CharField()
    new_password = serializers.CharField(min_length=8, write_only=True)


class RecoveryVerifySerializer(serializers.Serializer):
    email = serializers.EmailField()
    recovery_code = serializers.CharField()
