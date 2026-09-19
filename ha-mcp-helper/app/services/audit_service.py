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
        if not self.log_file.exists():
            return

        if self.backup_count <= 0:
            self.log_file.unlink()
            return

        oldest = self.audit_dir / f"audit.jsonl.{self.backup_count}"
        if oldest.exists():
            oldest.unlink()

        for i in range(self.backup_count - 1, 0, -1):
            src = self.audit_dir / f"audit.jsonl.{i}"
            dst = self.audit_dir / f"audit.jsonl.{i + 1}"
            if src.exists():
                src.rename(dst)

        first_backup = self.audit_dir / "audit.jsonl.1"
        self.log_file.rename(first_backup)

    def query_logs(
        self,
        agent_id: str | None = None,
        role: str | None = None,
        status: AuditStatus | str | None = None,
        limit: int = 50,
        since: str | None = None,
    ) -> list[AuditEvent]:
        if limit <= 0:
            return []

        files_to_check = [self.log_file]
        for i in range(1, self.backup_count + 1):
            files_to_check.append(self.audit_dir / f"audit.jsonl.{i}")

        results: list[AuditEvent] = []

        with self._lock:
            for file_path in files_to_check:
                if not file_path.exists():
                    continue

                try:
                    with file_path.open("r", encoding="utf-8") as f:
                        lines = f.readlines()
                except OSError:
                    continue

                for raw_line in reversed(lines):
                    line = raw_line.strip()
                    if not line:
                        continue

                    try:
                        event = AuditEvent.model_validate_json(line)
                    except Exception:
                        continue

                    if agent_id is not None and event.agent_id != agent_id:
                        continue
                    if role is not None and event.role != role:
                        continue
                    if status is not None and event.status != status:
                        continue
                    if since is not None and event.timestamp < since:
                        continue

                    results.append(event)
                    if len(results) >= limit:
                        return results

        return results


