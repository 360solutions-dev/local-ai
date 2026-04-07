from .models import Notification, NotificationPreference


def create_notification(user, notification_type, title, message=""):
    """Create a notification, respecting user preferences."""
    prefs, _ = NotificationPreference.objects.get_or_create(user=user)
    pref_map = {
        "model_download": prefs.model_download,
        "file_indexing": prefs.file_indexing,
        "system_error": prefs.system_errors,
    }
    if not pref_map.get(notification_type, True):
        return None
    return Notification.objects.create(
        user=user,
        notification_type=notification_type,
        title=title,
        message=message,
    )
