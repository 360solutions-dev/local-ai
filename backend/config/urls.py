from django.contrib import admin
from django.urls import include, path

admin.site.site_header = "Local AI - Administration"
admin.site.site_title = "Local AI Admin"
admin.site.index_title = "Dashboard"

urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/auth/", include("accounts.urls")),
    path("api/notifications/", include("notifications.urls")),
    path("api/system/", include("system.urls")),
    path("api/chat/", include("chat.urls")),
]
