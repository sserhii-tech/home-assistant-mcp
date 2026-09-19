import json
import threading
from pathlib import Path
import pytest
from pydantic import ValidationError
from app.services.audit_service import AuditEvent, AuditService, AuditStatus

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

def test_audit_service_accepts_str_audit_dir(tmp_path: Path):
    audit_dir_str = str(tmp_path / "str_audit")
    service = AuditService(audit_dir=audit_dir_str)
    assert isinstance(service.audit_dir, Path)
    assert service.audit_dir == Path(audit_dir_str)
    assert service.log_file == Path(audit_dir_str) / "audit.jsonl"

def test_audit_service_thread_safe_concurrent_writes(tmp_path: Path):
    audit_dir = tmp_path / "concurrent_audit"
    service = AuditService(audit_dir=audit_dir)

    def write_events(worker_id: int, count: int):
        for i in range(count):
            service.log_event(
                AuditEvent(
                    agent_id=f"worker_{worker_id}",
                    role="tester",
                    action="write",
                    tool="test_tool",
                    target="test_target",
                    status="allowed",
                    reason=f"worker {worker_id} iteration {i}",
                )
            )

    threads = []
    num_threads = 5
    events_per_thread = 20
    for t_id in range(num_threads):
        t = threading.Thread(target=write_events, args=(t_id, events_per_thread))
        threads.append(t)
        t.start()

    for t in threads:
        t.join()

    lines = service.log_file.read_text(encoding="utf-8").strip().split("\n")
    assert len(lines) == num_threads * events_per_thread
    # Ensure every single line is valid JSON
    for line in lines:
        data = json.loads(line)
        assert data["role"] == "tester"

def test_audit_service_exports():
    from app.services import AuditService as ExportedAuditService
    from app.services import AuditEvent as ExportedAuditEvent
    assert ExportedAuditService is AuditService
    assert ExportedAuditEvent is AuditEvent


