"""Audit log query endpoints."""

from fastapi import APIRouter, Depends, HTTPException, Query, status

from ...core.dependencies import (
    get_agent_rationale,
    get_audit_service,
    get_current_principal,
    get_policy_engine,
)
from ...core.policy import PolicyEngine
from ...services.audit_service import AuditEvent, AuditService, AuditStatus
from ..schemas import AuditLogsResponse

router = APIRouter(tags=["Audit"])


@router.get("/audit/logs", response_model=AuditLogsResponse)
def get_audit_logs(
    agent_id: str | None = Query(default=None, description="Filter by agent identifier"),
    role: str | None = Query(default=None, description="Filter by role"),
    status_filter: str | None = Query(default=None, alias="status", description="Filter by audit status"),
    limit: int = Query(default=50, ge=1, le=500, description="Max number of events to return"),
    since: str | None = Query(default=None, description="ISO 8601 UTC timestamp filter"),
    principal: tuple[str, str] = Depends(get_current_principal),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
    audit_service: AuditService = Depends(get_audit_service),
    rationale: str = Depends(get_agent_rationale),
) -> AuditLogsResponse:
    """Query structured audit trail logs with filtering and role permission checks."""
    caller_agent_id, caller_role = principal
    allowed, reason = policy_engine.check_tool_permission(caller_role, "ha_audit_get_logs")

    if not allowed:
        audit_service.log_event(
            AuditEvent(
                agent_id=caller_agent_id,
                role=caller_role,
                action="log_query",
                tool="ha_audit_get_logs",
                target="audit_logs",
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

    events = audit_service.query_logs(
        agent_id=agent_id,
        role=role,
        status=status_filter,  # type: ignore[arg-type]
        limit=limit,
        since=since,
    )

    return AuditLogsResponse(
        total_events=len(events),
        events=events,
    )


from pydantic import BaseModel

class AuthorizeRequest(BaseModel):
    tool: str
    target: str = ""
    domain: str | None = None
    service: str | None = None

@router.post("/audit/authorize", response_model=dict)
def authorize_action(
    req: AuthorizeRequest,
    principal: tuple[str, str] = Depends(get_current_principal),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
    audit_service: AuditService = Depends(get_audit_service),
    rationale: str = Depends(get_agent_rationale),
):
    caller_agent_id, caller_role = principal
    allowed, reason = policy_engine.check_tool_permission(caller_role, req.tool)
    if allowed and req.domain and req.service:
        allowed, reason = policy_engine.check_service_permission(caller_role, req.domain, req.service)

    target_str = req.target
    if not target_str:
        target_str = f"{req.domain}.{req.service}" if req.domain else "unknown"

    audit_service.log_event(
        AuditEvent(
            agent_id=caller_agent_id,
            role=caller_role,
            action="execute" if allowed else "denied_policy",
            tool=req.tool,
            target=target_str,
            status="allowed" if allowed else "denied_policy",
            reason=reason,
            rationale=rationale,
        )
    )
    if not allowed:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"error": "ForbiddenByPolicy", "message": reason, "rule_violated": reason},
        )
    return {"allowed": True, "reason": reason}
