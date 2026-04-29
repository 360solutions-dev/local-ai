from rest_framework.permissions import BasePermission


class IsSetupIncomplete(BasePermission):
    """Only allow access when no users exist (during initial setup)."""

    message = "Setup is already complete."

    def has_permission(self, request, view):
        from accounts.models import User

        return not User.objects.exists()


class IsAdminUser(BasePermission):
    """Only allow access to staff/admin users."""

    message = "Admin privileges required."

    def has_permission(self, request, view):
        return request.user and request.user.is_authenticated and request.user.is_staff
