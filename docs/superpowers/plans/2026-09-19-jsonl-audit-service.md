# JSONL Audit Logging Service Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a thread-safe, high-performance, append-only JSON Lines (`.jsonl`) audit log manager in `ha-mcp-helper` to record and query all security and policy events under `/config/.audit/audit.jsonl` with automatic rotation.

**Architecture:** 
- The Python Add-on (`ha-mcp-helper`) introduces `AuditService` in `app/services/audit_service.py`.
- It defines the `AuditEvent` Pydantic model with strict `AuditStatus` typing and default ID / ISO timestamp generators.
- `AuditService` provides thread-safe atomic append (`log_event`), automatic file rotation on 10MB threshold (`_rotate_logs`), and multi-file reverse-chronological querying (`query_logs`).

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, Pytest, pytest-cov.

## Global Constraints

- **Thread-Safety**: Append and rotation operations MUST use `threading.Lock` serialization.
- **Strict Typing**: `status` field in `AuditEvent` must use `Literal["allowed", "denied_policy", "denied_security"]`.
- **Atomic Single-Line JSONL**: Each audit entry is serialized as a single-line JSON document followed by a newline.
- **Resilient Querying**: Corrupted or empty lines in log files must be skipped gracefully without raising errors.
- **100% Coverage**: `ha-mcp-helper/app/services/audit_service.py` must achieve 100% statement and branch test coverage.

---

### Task 1: AuditEvent Pydantic Data Model

**Files:**
- Create: `ha-mcp-helper/app/services/__init__.py`
- Create: `ha-mcp-helper/app/services/audit_service.py`
- Create: `ha-mcp-helper/tests/test_audit.py`

**Interfaces:**
- Produces:
  - `AuditStatus = Literal["allowed", "denied_policy", "denied_security"]`
  - `class AuditEvent(BaseModel)`:
    - `id: str` (default: `aud_<uuid12>`)
    - `timestamp: str` (default: ISO 8601 UTC)
    - `agent_id: str`
    - `role: str`
    - `action: str`
    - `tool: str`
    - `target: str`
    - `status: AuditStatus`
    - `reason: str`
    - `rationale: str = ""`
    - `snapshot_id: str = ""`
    - `client_ip: str = ""`

- [ ] **Step 1: Write failing tests for `AuditEvent` model**

Create `ha-mcp-helper/tests/test_audit.py`:
```python
import pytest
from pydantic import ValidationError
from app.services.audit_service import AuditEvent, AuditStatus

def test_audit_event_defaults():
    event = AuditEvent(
        agent_id="designer_bot",
        role="dashboard_designer",
        action="tool_call",
        tool="ha_dashboard_save_config",
        target="dashboards/main.yaml",
        status="allowed",
        reason="Permitted by policy",
    )
    assert event.id.startswith("aud_")
    assert len(event.id) > 8
    assert "T" in event.timestamp
    assert event.rationale == ""
    assert event.snapshot_id == ""
    assert event.client_ip == ""

def test_audit_event_custom_values():
    event = AuditEvent(
        id="aud_custom_123",
        timestamp="2026-09-19T12:00:00Z",
        agent_id="admin_user",
        role="admin",
        action="file_write",
        tool="ha_dashboard_save_config",
        target="ui-lovelace.yaml",
        status="denied_security",
        reason="Protected file",
        rationale="Fix dashboard",
        snapshot_id="snap_999",
        client_ip="192.168.1.100",
    )
    assert event.id == "aud_custom_123"
    assert event.timestamp == "2026-09-19T12:00:00Z"
    assert event.status == "denied_security"
    assert event.snapshot_id == "snap_999"

def test_audit_event_invalid_status_rejected():
    with pytest.raises(ValidationError):
        AuditEvent(
            agent_id="bot",
            role="role",
            action="act",
            tool="tool",
            target="target",
            status="invalid_status",
            reason="reason",
        )
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_audit.py -v` in `ha-mcp-helper`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.audit_service'`

- [ ] **Step 3: Implement `AuditEvent` in `ha-mcp-helper/app/services/audit_service.py`**

```python
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_audit.py -v` in `ha-mcp-helper`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/services/__init__.py ha-mcp-helper/app/services/audit_service.py ha-mcp-helper/tests/test_audit.py
git commit -m "feat(audit): define AuditEvent model with strict status validation"
```

---

### Task 2: AuditService Atomic Log Writing & Directory Scaffolding

**Files:**
- Modify: `ha-mcp-helper/app/services/audit_service.py`
- Modify: `ha-mcp-helper/tests/test_audit.py`

**Interfaces:**
- Produces:
  - `class AuditService`:
    - `__init__(audit_dir: Path | str, max_bytes: int = 10*1024*1024, backup_count: int = 5)`
    - `log_event(event: AuditEvent) -> AuditEvent`

- [ ] **Step 1: Write failing tests for `log_event`**

Append to `ha-mcp-helper/tests/test_audit.py`:
```python
import json
from pathlib import Path
from app.services.audit_service import AuditService

