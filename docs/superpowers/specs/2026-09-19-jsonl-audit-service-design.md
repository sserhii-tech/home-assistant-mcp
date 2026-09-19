# Design Document: JSONL Audit Logging Service

- **Date**: 2026-09-19
- **Status**: Approved Spec
- **GitHub Issue**: [#2 Implement append-only JSONL audit logging service](https://github.com/sserhii-tech/home-assistant-mcp/issues/2)
- **Target Repository**: `home-assistant-mcp`
- **Component**: `ha-mcp-helper` (`app/services/audit_service.py`, `tests/test_audit.py`)

---

## 1. Objective & Scope

Create a high-performance, append-only JSON Lines (`.jsonl`) audit log manager for the Home Assistant Add-on (`ha-mcp-helper`). Every action evaluated by the Policy Engine or executed across the system is recorded to `/config/.audit/audit.jsonl` with structured metadata, thread-safe atomic appending, automatic rotation, and flexible querying.

---

## 2. Data Models (`app/services/audit_service.py`)

```python
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
```

---

## 3. Service Class (`AuditService`)

```python
import threading
from pathlib import Path

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
```

### 3.1 Logging & Atomic Rotation
1. `log_event(event: AuditEvent) -> AuditEvent`:
   - Acquires `self._lock`.
   - Creates `self.audit_dir` if non-existent.
   - If `self.log_file.exists()` and `self.log_file.stat().st_size >= self.max_bytes`, performs rotation.
   - Appends single-line JSON string `event.model_dump_json() + "
"` using UTF-8 encoding.
   - Returns the logged `AuditEvent`.
2. `_rotate_logs()`:
   - Removes oldest backup `audit.jsonl.{backup_count}` if it exists.
   - Shifts older files `audit.jsonl.N` -> `audit.jsonl.{N+1}` in reverse order.
   - Renames active `audit.jsonl` -> `audit.jsonl.1`.

### 3.2 Querying & Filtering (`query_logs`)
```python
def query_logs(
    self,
    agent_id: str | None = None,
    role: str | None = None,
    status: AuditStatus | str | None = None,
    limit: int = 50,
    since: str | None = None,
) -> list[AuditEvent]:
```
1. Reads candidate files in order: `[audit.jsonl, audit.jsonl.1, ..., audit.jsonl.backup_count]`.
2. Scans lines in reverse chronological order (newest to oldest).
3. Safely parses each line into `AuditEvent`, skipping malformed or empty lines without raising errors.
4. Applies query filters (`agent_id`, `role`, `status`, `since`).
5. Stops when `limit` events are matched or all candidate lines are exhausted.

---

## 4. Verification & Testing Strategy

1. **Unit Tests in `ha-mcp-helper/tests/test_audit.py`**:
   - `test_audit_event_defaults`: verifies default ID generation and ISO UTC timestamp.
   - `test_log_event_appends_jsonl`: verifies valid single-line JSONL serialization.
   - `test_log_event_thread_safety`: verifies concurrent logging from multiple threads with no corrupted lines.
   - `test_log_rotation_on_max_bytes`: verifies rotation when file size exceeds `max_bytes` up to `backup_count`.
   - `test_query_logs_filters`: tests filtering by `agent_id`, `role`, `status`, `since`, and `limit`.
   - `test_query_logs_searches_rotated_files`: tests searching across rotated logs in reverse chronological order.
   - `test_query_logs_corrupted_lines_resilience`: tests skipping malformed JSON lines gracefully.
2. **Coverage**: 100% statement and branch coverage on `app/services/audit_service.py`.
