import concurrent.futures
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


def test_log_rotation_on_max_bytes(tmp_path: Path):
    # Set small max_bytes to trigger rotation quickly
    service = AuditService(audit_dir=tmp_path, max_bytes=200, backup_count=3)

    # Write events to exceed max_bytes multiple times
    for i in range(10):
        service.log_event(
            AuditEvent(
                agent_id=f"bot_{i}",
                role="admin",
                action="call",
                tool="tool",
                target="tgt",
                status="allowed",
                reason=f"Event {i}",
            )
        )

    # Should have active audit.jsonl plus rotated files .1, .2, .3
    assert (tmp_path / "audit.jsonl").exists()
    assert (tmp_path / "audit.jsonl.1").exists()
    assert (tmp_path / "audit.jsonl.2").exists()
    assert (tmp_path / "audit.jsonl.3").exists()
    assert not (tmp_path / "audit.jsonl.4").exists()


def test_log_rotation_with_backup_count_zero(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path, max_bytes=100, backup_count=0)
    for i in range(5):
        service.log_event(
            AuditEvent(
                agent_id=f"bot_{i}",
                role="admin",
                action="call",
                tool="tool",
                target="tgt",
                status="allowed",
                reason=f"Event {i}",
            )
        )
    assert (tmp_path / "audit.jsonl").exists()
    assert not (tmp_path / "audit.jsonl.1").exists()


def test_log_rotation_with_backup_count_one(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path, max_bytes=100, backup_count=1)
    for i in range(5):
        service.log_event(
            AuditEvent(
                agent_id=f"bot_{i}",
                role="admin",
                action="call",
                tool="tool",
                target="tgt",
                status="allowed",
                reason=f"Event {i}",
            )
        )
    assert (tmp_path / "audit.jsonl").exists()
    assert (tmp_path / "audit.jsonl.1").exists()
    assert not (tmp_path / "audit.jsonl.2").exists()


def test_rotate_logs_when_log_file_does_not_exist(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path, backup_count=3)
    # log_file does not exist yet
    assert not service.log_file.exists()
    service._rotate_logs()
    assert not service.log_file.exists()


def test_query_logs_filters_and_ordering(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path)
    e1 = AuditEvent(
        id="aud_1",
        timestamp="2026-09-19T10:00:00Z",
        agent_id="agent_a",
        role="operator",
        action="read",
        tool="ha_system_health",
        target="system",
        status="allowed",
        reason="ok",
    )
    e2 = AuditEvent(
        id="aud_2",
        timestamp="2026-09-19T11:00:00Z",
        agent_id="agent_b",
        role="designer",
        action="write",
        tool="ha_dashboard_save_config",
        target="dashboards/main.yaml",
        status="denied_policy",
        reason="policy denied",
    )
    e3 = AuditEvent(
        id="aud_3",
        timestamp="2026-09-19T12:00:00Z",
        agent_id="agent_a",
        role="operator",
        action="write",
        tool="ha_automation_write",
        target="automations.yaml",
        status="denied_security",
        reason="security denied",
    )
    e4 = AuditEvent(
        id="aud_4",
        timestamp="2026-09-19T13:00:00Z",
        agent_id="agent_c",
        role="admin",
        action="call",
        tool="ha_system_call_service",
        target="light.turn_on",
        status="allowed",
        reason="admin override",
    )

    for e in [e1, e2, e3, e4]:
        service.log_event(e)

    # 1. Default ordering (reverse chronological: e4, e3, e2, e1)
    results = service.query_logs()
    assert [r.id for r in results] == ["aud_4", "aud_3", "aud_2", "aud_1"]

    # 2. Filter by agent_id
    results = service.query_logs(agent_id="agent_a")
    assert [r.id for r in results] == ["aud_3", "aud_1"]

    # 3. Filter by role
    results = service.query_logs(role="designer")
    assert [r.id for r in results] == ["aud_2"]

    # 4. Filter by status
    results = service.query_logs(status="allowed")
    assert [r.id for r in results] == ["aud_4", "aud_1"]

    # 5. Filter by since
    results = service.query_logs(since="2026-09-19T11:30:00Z")
    assert [r.id for r in results] == ["aud_4", "aud_3"]

    # 6. Combined filter and limit
    results = service.query_logs(status="allowed", limit=1)
    assert len(results) == 1
    assert results[0].id == "aud_4"


