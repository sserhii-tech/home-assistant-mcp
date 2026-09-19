"""Structured append-only JSONL audit logging service."""

import uuid
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field

AuditStatus = Literal["allowed", "denied_policy", "denied_security"]


class AuditEvent(BaseModel):
    id: str = Field(default_factory=lambda: f"aud_{uuid.uuid4().hex[:12]}")
    timestamp: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    agent_id: str
    role: str
    action: str
    tool: str
    target: str
    status: AuditStatus
    reason: str
    rationale: str = ""
    snapshot_id: str = ""
    client_ip: str = ""
