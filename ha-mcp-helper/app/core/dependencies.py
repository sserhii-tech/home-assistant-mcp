"""FastAPI dependency injection providers for policies, audit logging, and principal auth."""

import functools
from pathlib import Path
from fastapi import Depends, Header, HTTPException, status

from .config import get_api_key, get_config_root
from .policy import PolicyEngine
from ..services.audit_service import AuditService


@functools.lru_cache(maxsize=4)
def _get_cached_policy_engine(config_root: str, master_key: str) -> PolicyEngine:
    return PolicyEngine(config_dir=config_root, master_api_key=master_key)


@functools.lru_cache(maxsize=4)
def _get_cached_audit_service(config_root: str) -> AuditService:
    return AuditService(audit_dir=Path(config_root) / ".audit")


def get_policy_engine(config_root: str = Depends(get_config_root)) -> PolicyEngine:
    return _get_cached_policy_engine(config_root, get_api_key())


def get_audit_service(config_root: str = Depends(get_config_root)) -> AuditService:
    return _get_cached_audit_service(config_root)


def get_current_principal(
    x_addon_api_key: str | None = Header(default=None, alias="X-Addon-API-Key"),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
) -> tuple[str, str]:
    if not x_addon_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Addon-API-Key header",
        )
    agent_id, role = policy_engine.resolve_principal(x_addon_api_key)
    if not agent_id or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired API token",
        )
    return (agent_id, role)


def get_agent_rationale(
    x_agent_rationale: str | None = Header(default="", alias="X-Agent-Rationale"),
) -> str:
    return x_agent_rationale or ""