def test_query_logs_searches_across_rotated_files(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path, max_bytes=200, backup_count=10)
    for i in range(10):
        service.log_event(
            AuditEvent(
                id=f"aud_{i}",
                timestamp=f"2026-09-19T10:0{i}:00Z",
                agent_id=f"bot_{i}",
                role="admin",
                action="call",
                tool="tool",
                target="tgt",
                status="allowed",
                reason=f"Event {i}",
            )
        )

    # All 10 events should be returned in reverse chronological order
    results = service.query_logs(limit=20)
    assert len(results) == 10
    assert [r.id for r in results] == [f"aud_{i}" for i in range(9, -1, -1)]

    # Query with filter matching only one event in a rotated file
    results = service.query_logs(agent_id="bot_2")
    assert len(results) == 1
    assert results[0].id == "aud_2"

    # Query with small limit stops early across rotated files
    results = service.query_logs(limit=3)
    assert [r.id for r in results] == ["aud_9", "aud_8", "aud_7"]


def test_query_logs_corrupted_lines_resilience(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path)
    valid_event = AuditEvent(
        id="aud_valid_1",
        timestamp="2026-09-19T10:00:00Z",
        agent_id="bot",
        role="role",
        action="act",
        tool="tool",
        target="tgt",
        status="allowed",
        reason="ok",
    )
    service.log_event(valid_event)

    # Append corrupted JSON, blank lines, and incomplete object to log file
    with service.log_file.open("a", encoding="utf-8") as f:
        f.write("\n")
        f.write("   \n")
        f.write("NOT_JSON_AT_ALL\n")
        f.write('{"incomplete": "json"}\n')

    valid_event_2 = AuditEvent(
        id="aud_valid_2",
        timestamp="2026-09-19T11:00:00Z",
        agent_id="bot",
        role="role",
        action="act",
        tool="tool",
        target="tgt",
        status="allowed",
        reason="ok2",
    )
    service.log_event(valid_event_2)

    results = service.query_logs()
    assert len(results) == 2
    assert [r.id for r in results] == ["aud_valid_2", "aud_valid_1"]


def test_query_logs_limit_zero_or_negative(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path)
    service.log_event(
        AuditEvent(
            agent_id="bot",
            role="role",
            action="act",
            tool="tool",
            target="tgt",
            status="allowed",
            reason="ok",
        )
    )
    assert service.query_logs(limit=0) == []
    assert service.query_logs(limit=-1) == []


def test_query_logs_non_existent_files(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path / "non_existent_subdir")
    assert service.query_logs() == []


