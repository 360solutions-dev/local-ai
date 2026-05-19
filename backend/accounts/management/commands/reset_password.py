import getpass

from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from accounts.recovery import assign_new_recovery_code


class Command(BaseCommand):
    help = (
        "Reset an admin user's password from the terminal (offline fallback for "
        "when the in-app recovery code is unavailable). Also rotates the recovery "
        "code so the new one is shown."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--email",
            help="Admin email. Prompted if omitted.",
        )
        parser.add_argument(
            "--password",
            help=(
                "New password. Prompted (without echo) if omitted. Passing on the "
                "command line is convenient for scripts but leaves the password in "
                "shell history."
            ),
        )

    def handle(self, *args, **options):
        email = (options.get("email") or input("Admin email: ")).strip().lower()
        if not email:
            raise CommandError("Email is required.")

        try:
            user = User.objects.get(email=email)
        except User.DoesNotExist:
            raise CommandError(f"No user found with email: {email}")

        password = options.get("password")
        if not password:
            password = getpass.getpass("New password (min 8 chars): ")
            confirm = getpass.getpass("Confirm new password: ")
            if password != confirm:
                raise CommandError("Passwords did not match.")

        if len(password) < 8:
            raise CommandError("Password must be at least 8 characters.")

        user.set_password(password)
        user.save(update_fields=["password"])

        new_code = assign_new_recovery_code(user)

        self.stdout.write(self.style.SUCCESS(f"Password updated for {email}."))
        self.stdout.write("")
        self.stdout.write("A NEW recovery code has been generated. Save it now —")
        self.stdout.write("it will not be shown again:")
        self.stdout.write("")
        self.stdout.write(self.style.SUCCESS(f"    {new_code}"))
        self.stdout.write("")
        self.stdout.write(
            "Use this code on the Forgot Password screen if you lose access again."
        )
