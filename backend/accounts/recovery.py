"""Helpers for the recovery-code based password reset flow.

Generated at signup, single-use, hashed with Django's password hasher (PBKDF2),
so a database leak does not expose the codes. Format is `XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`
(24 alphanumeric chars in groups of 4, ambiguous characters removed).
"""

from __future__ import annotations

import secrets
from datetime import datetime, timedelta, timezone

import jwt
from django.conf import settings
from django.contrib.auth.hashers import check_password, make_password
from django.utils import timezone as dj_timezone


_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # Excludes I, O, 0, 1 — visually ambiguous
_CODE_GROUPS = 6
_CODE_GROUP_SIZE = 4
_RESET_TOKEN_TTL_MINUTES = 10
_RESET_TOKEN_PURPOSE = "password_reset"


def generate_recovery_code() -> str:
    """Return a fresh recovery code shown to the user only once."""
    groups = []
    for _ in range(_CODE_GROUPS):
        group = "".join(secrets.choice(_CODE_ALPHABET) for _ in range(_CODE_GROUP_SIZE))
        groups.append(group)
    return "-".join(groups)


def normalize_recovery_code(raw: str) -> str:
    """Strip whitespace + dashes and uppercase so users can paste sloppily."""
    return "".join(ch for ch in (raw or "").upper() if ch in _CODE_ALPHABET)


def hash_recovery_code(code: str) -> str:
    """Hash a recovery code for at-rest storage."""
    return make_password(normalize_recovery_code(code))


def verify_recovery_code(raw_code: str, stored_hash: str) -> bool:
    """Check a user-supplied recovery code against the stored hash."""
    if not raw_code or not stored_hash:
        return False
    return check_password(normalize_recovery_code(raw_code), stored_hash)


def assign_new_recovery_code(user) -> str:
    """Generate, store the hash, and return the plaintext code for one-time display."""
    code = generate_recovery_code()
    user.recovery_code_hash = hash_recovery_code(code)
    user.recovery_code_created_at = dj_timezone.now()
    user.recovery_code_used_at = None
    user.save(
        update_fields=[
            "recovery_code_hash",
            "recovery_code_created_at",
            "recovery_code_used_at",
        ]
    )
    return code


def issue_reset_token(user) -> str:
    """Short-lived JWT used to authorize a password reset after recovery-code verification."""
    now = datetime.now(timezone.utc)
    payload = {
        "user_id": user.id,
        "purpose": _RESET_TOKEN_PURPOSE,
        "iat": int(now.timestamp()),
        "exp": int((now + timedelta(minutes=_RESET_TOKEN_TTL_MINUTES)).timestamp()),
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm="HS256")


def decode_reset_token(token: str) -> int | None:
    """Return user_id from a valid reset token, or None if invalid/expired."""
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=["HS256"])
    except jwt.PyJWTError:
        return None
    if payload.get("purpose") != _RESET_TOKEN_PURPOSE:
        return None
    user_id = payload.get("user_id")
    return user_id if isinstance(user_id, int) else None