def test_query_logs_oserror_handled_gracefully(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    service = AuditService(audit_dir=tmp_path)
    service.log_event(
        AuditEvent(
            agent_id="bot",
            role="role",
            action="act",
            tool="tool",
            target="tgt",
            status="allowed",
            reason="ok",
        )
    )
    original_open = Path.open

    def mock_open(self, *args, **kwargs):
        if "audit.jsonl" in str(self):
            raise OSError("Simulated disk error")
        return original_open(self, *args, **kwargs)

    monkeypatch.setattr(Path, "open", mock_open)
    assert service.query_logs() == []


def test_log_event_multithreaded_concurrency(tmp_path: Path):
    audit_dir = tmp_path / "concurrent_rotation_audit"
    service = AuditService(audit_dir=audit_dir, max_bytes=500, backup_count=50)

    def write_event(i: int):
        return service.log_event(
            AuditEvent(
                agent_id=f"bot_{i % 5}",
                role="tester",
                action="call",
                tool="ha_test",
                target=f"target_{i}",
                status="allowed",
                reason=f"Concurrent event {i:03d}",
            )
        )

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as executor:
        events = list(executor.map(write_event, range(100)))

    assert len(events) == 100

    # Ensure multiple rotation files were created
    rotated_files = list(audit_dir.glob("audit.jsonl.*"))
    assert len(rotated_files) > 0

    # Query all logs
    logged_events = service.query_logs(limit=100)
    assert len(logged_events) == 100

    # Verify all 100 events were retrieved regardless of execution ordering
def test_query_logs_since_timezone_normalization(tmp_path: Path):
    service = AuditService(audit_dir=tmp_path)
    # Event 1: 10:00:00 +02:00 -> equivalent to 08:00:00 UTC
    e1 = AuditEvent(
        id="aud_tz1",
        timestamp="2026-09-19T10:00:00+02:00",
        agent_id="bot_tz",
        role="tester",
        action="read",
        tool="tool",
        target="target",
        status="allowed",
        reason="early local",
    )
    # Event 2: 09:30:00 UTC
    e2 = AuditEvent(
        id="aud_tz2",
        timestamp="2026-09-19T09:30:00Z",
        agent_id="bot_tz",
        role="tester",
        action="read",
        tool="tool",
        target="target",
        status="allowed",
        reason="mid utc",
    )
    # Event 3: 08:30:00 -04:00 -> equivalent to 12:30:00 UTC
    e3 = AuditEvent(
        id="aud_tz3",
        timestamp="2026-09-19T08:30:00-04:00",
        agent_id="bot_tz",
        role="tester",
        action="read",
        tool="tool",
        target="target",
        status="allowed",
        reason="late local",
    )
    service.log_event(e1)
    service.log_event(e2)
    service.log_event(e3)

    # Cutoff at 09:00:00 UTC: e1 is 08:00:00 UTC (excluded), e2 is 09:30:00 UTC (included), e3 is 12:30:00 UTC (included)
    results = service.query_logs(since="2026-09-19T09:00:00Z")
    assert [r.id for r in results] == ["aud_tz3", "aud_tz2"]

    # Cutoff with timezone offset: 11:00:00 +02:00 = 09:00:00 UTC
    results_offset = service.query_logs(since="2026-09-19T11:00:00+02:00")
    assert [r.id for r in results_offset] == ["aud_tz3", "aud_tz2"]

    # Naive timestamp (without tzinfo) gets UTC assigned
    e_naive = AuditEvent(
        id="aud_naive",
        timestamp="2026-09-19T10:00:00",
        agent_id="bot_tz",
        role="tester",
        action="read",
        tool="tool",
        target="target",
        status="allowed",
        reason="naive tz",
    )
    service.log_event(e_naive)
    results_naive = service.query_logs(since="2026-09-19T09:59:00")
    assert "aud_naive" in [r.id for r in results_naive]

    # Invalid since string falls back to lexical comparison gracefully
    # e.g., "0" is lexically smaller than "2026...", so all events are matched
    results_lexical_pass = service.query_logs(since="0")
    assert len(results_lexical_pass) > 0
    # "Z" is lexically greater than "2026...", so events are filtered out
    results_lexical_filter = service.query_logs(since="ZZZ")
    assert len(results_lexical_filter) == 0

    # Event with unparseable timestamp is excluded when compared against valid since_dt
    with service.log_file.open("a", encoding="utf-8") as f:
        f.write(json.dumps({
            "id": "aud_bad_ts",
            "timestamp": "INVALID_TS",
            "agent_id": "bot_bad",
            "role": "tester",
            "action": "read",
            "tool": "t",
            "target": "tgt",
            "status": "allowed",
            "reason": "bad ts"
        }) + "\n")

    results_bad_ts = service.query_logs(since="2026-09-19T00:00:00Z")
    assert "aud_bad_ts" not in [r.id for r in results_bad_ts]


def test_reverse_read_lines_small_block_size(tmp_path: Path):
    from app.services.audit_service import _reverse_read_lines
    test_file = tmp_path / "test_reverse.txt"
    test_file.write_text("line1\nline2\nline3\n", encoding="utf-8")

    lines = list(_reverse_read_lines(test_file, block_size=4))
    assert [l.strip() for l in lines if l.strip()] == ["line3", "line2", "line1"]

    # Empty file test
    empty_file = tmp_path / "empty.txt"
    empty_file.write_text("", encoding="utf-8")
    assert list(_reverse_read_lines(empty_file)) == []

