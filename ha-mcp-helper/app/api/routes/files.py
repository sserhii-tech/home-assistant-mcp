"""File read and write endpoints with RBAC policy enforcement and audit logging."""

from typing import Any
from fastapi import APIRouter, Depends, HTTPException, status

from ...core.config import get_config_root
from ...core.dependencies import (
    get_agent_rationale,
    get_audit_service,
    get_current_principal,
    get_policy_engine,
)
from ...core.policy import PolicyEngine
from ...core.security import SecurityException
from ...services.audit_service import AuditEvent, AuditService
from ...services.file_service import FileService
from ..schemas import FileReadRequest, FileReadResponse, FileWriteRequest, FileWriteResponse

router = APIRouter(tags=["Files"])


@router.post("/file/read", response_model=FileReadResponse)
def read_file(
    req: FileReadRequest,
    principal: tuple[str, str] = Depends(get_current_principal),
    rationale: str = Depends(get_agent_rationale),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
    audit_service: AuditService = Depends(get_audit_service),
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Safely read file contents within configuration root."""
    agent_id, role = principal
    allowed, reason = policy_engine.check_path_permission(role, req.path, is_write=False)
    if not allowed:
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="file_read",
                tool="ha_file_read",
                target=req.path,
                status="denied_policy",
                reason=reason,
                rationale=rationale,
            )
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "ForbiddenByPolicy",
                "message": reason,
                "rule_violated": reason,
            },
        )

    try:
        res = FileService.read_file(config_root, req.path)
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="file_read",
                tool="ha_file_read",
                target=req.path,
                status="allowed",
                reason="Allowed by policy",
                rationale=rationale,
            )
        )
        return res
    except SecurityException as err:
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="file_read",
                tool="ha_file_read",
                target=req.path,
                status="denied_security",
                reason=str(err),
                rationale=rationale,
            )
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except FileNotFoundError as err:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to read file: {err}",
        )


@router.post("/file/write", response_model=FileWriteResponse)
def write_file(
    req: FileWriteRequest,
    principal: tuple[str, str] = Depends(get_current_principal),
    rationale: str = Depends(get_agent_rationale),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
    audit_service: AuditService = Depends(get_audit_service),
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Atomically write file with validation and automatic pre-edit snapshot."""
    agent_id, role = principal
    allowed, reason = policy_engine.check_path_permission(role, req.path, is_write=True)
    if not allowed:
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="file_write",
                tool="ha_file_write",
                target=req.path,
                status="denied_policy",
                reason=reason,
                rationale=rationale,
            )
        )
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "ForbiddenByPolicy",
                "message": reason,
                "rule_violated": reason,
            },
        )

    try:
        res = FileService.write_file(
            config_root=config_root,
            relative_path=req.path,
            content=req.content,
            validate_yaml=req.validate_yaml,
            label=rationale or req.label,
        )
        snapshot_id = res.get("snapshot_id", "")
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="file_write",
                tool="ha_file_write",
                target=req.path,
                status="allowed",
                reason="Allowed by policy",
                rationale=rationale,
                snapshot_id=snapshot_id,
            )
        )
        return res
    except ValueError as err:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(err))
    except SecurityException as err:
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="file_write",
                tool="ha_file_write",
                target=req.path,
                status="denied_security",
                reason=str(err),
                rationale=rationale,
            )
        )
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=str(err))
    except Exception as err:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to write file: {err}",
        )

