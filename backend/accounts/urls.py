from django.urls import path

from . import views

urlpatterns = [
    path("setup-status/", views.SetupStatusView.as_view(), name="accounts-setup-status"),
    path("register/", views.RegisterView.as_view(), name="accounts-register"),
    path("login/", views.LoginView.as_view(), name="accounts-login"),
    path("logout/", views.LogoutView.as_view(), name="accounts-logout"),
    path("me/", views.MeView.as_view(), name="accounts-me"),
    path("token/refresh/", views.TokenRefreshView.as_view(), name="accounts-token-refresh"),
    path("change-password/", views.ChangePasswordView.as_view(), name="accounts-change-password"),
    path("reset-password/", views.ResetPasswordView.as_view(), name="accounts-reset-password"),
]
