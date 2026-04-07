from django.urls import path

from . import views

urlpatterns = [
    path("preferences/", views.NotificationPreferenceView.as_view()),
    path("mark-read/", views.NotificationMarkReadView.as_view()),
    path("", views.NotificationListView.as_view()),
]