def test_log_event_creates_dir_and_appends_jsonl(tmp_path: Path):
    audit_dir = tmp_path / "custom_audit"
    service = AuditService(audit_dir=audit_dir)
    
    event1 = AuditEvent(
        agent_id="designer_bot",
        role="dashboard_designer",
        action="tool_call",
        tool="ha_dashboard_save_config",
        target="dashboards/main.yaml",
        status="allowed",
        reason="OK",
        rationale="Update layout",
    )
    result = service.log_event(event1)
    assert result == event1
    assert service.log_file.exists()

    lines = service.log_file.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 1
    data1 = json.loads(lines[0])
    assert data1["agent_id"] == "designer_bot"
    assert data1["rationale"] == "Update layout"

    event2 = AuditEvent(
        agent_id="designer_bot",
        role="dashboard_designer",
        action="tool_call",
        tool="ha_automation_write",
        target="automations.yaml",
        status="denied_policy",
        reason="Tool denied",
    )
    service.log_event(event2)

    lines = service.log_file.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == 2
    data2 = json.loads(lines[1])
    assert data2["status"] == "denied_policy"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_audit.py -k "test_log_event_creates_dir" -v`
Expected: FAIL with `NameError: name 'AuditService' is not defined`

- [ ] **Step 3: Implement `AuditService` and `log_event` in `app/services/audit_service.py`**

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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_audit.py -k "test_log_event_creates_dir" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/services/audit_service.py ha-mcp-helper/tests/test_audit.py
git commit -m "feat(audit): implement AuditService log_event atomic append"
```

---

### Task 3: Thread-Safe Log Rotation

**Files:**
- Modify: `ha-mcp-helper/app/services/audit_service.py`
- Modify: `ha-mcp-helper/tests/test_audit.py`

**Interfaces:**
- Produces:
  - `AuditService._rotate_logs() -> None`

- [ ] **Step 1: Write failing tests for log rotation**

Append to `ha-mcp-helper/tests/test_audit.py`:
```python
def test_log_rotation_on_max_bytes(tmp_path: Path):
    # Set small max_bytes to trigger rotation quickly
    service = AuditService(audit_dir=tmp_path, max_bytes=200, backup_count=3)
    
    # Write events to exceed max_bytes multiple times
    for i in range(10):
        service.log_event(AuditEvent(
            agent_id=f"bot_{i}",
            role="admin",
            action="call",
            tool="tool",
            target="tgt",
            status="allowed",
            reason=f"Event {i}",
        ))

    # Should have active audit.jsonl plus rotated files .1, .2, .3
    assert (tmp_path / "audit.jsonl").exists()
    assert (tmp_path / "audit.jsonl.1").exists()
    assert (tmp_path / "audit.jsonl.2").exists()
    assert (tmp_path / "audit.jsonl.3").exists()
    assert not (tmp_path / "audit.jsonl.4").exists()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_audit.py -k "test_log_rotation" -v`
Expected: FAIL with `assert (tmp_path / "audit.jsonl.1").exists()` being False

- [ ] **Step 3: Implement `_rotate_logs` in `AuditService`**

In `ha-mcp-helper/app/services/audit_service.py`:
```python
    def _rotate_logs(self) -> None:
        if not self.log_file.exists():
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_audit.py -k "test_log_rotation" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/services/audit_service.py ha-mcp-helper/tests/test_audit.py
git commit -m "feat(audit): implement automatic log rotation with backup retention limit"
```

---

### Task 4: Log Querying & Filtering

**Files:**
- Modify: `ha-mcp-helper/app/services/audit_service.py`
- Modify: `ha-mcp-helper/tests/test_audit.py`

**Interfaces:**
- Produces:
  - `AuditService.query_logs(agent_id: str = None, role: str = None, status: AuditStatus | str = None, limit: int = 50, since: str = None) -> list[AuditEvent]`

- [ ] **Step 1: Write failing tests for `query_logs`**

