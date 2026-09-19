"""Security module re-exports for backward compatibility."""

try:
    from .core.security import (
        DENY_LIST_PATTERNS,
        DENY_LIST_RELATIVE_PATHS,
        REDACTED,
        SENSITIVE_KEY_NAMES,
        SecurityException,
        is_protected_path,
        sanitize_log_line,
        sanitize_path,
        verify_api_key,
    )
except (ImportError, ValueError):
    try:
        from app.core.security import (
            DENY_LIST_PATTERNS,
            DENY_LIST_RELATIVE_PATHS,
            REDACTED,
            SENSITIVE_KEY_NAMES,
            SecurityException,
            is_protected_path,
            sanitize_log_line,
            sanitize_path,
            verify_api_key,
        )
    except (ImportError, ValueError):
        from core.security import (
            DENY_LIST_PATTERNS,
            DENY_LIST_RELATIVE_PATHS,
            REDACTED,
            SENSITIVE_KEY_NAMES,
            SecurityException,
            is_protected_path,
            sanitize_log_line,
            sanitize_path,
            verify_api_key,
        )

__all__ = [
    "DENY_LIST_PATTERNS",
    "DENY_LIST_RELATIVE_PATHS",
    "REDACTED",
    "SENSITIVE_KEY_NAMES",
    "SecurityException",
    "is_protected_path",
    "sanitize_log_line",
    "sanitize_path",
    "verify_api_key",
]
