from django.test import TestCase
from rest_framework.test import APIClient

from accounts.models import User


class SetupStatusTests(TestCase):
    def test_returns_false_when_no_users(self):
        client = APIClient()
        response = client.get("/api/auth/setup-status/")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(response.data["is_setup_complete"])

    def test_returns_true_when_user_exists(self):
        User.objects.create_user(
            username="admin@test.com", email="admin@test.com", password="testpass123"
        )
        client = APIClient()
        response = client.get("/api/auth/setup-status/")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.data["is_setup_complete"])


class RegisterTests(TestCase):
    def test_register_first_user_succeeds(self):
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {"display_name": "Admin", "email": "admin@test.com", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(User.objects.count(), 1)
        self.assertIn("access_token", response.cookies)

    def test_register_blocked_when_user_exists(self):
        User.objects.create_user(
            username="admin@test.com", email="admin@test.com", password="testpass123"
        )
        client = APIClient()
        response = client.post(
            "/api/auth/register/",
            {"display_name": "Another", "email": "other@test.com", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 403)


class LoginTests(TestCase):
    def setUp(self):
        self.user = User.objects.create_user(
            username="admin@test.com",
            email="admin@test.com",
            password="testpass123",
            display_name="Admin",
        )

    def test_login_success(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"email": "admin@test.com", "password": "testpass123"},
            format="json",
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn("access_token", response.cookies)

    def test_login_wrong_password(self):
        client = APIClient()
        response = client.post(
            "/api/auth/login/",
            {"email": "admin@test.com", "password": "wrongpass"},
            format="json",
        )
        self.assertEqual(response.status_code, 401)


class MeTests(TestCase):
    def test_me_unauthenticated(self):
        client = APIClient()
        response = client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 401)

    def test_me_authenticated(self):
        user = User.objects.create_user(
            username="admin@test.com",
            email="admin@test.com",
            password="testpass123",
            display_name="Admin",
        )
        client = APIClient()
        # Login to get cookie
        login_response = client.post(
            "/api/auth/login/",
            {"email": "admin@test.com", "password": "testpass123"},
            format="json",
        )
        # Set the cookie on subsequent request
        client.cookies = login_response.cookies
        response = client.get("/api/auth/me/")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["user"]["email"], "admin@test.com")
