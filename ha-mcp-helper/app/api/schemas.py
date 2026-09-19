from pydantic import BaseModel

from ..core.policy import RoleDefinition
from ..services.audit_service import AuditEvent


class FileReadRequest(BaseModel):
    path: str


class FileReadResponse(BaseModel):
    path: str
    content: str
    size_bytes: int


class FileWriteRequest(BaseModel):
    path: str
    content: str
    validate_yaml: bool = True
    label: str = ""


class FileWriteResponse(BaseModel):
    success: bool
    path: str
    snapshot_id: str
    bytes_written: int


class BackupRestoreRequest(BaseModel):
    snapshot_id: str


class BackupRestoreResponse(BaseModel):
    success: bool
    restored_file: str
    restored_from: str
    safety_backup: str


class HealthResponse(BaseModel):
    status: str
    version: str
    config_root: str
    snapshots_count: int
    memory_mb: float


class LogsTailResponse(BaseModel):
    lines: list[str]
    count: int


class IssueTokenRequest(BaseModel):
    agent_id: str
    role: str
    ttl_minutes: int = 60


class IssueTokenResponse(BaseModel):
    agent_id: str
    role: str
    token: str
    expires_at: str


class AgentSummary(BaseModel):
    role: str
    description: str = ""


class PoliciesResponse(BaseModel):
    roles: dict[str, RoleDefinition]
    agents: dict[str, AgentSummary]


class AuditLogsResponse(BaseModel):
    total_events: int
    events: list[AuditEvent]

