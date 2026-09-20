"""FastAPI Application Factory for Home Assistant AI Helper Addon."""

from fastapi import FastAPI

from .api import api_v1
from .core.config import get_api_key, get_config_root, verify_token
from .core.security import (
    DENY_LIST_PATTERNS,
    DENY_LIST_RELATIVE_PATHS,
    REDACTED,
    SecurityException,
    sanitize_log_line,
    sanitize_path,
    verify_api_key,
)
from .services.snapshot_service import create_snapshot, list_snapshots, restore_snapshot


def create_app() -> FastAPI:
    """Create and configure the FastAPI application."""
    application = FastAPI(
        title="Home Assistant AI Helper Addon",
        description="Lightweight and secure AI agent companion for Home Assistant",
        version="0.5.1",
    )
    application.include_router(api_v1)
    return application


app = create_app()

__all__ = [
    "app",
    "create_app",
    "get_api_key",
    "get_config_root",
    "verify_token",
    "SecurityException",
    "sanitize_path",
    "sanitize_log_line",
    "verify_api_key",
    "create_snapshot",
    "list_snapshots",
    "restore_snapshot",
    "DENY_LIST_PATTERNS",
    "DENY_LIST_RELATIVE_PATHS",
    "REDACTED",
]
