"""Security policy enforcement, path jailing, and secret sanitization."""

import fnmatch
import hmac
import os
import pathlib
import re

REDACTED = "***REDACTED***"

# Deny-list patterns and sensitive relative paths within the config jail
DENY_LIST_PATTERNS = [
    "secrets.yaml",
    "ip_bans.yaml",
    "*.pem",
    "*.key",
    "id_rsa*",
]

DENY_LIST_RELATIVE_PATHS = [
    ".storage/core.auth",
    ".storage/core.config_entries",
]

SENSITIVE_KEY_NAMES = [
    "api_key",
    "apikey",
    "access_token",
    "client_secret",
    "ha_key",
    "ha_token",
    "auth_token",
    "password",
    "passwd",
    "secret",
    "webhook_id",
    "private_key",
]

_SENSITIVE_KEYS_REGEX = "|".join(re.escape(k) for k in SENSITIVE_KEY_NAMES)

_URI_CREDENTIALS_RE = re.compile(
    r"([a-zA-Z][a-zA-Z0-9+.-]*://[^:\s/@]+:)([^@\s/]+)(@)",
    re.IGNORECASE,
)

_BEARER_TOKEN_RE = re.compile(
    r"(Bearer\s+)[^\s\"',;]+",
    re.IGNORECASE,
)

_QUOTED_KEY_VALUE_RE = re.compile(
    rf"""(?i)(["']?)\b({_SENSITIVE_KEYS_REGEX})\b\1(\s*[:=]\s*)(["'])(?:(?!\4).)*?\4"""
)

_UNQUOTED_KEY_VALUE_RE = re.compile(
    rf"""(?i)(["']?)\b({_SENSITIVE_KEYS_REGEX})\b\1(\s*[:=]\s*)([^\s\"',;&}}\]]+)"""
)


class SecurityException(Exception):
    """Raised when a path jail or security policy violation occurs."""
    pass


def is_protected_path(requested_path: str | None) -> bool:
    """Check whether a requested relative path matches hardcoded protected system deny lists."""
    if requested_path is None or "\0" in str(requested_path):
        return True

    clean_path = str(requested_path).replace("\\", "/").strip("/")
    pure = pathlib.PurePosixPath(clean_path)
    if ".." in pure.parts:
        return True

    rel_posix = pure.as_posix().lower()
    if rel_posix == "." or rel_posix == "":
        return False
    filename = pure.name.lower()

    for denied_rel in DENY_LIST_RELATIVE_PATHS:
        denied_norm = denied_rel.lower()
        if rel_posix == denied_norm or rel_posix.startswith(f"{denied_norm}/") or rel_posix.startswith(f"{denied_norm}."):
            return True

    for pattern in DENY_LIST_PATTERNS:
        if fnmatch.fnmatch(filename, pattern.lower()):
            return True

    return False


def verify_api_key(provided_key: str | None, expected_key: str | None) -> bool:
    """Verify an API key using constant-time comparison."""
    if not provided_key or not expected_key:
        return False
    return hmac.compare_digest(
        str(provided_key).encode("utf-8"),
        str(expected_key).encode("utf-8"),
    )


def sanitize_path(config_root: str, requested_path: str) -> str:
    """Validate requested file path against the configuration jail root and deny-list."""
    if not requested_path or not config_root:
        raise SecurityException("Path and config root must be non-empty strings")

    if "\0" in requested_path or "\0" in config_root:
        raise SecurityException("Path must not contain null bytes")

    canonical_root = os.path.realpath(os.path.abspath(config_root))
    candidate_path = (
        os.path.abspath(requested_path)
        if os.path.isabs(requested_path)
        else os.path.abspath(os.path.join(canonical_root, requested_path))
    )
    canonical_path = os.path.realpath(candidate_path)

    # 1. Enforce strict jail containment
    try:
        common = os.path.commonpath([canonical_root, canonical_path])
        if common != canonical_root:
            raise SecurityException(
                f"Path traversal detected: '{requested_path}' resolves outside '{config_root}'"
            )
    except ValueError:
        raise SecurityException(
            f"Path traversal detected: '{requested_path}' resides on a different drive"
        )

    # 2. Check deny-list patterns
    rel_path = os.path.relpath(canonical_path, canonical_root)
    rel_posix = pathlib.Path(rel_path).as_posix().lower()
    filename = os.path.basename(canonical_path).lower()

    for denied_rel in DENY_LIST_RELATIVE_PATHS:
        denied_norm = denied_rel.lower()
        if rel_posix == denied_norm or rel_posix.startswith(f"{denied_norm}/") or rel_posix.startswith(f"{denied_norm}."):
            raise SecurityException(f"Access denied: '{requested_path}' is a protected system file")

    for pattern in DENY_LIST_PATTERNS:
        if fnmatch.fnmatch(filename, pattern.lower()):
            raise SecurityException(f"Access denied: '{requested_path}' matches protected pattern '{pattern}'")

    return canonical_path


def sanitize_log_line(line: str) -> str:
    """Redact sensitive credential patterns from log strings."""
    if not line:
        return line

    sanitized = _URI_CREDENTIALS_RE.sub(rf"\g<1>{REDACTED}\g<3>", line)
    sanitized = _BEARER_TOKEN_RE.sub(rf"\g<1>{REDACTED}", sanitized)
    sanitized = _QUOTED_KEY_VALUE_RE.sub(rf"\g<1>\g<2>\g<1>\g<3>\g<4>{REDACTED}\g<4>", sanitized)
    sanitized = _UNQUOTED_KEY_VALUE_RE.sub(rf"\g<1>\g<2>\g<1>\g<3>{REDACTED}", sanitized)
    return sanitized
