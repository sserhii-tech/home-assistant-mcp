"""Snapshot listing and rollback restore endpoints with RBAC enforcement and audit logging."""

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
from ...services.snapshot_service import SnapshotService
from ..schemas import BackupRestoreRequest, BackupRestoreResponse

router = APIRouter(tags=["Backups"])


@router.get("/backup/list", response_model=list[dict[str, Any]])
def list_backups(config_root: str = Depends(get_config_root)) -> list[dict[str, Any]]:
    """List all available file snapshots, ordered newest first."""
    return SnapshotService.list_snapshots(config_root)


@router.post("/backup/restore", response_model=BackupRestoreResponse)
def restore_backup(
    req: BackupRestoreRequest,
    principal: tuple[str, str] = Depends(get_current_principal),
    rationale: str = Depends(get_agent_rationale),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
    audit_service: AuditService = Depends(get_audit_service),
    config_root: str = Depends(get_config_root),
) -> dict[str, Any]:
    """Restore a file from a snapshot or rollback a created file."""
    agent_id, role = principal
    allowed, reason = policy_engine.check_tool_permission(role, "ha_system_restore_backup")
    if not allowed:
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="backup_restore",
                tool="ha_system_restore_backup",
                target=req.snapshot_id,
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
        res = SnapshotService.restore_snapshot(config_root, req.snapshot_id)
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="backup_restore",
                tool="ha_system_restore_backup",
                target=req.snapshot_id,
                status="allowed",
                reason="Allowed by policy",
                rationale=rationale,
                snapshot_id=req.snapshot_id,
            )
        )
        return res
    except SecurityException as err:
        audit_service.log_event(
            AuditEvent(
                agent_id=agent_id,
                role=role,
                action="backup_restore",
                tool="ha_system_restore_backup",
                target=req.snapshot_id,
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
            detail=f"Failed to restore snapshot: {err}",
        )

