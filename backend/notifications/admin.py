from django.contrib import admin

from .models import Notification, NotificationPreference

admin.site.register(NotificationPreference)
admin.site.register(Notification)
