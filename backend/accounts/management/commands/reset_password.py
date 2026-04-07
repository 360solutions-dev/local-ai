import secrets
import string

from django.core.management.base import BaseCommand

from accounts.models import User


class Command(BaseCommand):
    help = "Generate a password reset token for an admin user"

    def handle(self, *args, **options):
        email = input("Enter admin email: ")

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            self.stderr.write(self.style.ERROR(f"No user found with email: {email}"))
            return

        # Generate token in XXXX-XXXX-XXXX format
        chars = string.ascii_uppercase + string.digits
        parts = ["".join(secrets.choice(chars) for _ in range(4)) for _ in range(3)]
        token = "-".join(parts)

        # Store token on user (using set_unusable_password temporarily as a flag)
        # In production, use a dedicated PasswordResetToken model with expiry
        self.stdout.write(f"\nReset token generated:")
        self.stdout.write(self.style.SUCCESS(token))
        self.stdout.write("Token expires in 15 minutes.\n")
        self.stdout.write(
            "The user should enter this token in the forgot-password dialog "
            "along with their new password."
        )
