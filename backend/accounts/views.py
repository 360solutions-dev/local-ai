import os

from django.contrib.auth import authenticate
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from core.exceptions import SetupAlreadyComplete
from system.models import Provider

from django.utils import timezone as dj_timezone

from .models import User
from .recovery import (
    assign_new_recovery_code,
    decode_reset_token,
    issue_reset_token,
    verify_recovery_code,
)
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
    RecoveryVerifySerializer,
    RegisterSerializer,
    ResetPasswordSerializer,
    UserReadSerializer,
    UserUpdateSerializer,
)


import os

_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "false").lower() == "true"


def _set_auth_cookies(response, user):
    """Generate JWT pair and set as httpOnly cookies on the response."""
    refresh = RefreshToken.for_user(user)
    response.set_cookie(
        "access_token",
        str(refresh.access_token),
        httponly=True,
        samesite="Lax",
        secure=_COOKIE_SECURE,
        max_age=3600,
        path="/",
    )
    response.set_cookie(
        "refresh_token",
        str(refresh),
        httponly=True,
        samesite="Lax",
        secure=_COOKIE_SECURE,
        max_age=7 * 24 * 3600,
        path="/api/auth/",
    )
    return response


class SetupStatusView(APIView):
    permission_classes = [AllowAny]

    def get(self, request):
        return Response({"is_setup_complete": User.objects.exists()})


class RegisterView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        if User.objects.exists():
            raise SetupAlreadyComplete()

        serializer = RegisterSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = User.objects.create_user(
            username=serializer.validated_data["email"],
            email=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
            display_name=serializer.validated_data["display_name"],
            is_staff=True,
            is_superuser=True,
        )

        # Ensure default Ollama provider exists (may be missing after factory reset)
        from urllib.parse import urlparse
        import requests as http_requests

        ollama_provider = Provider.objects.filter(type="ollama").first()
        if not ollama_provider:
            ollama_provider = Provider.objects.create(
                name="Ollama",
                icon="\U0001F9E0",
                description="Local model inference with Ollama. Runs on your machine with full privacy.",
                endpoint=os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434"),
                type="ollama",
                is_default=True,
                is_connected=False,
            )

        # Auto-connect Ollama on registration so the user doesn't have to
        # manually click "Connect" in the UI (matches Whisper's UX).
        try:
            endpoint = ollama_provider.endpoint.rstrip("/")
            parsed = urlparse(endpoint)
            hostname = parsed.hostname or ""
            port = parsed.port or 80
            docker_map = {("localhost", 11434): "ollama", ("127.0.0.1", 11434): "ollama"}
            docker_host = docker_map.get((hostname, port))
            if docker_host:
                endpoint = f"{parsed.scheme}://{docker_host}:{port}"
            resp = http_requests.get(f"{endpoint}/api/tags", timeout=3)
            resp.raise_for_status()
            if not ollama_provider.is_connected:
                ollama_provider.is_connected = True
                ollama_provider.save(update_fields=["is_connected"])
        except Exception:
            if ollama_provider.is_connected:
                ollama_provider.is_connected = False
                ollama_provider.save(update_fields=["is_connected"])

        recovery_code = assign_new_recovery_code(user)

        response = Response(
            {
                "message": "Admin account created successfully.",
                "user": UserReadSerializer(user).data,
                "recovery_code": recovery_code,
            },
            status=status.HTTP_201_CREATED,
        )
        return _set_auth_cookies(response, user)


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = authenticate(
            request,
            username=serializer.validated_data["email"],
            password=serializer.validated_data["password"],
        )

        if user is None:
            return Response(
                {"error": {"code": "UNAUTHORIZED", "message": "Invalid email or password."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        response = Response({"user": UserReadSerializer(user).data})
        return _set_auth_cookies(response, user)


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        response = Response({"message": "Logged out successfully."})
        response.delete_cookie("access_token", path="/")
        response.delete_cookie("refresh_token", path="/api/auth/")
        return response


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"user": UserReadSerializer(request.user).data})

    def patch(self, request):
        serializer = UserUpdateSerializer(request.user, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response({"user": UserReadSerializer(request.user).data})


class TokenRefreshView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        raw_refresh = request.COOKIES.get("refresh_token")
        if not raw_refresh:
            return Response(
                {"error": {"code": "UNAUTHORIZED", "message": "No refresh token provided."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        try:
            refresh = RefreshToken(raw_refresh)
            user = User.objects.get(id=refresh["user_id"])
        except Exception:
            return Response(
                {"error": {"code": "UNAUTHORIZED", "message": "Invalid or expired refresh token."}},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        response = Response({"message": "Token refreshed."})
        return _set_auth_cookies(response, user)


class ChangePasswordView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = ChangePasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user = request.user
        if not user.check_password(serializer.validated_data["current_password"]):
            return Response(
                {"error": {"code": "UNAUTHORIZED", "message": "Current password is incorrect."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(serializer.validated_data["new_password"])
        user.save()

        # Re-issue tokens so the user stays logged in
        response = Response({"message": "Password updated successfully."})
        return _set_auth_cookies(response, user)


class RecoveryVerifyView(APIView):
    """Step 1 of the forgot-password flow: trade a recovery code for a short-lived reset token."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = RecoveryVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"].lower()
        code = serializer.validated_data["recovery_code"]

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            return Response(
                {"error": {"code": "INVALID_RECOVERY", "message": "Invalid email or recovery code."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not user.recovery_code_hash or user.recovery_code_used_at is not None:
            return Response(
                {"error": {"code": "INVALID_RECOVERY", "message": "Invalid email or recovery code."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not verify_recovery_code(code, user.recovery_code_hash):
            return Response(
                {"error": {"code": "INVALID_RECOVERY", "message": "Invalid email or recovery code."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        token = issue_reset_token(user)
        return Response({"reset_token": token})


class ResetPasswordView(APIView):
    """Step 2 of the forgot-password flow: set a new password using the short-lived reset token."""

    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        user_id = decode_reset_token(serializer.validated_data["token"])
        if user_id is None:
            return Response(
                {"error": {"code": "INVALID_TOKEN", "message": "Invalid or expired reset token. Start over from the Forgot Password screen."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            user = User.objects.get(id=user_id)
        except User.DoesNotExist:
            return Response(
                {"error": {"code": "INVALID_TOKEN", "message": "Invalid or expired reset token."}},
                status=status.HTTP_400_BAD_REQUEST,
            )

        user.set_password(serializer.validated_data["new_password"])
        user.recovery_code_used_at = dj_timezone.now()
        user.save(update_fields=["password", "recovery_code_used_at"])

        new_code = assign_new_recovery_code(user)

        response = Response(
            {
                "message": "Password updated successfully.",
                "recovery_code": new_code,
            }
        )
        return _set_auth_cookies(response, user)


class RegenerateRecoveryCodeView(APIView):
    """Authenticated: rotate the recovery code from Settings → Security."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        new_code = assign_new_recovery_code(request.user)
        return Response({"recovery_code": new_code})
