import os

from django.contrib.auth import authenticate
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.tokens import RefreshToken

from core.exceptions import SetupAlreadyComplete
from system.models import Provider

from .models import User
from .serializers import (
    ChangePasswordSerializer,
    LoginSerializer,
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
        if not Provider.objects.filter(type="ollama").exists():
            from urllib.parse import urlparse
            import requests as http_requests

            ollama_provider = Provider.objects.create(
                name="Ollama",
                icon="\U0001F9E0",
                description="Local model inference with Ollama. Runs on your machine with full privacy.",
                endpoint=os.environ.get("OLLAMA_BASE_URL", "http://ollama:11434"),
                type="ollama",
                is_default=True,
                is_connected=False,
            )
            # Check if Ollama service is reachable
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
                ollama_provider.is_connected = True
                ollama_provider.save(update_fields=["is_connected"])
            except Exception:
                pass

        response = Response(
            {
                "message": "Admin account created successfully.",
                "user": UserReadSerializer(user).data,
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


class ResetPasswordView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = ResetPasswordSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        # TODO: Validate token from PasswordResetToken model
        # For now, this is a placeholder that will be completed
        # when the reset_password management command is implemented
        return Response(
            {"error": {"code": "NOT_FOUND", "message": "Invalid or expired reset token."}},
            status=status.HTTP_400_BAD_REQUEST,
        )