Append to `ha-mcp-helper/tests/test_audit.py`:
```python
def test_query_logs_filters_and_ordering(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path)
    e1 = service.log_event(AuditEvent(
        id="aud_1", timestamp="2026-09-19T10:00:00Z", agent_id="bot_a", role="designer",
        action="read", tool="t1", target="tgt1", status="allowed", reason="ok"
    ))
    e2 = service.log_event(AuditEvent(
        id="aud_2", timestamp="2026-09-19T10:05:00Z", agent_id="bot_b", role="automator",
        action="write", tool="t2", target="tgt2", status="denied_policy", reason="blocked"
    ))
    e3 = service.log_event(AuditEvent(
        id="aud_3", timestamp="2026-09-19T10:10:00Z", agent_id="bot_a", role="designer",
        action="write", tool="t3", target="tgt3", status="allowed", reason="ok"
    ))

    # Default query: returns newest-first
    all_events = service.query_logs()
    assert len(all_events) == 3
    assert [e.id for e in all_events] == ["aud_3", "aud_2", "aud_1"]

    # Filter by agent_id
    bot_a_events = service.query_logs(agent_id="bot_a")
    assert len(bot_a_events) == 2
    assert [e.id for e in bot_a_events] == ["aud_3", "aud_1"]

    # Filter by status
    denied = service.query_logs(status="denied_policy")
    assert len(denied) == 1
    assert denied[0].id == "aud_2"

    # Filter by since
    recent = service.query_logs(since="2026-09-19T10:05:00Z")
    assert len(recent) == 2
    assert [e.id for e in recent] == ["aud_3", "aud_2"]

    # Limit
    limited = service.query_logs(limit=1)
    assert len(limited) == 1
    assert limited[0].id == "aud_3"

def test_query_logs_searches_across_rotated_files(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path, max_bytes=150, backup_count=3)
    for i in range(10):
        service.log_event(AuditEvent(
            id=f"aud_{i}",
            agent_id="bot",
            role="role",
            action="act",
            tool="tool",
            target="tgt",
            status="allowed",
            reason=f"Event {i}",
        ))

    results = service.query_logs(limit=10)
    assert len(results) == 10
    # Newest event first
    assert results[0].id == "aud_9"
    assert results[-1].id == "aud_0"

def test_query_logs_corrupted_lines_resilience(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path)
    service.log_event(AuditEvent(
        id="aud_good1", agent_id="bot", role="role", action="act", tool="t", target="tgt", status="allowed", reason="ok"
    ))
    
    # Inject malformed JSON and empty lines
    with service.log_file.open("a", encoding="utf-8") as f:
        f.write("\n{invalid: json\n\n")

    service.log_event(AuditEvent(
        id="aud_good2", agent_id="bot", role="role", action="act", tool="t", target="tgt", status="allowed", reason="ok"
    ))

    results = service.query_logs()
    assert len(results) == 2
    assert [e.id for e in results] == ["aud_good2", "aud_good1"]
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_audit.py -k "test_query_logs" -v`
Expected: FAIL with `AttributeError: 'AuditService' object has no attribute 'query_logs'`

- [ ] **Step 3: Implement `query_logs` in `AuditService`**

In `ha-mcp-helper/app/services/audit_service.py`:
```python
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

        # Candidate log files: active file followed by rotated backups .1, .2, ...
        files = []
        if self.log_file.exists():
            files.append(self.log_file)
        for i in range(1, self.backup_count + 1):
            rotated = self.audit_dir / f"audit.jsonl.{i}"
            if rotated.exists():
                files.append(rotated)

        results: list[AuditEvent] = []
        for file_path in files:
            try:
                lines = file_path.read_text(encoding="utf-8").splitlines()
            except OSError:
                continue

            for line in reversed(lines):
                line = line.strip()
                if not line:
                    continue
                try:
                    event = AuditEvent.model_validate_json(line)
                except Exception:
                    continue

                if agent_id and event.agent_id != agent_id:
                    continue
                if role and event.role != role:
                    continue
                if status and event.status != status:
                    continue
                if since and event.timestamp < since:
                    continue

                results.append(event)
                if len(results) >= limit:
                    return results

        return results
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_audit.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/services/audit_service.py ha-mcp-helper/tests/test_audit.py
git commit -m "feat(audit): implement query_logs with multi-criteria filtering and rotated file traversal"
```

---

### Task 5: Concurrency Verification & 100% Coverage

**Files:**
- Modify: `ha-mcp-helper/tests/test_audit.py`
- Modify: `ha-mcp-helper/pyproject.toml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write concurrent multithreaded logging test**

Append to `ha-mcp-helper/tests/test_audit.py`:
```python
import concurrent.futures

def test_log_event_multithreaded_concurrency(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path, max_bytes=500, backup_count=5)
    total_events = 100

    def log_task(index: int):
        return service.log_event(AuditEvent(
            id=f"aud_thread_{index}",
            agent_id=f"bot_{index % 5}",
            role="tester",
            action="concurrent_write",
            tool="tool_concurrent",
            target="target.yaml",
            status="allowed",
            reason="Concurrent test",
        ))

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        futures = [executor.submit(log_task, i) for i in range(total_events)]
        for f in concurrent.futures.as_completed(futures):
            f.result()

    # Query all events back
    results = service.query_logs(limit=total_events)
    assert len(results) == total_events

def test_query_logs_non_existent_dir(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path / "non_existent")
    assert service.query_logs() == []
    assert service.query_logs(limit=0) == []
```

- [ ] **Step 2: Run complete test suite with 100% coverage enforcement on policy and audit services**

Update `ha-mcp-helper/pyproject.toml` and `.github/workflows/ci.yml` to include `app.services.audit_service` in coverage measurement.
Run: `uv run --directory ha-mcp-helper --extra dev pytest tests --cov=app.core.policy --cov=app.services.audit_service --cov-report=term-missing --cov-fail-under=100`
Expected: 100% statement and branch coverage on both `app.core.policy` and `app.services.audit_service`.

- [ ] **Step 3: Commit and verify clean working tree**

```bash
git add ha-mcp-helper/tests/test_audit.py ha-mcp-helper/pyproject.toml .github/workflows/ci.yml
git commit -m "test(audit): add multithreaded concurrency tests and enforce 100% coverage on audit service"
```
