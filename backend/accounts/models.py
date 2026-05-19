from django.contrib.auth.models import AbstractUser
from django.db import models


class User(AbstractUser):
    display_name = models.CharField(max_length=150, blank=True)
    email = models.EmailField(unique=True)

    recovery_code_hash = models.CharField(max_length=128, blank=True, null=True)
    recovery_code_created_at = models.DateTimeField(blank=True, null=True)
    recovery_code_used_at = models.DateTimeField(blank=True, null=True)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = ["username", "display_name"]

    class Meta:
        db_table = "accounts_user"
        verbose_name = "user"
        verbose_name_plural = "users"

    def __str__(self):
        return self.display_name or self.email
