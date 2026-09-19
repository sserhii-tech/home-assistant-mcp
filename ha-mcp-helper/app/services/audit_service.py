"""Structured append-only JSONL audit logging service."""

import threading
import uuid
from datetime import datetime, timezone
from pathlib import Path
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


class AuditService:
    DEFAULT_MAX_BYTES = 10 * 1024 * 1024  # 10 MB
    DEFAULT_BACKUP_COUNT = 5

    def __init__(
        self,
        audit_dir: Path | str,
        max_bytes: int = DEFAULT_MAX_BYTES,
        backup_count: int = DEFAULT_BACKUP_COUNT,
    ):
        self.audit_dir = Path(audit_dir)
        self.log_file = self.audit_dir / "audit.jsonl"
        self.max_bytes = max_bytes
        self.backup_count = backup_count
        self._lock = threading.Lock()

    def log_event(self, event: AuditEvent) -> AuditEvent:
        with self._lock:
            self.audit_dir.mkdir(parents=True, exist_ok=True)
            if self.log_file.exists() and self.log_file.stat().st_size >= self.max_bytes:
                self._rotate_logs()

            line = event.model_dump_json() + "\n"
            with self.log_file.open("a", encoding="utf-8") as f:
                f.write(line)
        return event

    def _rotate_logs(self) -> None:
        pass

