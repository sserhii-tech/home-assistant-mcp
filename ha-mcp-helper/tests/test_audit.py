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
