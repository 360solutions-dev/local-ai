from rest_framework.views import exception_handler
from rest_framework.exceptions import APIException


# Error codes
VALIDATION_ERROR = "VALIDATION_ERROR"
NOT_FOUND = "NOT_FOUND"
UNAUTHORIZED = "UNAUTHORIZED"
FORBIDDEN = "FORBIDDEN"
CONFLICT = "CONFLICT"
SETUP_ALREADY_COMPLETE = "SETUP_ALREADY_COMPLETE"


def custom_exception_handler(exc, context):
    response = exception_handler(exc, context)

    if response is not None:
        code = getattr(exc, "default_code", "ERROR")
        message = str(exc.detail) if hasattr(exc, "detail") else str(exc)

        # Handle DRF's structured error details
        details = None
        if isinstance(exc.detail, dict):
            details = exc.detail
            message = "Validation failed."
        elif isinstance(exc.detail, list):
            message = exc.detail[0] if exc.detail else "An error occurred."

        error_body = {
            "code": code.upper() if isinstance(code, str) else "ERROR",
            "message": message,
        }
        if details:
            error_body["details"] = details

        response.data = {"error": error_body}

    return response


class SetupAlreadyComplete(APIException):
    status_code = 403
    default_detail = "Setup is already complete. Registration is disabled."
    default_code = SETUP_ALREADY_COMPLETE
