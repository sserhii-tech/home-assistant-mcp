"""Agent management and policy inspection routes."""

from fastapi import APIRouter, Depends, HTTPException, status

from ...core.dependencies import (
    get_agent_rationale,
    get_audit_service,
    get_current_principal,
    get_policy_engine,
)
from ...core.policy import PolicyEngine
from ...services.audit_service import AuditEvent, AuditService
from ..schemas import (
    AgentSummary,
    IssueTokenRequest,
    IssueTokenResponse,
    PoliciesResponse,
)

router = APIRouter(tags=["Agent"])


@router.post("/agent/token", response_model=IssueTokenResponse)
def issue_agent_token(
    req: IssueTokenRequest,
    principal: tuple[str, str] = Depends(get_current_principal),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
    audit_service: AuditService = Depends(get_audit_service),
    rationale: str = Depends(get_agent_rationale),
) -> IssueTokenResponse:
    """Issue a scoped ephemeral token for sub-agents (admin only)."""
    agent_id, role = principal
    if role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={
                "error": "ForbiddenByPolicy",
                "message": "Only admin can issue tokens",
                "rule_violated": "admin role required",
            },
        )

    try:
        ephem = policy_engine.issue_token(
            agent_id=req.agent_id,
            role=req.role,
            ttl_minutes=req.ttl_minutes,
        )
    except ValueError as err:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(err),
        )

    audit_service.log_event(
        AuditEvent(
            agent_id=agent_id,
            role=role,
            action="token_issue",
            tool="ha_agent_issue_token",
            target=req.agent_id,
            status="allowed",
            reason=f"Issued token for role '{req.role}'",
            rationale=rationale,
        )
    )

    return IssueTokenResponse(
        agent_id=req.agent_id,
        role=req.role,
        token=ephem.token,
        expires_at=ephem.expires_at,
    )


@router.get("/agent/policies", response_model=PoliciesResponse)
def get_agent_policies(
    principal: tuple[str, str] = Depends(get_current_principal),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
) -> PoliciesResponse:
    """Inspect active policy roles and configured agent identities with tokens redacted."""
    config = policy_engine.load_policies()
    sanitized_agents = {
        agent_id: AgentSummary(
            role=agent.role,
            description=agent.description,
        )
        for agent_id, agent in config.agents.items()
    }

    return PoliciesResponse(
        roles=config.roles,
        agents=sanitized_agents,
    )
