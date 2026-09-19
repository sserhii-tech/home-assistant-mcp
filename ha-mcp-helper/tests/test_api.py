"""Tests for HA Addon FastAPI server endpoints."""

import os
import pathlib
import sys
import pytest
from fastapi.testclient import TestClient

# Ensure addon and app directories are in sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app")))
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

try:
    from app.main import app, get_api_key, get_config_root
except ImportError:
    try:
        from main import app, get_api_key, get_config_root
    except ImportError:
        from addon.app.main import app, get_api_key, get_config_root

TEST_API_KEY = "test-secret-key-12345"


@pytest.fixture
def temp_config_dir(tmp_path, monkeypatch):
    """Fixture providing an isolated temporary config root directory."""
    config_dir = tmp_path / "config"
    config_dir.mkdir(parents=True, exist_ok=True)
    
    # Set environment variables
    monkeypatch.setenv("CONFIG_ROOT", str(config_dir))
    monkeypatch.setenv("ADDON_API_KEY", TEST_API_KEY)
    
    # Also override FastAPI dependency / settings if applicable
    app.dependency_overrides[get_config_root] = lambda: str(config_dir)
    app.dependency_overrides[get_api_key] = lambda: TEST_API_KEY
    
    yield config_dir
    
    app.dependency_overrides.clear()


@pytest.fixture
def client(temp_config_dir):
    """Fixture providing a TestClient configured with isolated config."""
    return TestClient(app)


@pytest.fixture
def auth_headers():
    """Standard authentication headers for valid requests."""
    return {"X-Addon-API-Key": TEST_API_KEY}


# ---------------------------------------------------------------------------
# 1. Authentication Tests
# ---------------------------------------------------------------------------

def test_missing_api_key_returns_401(client):
    """Requests without X-Addon-API-Key header must be rejected with 401."""
    res = client.get("/api/v1/health")
    assert res.status_code == 401
    assert "detail" in res.json()


def test_invalid_api_key_returns_401(client):
    """Requests with incorrect X-Addon-API-Key header must be rejected with 401."""
    res = client.get("/api/v1/health", headers={"X-Addon-API-Key": "wrong-key"})
    assert res.status_code == 401


def test_endpoints_require_auth(client):
    """All /api/v1/* endpoints must enforce authentication."""
    endpoints = [
        ("GET", "/api/v1/health", None),
        ("POST", "/api/v1/file/read", {"path": "automations.yaml"}),
        ("POST", "/api/v1/file/write", {"path": "automations.yaml", "content": "test: 1"}),
        ("GET", "/api/v1/backup/list", None),
        ("POST", "/api/v1/backup/restore", {"snapshot_id": "dummy"}),
        ("GET", "/api/v1/logs/tail", None),
        ("POST", "/api/v1/agent/token", {"agent_id": "a", "role": "admin"}),
        ("GET", "/api/v1/agent/policies", None),
        ("GET", "/api/v1/audit/logs", None),
    ]
    for method, path, body in endpoints:
        if method == "GET":
            res = client.get(path)
        else:
            res = client.post(path, json=body)
        assert res.status_code == 401, f"{path} did not enforce auth"


# ---------------------------------------------------------------------------
# 2. Health Endpoint Tests
# ---------------------------------------------------------------------------

def test_health_endpoint_success(client, auth_headers, temp_config_dir):
    """Health endpoint returns system status, version, config_root, snapshots_count, and memory_mb."""
    res = client.get("/api/v1/health", headers={**auth_headers})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["version"] == "0.3.9"
    assert data["config_root"] == str(temp_config_dir)
    assert data["snapshots_count"] == 0
    assert isinstance(data["memory_mb"], (int, float))
    assert data["memory_mb"] > 0


# ---------------------------------------------------------------------------
# 3. File Read Endpoint Tests
# ---------------------------------------------------------------------------

def test_file_read_success(client, auth_headers, temp_config_dir):
    """Reading an existing file in config root returns its content and size."""
    auto_file = temp_config_dir / "automations.yaml"
    content = "- alias: 'Test Automation'\n  trigger: []\n  action: []\n"
    auto_file.write_bytes(content.encode("utf-8"))

    res = client.post(
        "/api/v1/file/read",
        headers=auth_headers,
        json={"path": "automations.yaml"},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["path"] == "automations.yaml"
    assert data["content"] == content
    assert data["size_bytes"] == len(content.encode("utf-8"))


def test_file_read_not_found(client, auth_headers):
    """Reading a non-existent file returns 404 Not Found."""
    res = client.post(
        "/api/v1/file/read",
        headers=auth_headers,
        json={"path": "nonexistent.yaml"},
    )
    assert res.status_code == 404


def test_file_read_path_traversal_blocked(client, auth_headers):
    """Path traversal read attempts return 403 Forbidden."""
    res = client.post(
        "/api/v1/file/read",
        headers=auth_headers,
        json={"path": "../../etc/passwd"},
    )
    assert res.status_code == 403


def test_file_read_deny_listed_files_blocked(client, auth_headers, temp_config_dir):
    """Access to secrets.yaml or .storage/core.auth must be blocked with 403 Forbidden."""
    (temp_config_dir / "secrets.yaml").write_bytes(b"api_key: secret")
    res = client.post(
        "/api/v1/file/read",
        headers=auth_headers,
        json={"path": "secrets.yaml"},
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# 4. File Write Endpoint Tests
# ---------------------------------------------------------------------------

def test_file_write_valid_yaml_creates_snapshot_and_writes(client, auth_headers, temp_config_dir):
    """Writing valid YAML writes the file, creates a pre-edit snapshot, and returns 200."""
    auto_file = temp_config_dir / "automations.yaml"
    auto_file.write_bytes(b"- alias: Original\n")

    new_content = "- alias: Updated\n  trigger:\n    - platform: state\n"
    res = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={
            "path": "automations.yaml",
            "content": new_content,
            "validate_yaml": True,
            "label": "test-edit",
        },
    )
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["path"] == "automations.yaml"
    assert "snapshot_id" in data
    assert data["bytes_written"] == len(new_content.encode("utf-8"))

    # Verify content was updated on disk
    assert auto_file.read_bytes().decode("utf-8") == new_content

    # Verify snapshot exists
    snapshots_res = client.get("/api/v1/backup/list", headers=auth_headers)
    assert snapshots_res.status_code == 200
    snapshots = snapshots_res.json()
    assert len(snapshots) == 1
    assert snapshots[0]["snapshot_id"] == data["snapshot_id"]


def test_file_write_invalid_yaml_rejected(client, auth_headers, temp_config_dir):
    """Writing invalid YAML with validate_yaml=True returns 400 Bad Request and does not write."""
    auto_file = temp_config_dir / "automations.yaml"
    original_content = "- alias: Original\n"
    auto_file.write_bytes(original_content.encode("utf-8"))

    bad_yaml = "- alias: Broken\n  trigger: [unclosed list\n"
    res = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={
            "path": "automations.yaml",
            "content": bad_yaml,
            "validate_yaml": True,
            "label": "bad-edit",
        },
    )
    assert res.status_code == 400
    assert "Invalid YAML syntax" in res.json().get("detail", "") or "Invalid YAML syntax" in str(res.json())

    # File on disk must remain untouched
    assert auto_file.read_bytes().decode("utf-8") == original_content


def test_file_write_path_traversal_blocked(client, auth_headers):
    """Path traversal write attempts return 403 Forbidden."""
    res = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={
            "path": "../../malicious.yaml",
            "content": "evil: true",
        },
    )
    assert res.status_code == 403


def test_file_write_deny_listed_target_blocked(client, auth_headers):
    """Writing to secrets.yaml or .storage/core.auth returns 403 Forbidden."""
    res = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={
            "path": "secrets.yaml",
            "content": "my_secret: hacked",
        },
    )
    assert res.status_code == 403


# ---------------------------------------------------------------------------
# 5. Backup List and Restore Tests
# ---------------------------------------------------------------------------

def test_backup_list_and_restore_workflow(client, auth_headers, temp_config_dir):
    """Complete workflow of writing, listing backups, and restoring previous version."""
    target_file = temp_config_dir / "scripts.yaml"
    v1_content = "script_1:\n  sequence: []\n"
    target_file.write_bytes(v1_content.encode("utf-8"))

    # Edit 1 (creates snapshot of v1)
    v2_content = "script_2:\n  sequence: []\n"
    res1 = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={"path": "scripts.yaml", "content": v2_content, "label": "v1-to-v2"},
    )
    assert res1.status_code == 200
    snap1_id = res1.json()["snapshot_id"]

    # Verify list
    list_res = client.get("/api/v1/backup/list", headers=auth_headers)
    assert list_res.status_code == 200
    snapshots = list_res.json()
    assert len(snapshots) == 1
    assert snapshots[0]["snapshot_id"] == snap1_id

    # Restore snapshot 1
    restore_res = client.post(
        "/api/v1/backup/restore",
        headers=auth_headers,
        json={"snapshot_id": snap1_id},
    )
    assert restore_res.status_code == 200
    restore_data = restore_res.json()
    assert restore_data["success"] is True
    assert "safety_backup" in restore_data

    # Verify file content is back to v1
    assert target_file.read_bytes().decode("utf-8") == v1_content


def test_backup_restore_invalid_snapshot_id_404(client, auth_headers):
    """Restoring a non-existent snapshot returns 404 Not Found."""
    res = client.post(
        "/api/v1/backup/restore",
        headers=auth_headers,
        json={"snapshot_id": "nonexistent_snapshot_id"},
    )
    assert res.status_code == 404


def test_backup_restore_traversal_blocked_403(client, auth_headers):
    """Restoring with path traversal in snapshot_id returns 403 Forbidden or 400 Bad Request."""
    res = client.post(
        "/api/v1/backup/restore",
        headers=auth_headers,
        json={"snapshot_id": "../../etc/shadow"},
    )
    assert res.status_code in (400, 403)


# ---------------------------------------------------------------------------
# 6. Logs Tail Endpoint Tests
# ---------------------------------------------------------------------------

def test_logs_tail_missing_file_returns_empty(client, auth_headers):
    """When home-assistant.log does not exist, returns empty lines array."""
    res = client.get("/api/v1/logs/tail", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["lines"] == []
    assert data["count"] == 0


def test_logs_tail_redacts_credentials(client, auth_headers, temp_config_dir):
    """Logs tail endpoint reads log lines and redacts all credential patterns."""
    log_file = temp_config_dir / "home-assistant.log"
    log_lines = [
        "2026-08-31 10:00:00 INFO Initializing HA Core\n",
        "2026-08-31 10:00:01 DEBUG Auth attempt with Bearer secret-bearer-token-123\n",
        "2026-08-31 10:00:02 INFO Connect to mqtt://user:superpassword@192.168.1.50:1883\n",
        '2026-08-31 10:00:03 WARNING Failed login with "password": "supersecretpassword"\n',
        "2026-08-31 10:00:04 INFO Webhook received api_key=topsecretkey12345\n",
    ]
    log_file.write_bytes("".join(log_lines).encode("utf-8"))

    res = client.get("/api/v1/logs/tail?lines=10", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 5
    assert len(data["lines"]) == 5

    # Check redactions
    joined = "\n".join(data["lines"])
    assert "secret-bearer-token-123" not in joined
    assert "superpassword" not in joined
    assert "supersecretpassword" not in joined
    assert "topsecretkey12345" not in joined
    assert "***REDACTED***" in joined


def test_logs_tail_respects_line_limit(client, auth_headers, temp_config_dir):
    """Logs tail endpoint respects lines query parameter and returns only the last N lines."""
    log_file = temp_config_dir / "home-assistant.log"
    log_lines = [f"line {i}\n" for i in range(1, 21)]
    log_file.write_bytes("".join(log_lines).encode("utf-8"))

    res = client.get("/api/v1/logs/tail?lines=5", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert data["count"] == 5
    assert data["lines"] == ["line 16", "line 17", "line 18", "line 19", "line 20"]


def test_file_write_non_yaml_skips_yaml_validation(client, auth_headers, temp_config_dir):
    """Writing non-YAML files (e.g. .txt, .json) or validate_yaml=False should succeed even if content is not YAML."""
    res = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={
            "path": "notes.txt",
            "content": "Just a plain note {unclosed",
            "validate_yaml": True,
        },
    )
    assert res.status_code == 200
    assert res.json()["success"] is True
    assert (temp_config_dir / "notes.txt").read_bytes().decode("utf-8") == "Just a plain note {unclosed"


def test_backup_restore_new_file_deletes_file(client, auth_headers, temp_config_dir):
    """Restoring a snapshot taken before a file was initially created should delete the file."""
    # Write a new file (takes snapshot with is_new_file=True)
    res = client.post(
        "/api/v1/file/write",
        headers=auth_headers,
        json={"path": "brand_new_component.py", "content": "print('hello')", "validate_yaml": False},
    )
    assert res.status_code == 200
    snap_id = res.json()["snapshot_id"]
    new_file = temp_config_dir / "brand_new_component.py"
    assert new_file.exists()

    # Restore snapshot (should delete newly created file)
    restore_res = client.post(
        "/api/v1/backup/restore",
        headers=auth_headers,
        json={"snapshot_id": snap_id},
    )
    assert restore_res.status_code == 200
    assert not new_file.exists()


# ---------------------------------------------------------------------------
# 7. Agent & Audit Endpoint Tests
# ---------------------------------------------------------------------------

def test_issue_token_endpoint_admin_success(client, auth_headers, temp_config_dir):
    """Admin issues ephemeral token, receives valid response, and audit log is created."""
    res = client.post(
        "/api/v1/agent/token",
        headers={**auth_headers, "X-Agent-Rationale": "Issue token for UI designer bot"},
        json={"agent_id": "designer_bot", "role": "dashboard_designer", "ttl_minutes": 120},
    )
    assert res.status_code == 200
    data = res.json()
    assert data["agent_id"] == "designer_bot"
    assert data["role"] == "dashboard_designer"
    assert data["token"].startswith("sec_agent_ephem_")
    assert "expires_at" in data

    # Verify audit event in .audit/audit.jsonl
    audit_file = temp_config_dir / ".audit" / "audit.jsonl"
    assert audit_file.exists()
    audit_lines = audit_file.read_text(encoding="utf-8").strip().splitlines()
    assert len(audit_lines) >= 1
    import json
    last_event = json.loads(audit_lines[-1])
    assert last_event["agent_id"] == "master"
    assert last_event["role"] == "admin"
    assert last_event["action"] == "token_issue"
    assert last_event["tool"] == "ha_agent_issue_token"
    assert last_event["target"] == "designer_bot"
    assert last_event["status"] == "allowed"
    assert last_event["rationale"] == "Issue token for UI designer bot"


def test_issue_token_non_admin_forbidden(client, auth_headers):
    """Non-admin role attempting to issue a token is rejected with 403 Forbidden."""
    # First, admin issues a token for a non-admin role (dashboard_designer)
    res_token = client.post(
        "/api/v1/agent/token",
        headers=auth_headers,
        json={"agent_id": "designer_agent", "role": "dashboard_designer", "ttl_minutes": 60},
    )
    assert res_token.status_code == 200
    non_admin_token = res_token.json()["token"]

    # Attempt to issue another token using the non-admin credentials
    res = client.post(
        "/api/v1/agent/token",
        headers={"X-Addon-API-Key": non_admin_token},
        json={"agent_id": "another_bot", "role": "guest", "ttl_minutes": 30},
    )
    assert res.status_code == 403
    data = res.json()
    assert data["detail"]["error"] == "ForbiddenByPolicy"
    assert "Only admin can issue tokens" in data["detail"]["message"]


def test_issue_token_invalid_role_or_ttl_returns_400(client, auth_headers):
    """Invalid role name or out-of-range TTL returns 400 Bad Request."""
    # Invalid role
    res_bad_role = client.post(
        "/api/v1/agent/token",
        headers=auth_headers,
        json={"agent_id": "bot1", "role": "non_existent_role", "ttl_minutes": 60},
    )
    assert res_bad_role.status_code == 400
    assert "Role 'non_existent_role' is not defined" in res_bad_role.json().get("detail", "")

    # Invalid TTL (0)
    res_bad_ttl_zero = client.post(
        "/api/v1/agent/token",
        headers=auth_headers,
        json={"agent_id": "bot2", "role": "dashboard_designer", "ttl_minutes": 0},
    )
    assert res_bad_ttl_zero.status_code == 400

    # Invalid TTL (>1440)
    res_bad_ttl_high = client.post(
        "/api/v1/agent/token",
        headers=auth_headers,
        json={"agent_id": "bot3", "role": "dashboard_designer", "ttl_minutes": 2000},
    )
    assert res_bad_ttl_high.status_code == 400


def test_get_agent_policies_endpoint(client, auth_headers, temp_config_dir):
    """Endpoint returns active roles and agent summaries with secret tokens redacted."""
    # Create custom policy file with configured agent having a secret token
    policy_file = temp_config_dir / "ha_ai_policies.yaml"
    policy_content = """version: "1.0"
roles:
  admin:
    description: "Full administrative access"
    allow_tools: ["*"]
    allow_paths: ["*"]
    allow_services: ["*"]
  guest:
    description: "Minimal read-only inspection"
    allow_tools: ["ha_system_list_entities"]
agents:
  secret_bot:
    role: "guest"
    token: "super_secret_agent_token_value_xyz"
    description: "Configured secret bot"
"""
    policy_file.write_text(policy_content, encoding="utf-8")

    res = client.get("/api/v1/agent/policies", headers=auth_headers)
    assert res.status_code == 200
    data = res.json()
    assert "roles" in data
    assert "admin" in data["roles"]
    assert "guest" in data["roles"]
    assert "agents" in data
    assert "secret_bot" in data["agents"]
    # Verify agent summary fields
    agent_info = data["agents"]["secret_bot"]
    assert agent_info["role"] == "guest"
    assert agent_info["description"] == "Configured secret bot"
    # Ensure raw secret token is NOT exposed
    assert "token" not in agent_info
    raw_response = res.text
    assert "super_secret_agent_token_value_xyz" not in raw_response


def test_get_audit_logs_endpoint(client, auth_headers, temp_config_dir):
    """Filter audit logs by agent_id, status, role, since, and limit."""
    import json
    audit_dir = temp_config_dir / ".audit"
    audit_dir.mkdir(parents=True, exist_ok=True)
    audit_file = audit_dir / "audit.jsonl"
    events = [
        {"id": "aud_1", "timestamp": "2026-09-01T10:00:00+00:00", "agent_id": "bot_a", "role": "dashboard_designer", "action": "file_read", "tool": "ha_dashboard_get_config", "target": "ui-lovelace.yaml", "status": "allowed", "reason": "ok", "rationale": "", "snapshot_id": "", "client_ip": ""},
        {"id": "aud_2", "timestamp": "2026-09-01T11:00:00+00:00", "agent_id": "bot_a", "role": "dashboard_designer", "action": "file_write", "tool": "ha_dashboard_save_config", "target": "ui-lovelace.yaml", "status": "allowed", "reason": "ok", "rationale": "", "snapshot_id": "snap_1", "client_ip": ""},
        {"id": "aud_3", "timestamp": "2026-09-01T12:00:00+00:00", "agent_id": "bot_b", "role": "automation_builder", "action": "file_write", "tool": "ha_automation_write", "target": "automations.yaml", "status": "denied_policy", "reason": "denied", "rationale": "", "snapshot_id": "", "client_ip": ""},
    ]
    with audit_file.open("w", encoding="utf-8") as f:
        for ev in events:
            f.write(json.dumps(ev) + "\n")

    # Query all
    res_all = client.get("/api/v1/audit/logs", headers=auth_headers)
    assert res_all.status_code == 200
    data_all = res_all.json()
    assert data_all["total_events"] == 3
    assert len(data_all["events"]) == 3

    # Query with agent_id filter
    res_bot_a = client.get("/api/v1/audit/logs?agent_id=bot_a", headers=auth_headers)
    assert res_bot_a.status_code == 200
    assert res_bot_a.json()["total_events"] == 2

    # Query with role filter
    res_role = client.get("/api/v1/audit/logs?role=automation_builder", headers=auth_headers)
    assert res_role.status_code == 200
    assert res_role.json()["total_events"] == 1
    assert res_role.json()["events"][0]["agent_id"] == "bot_b"

    # Query with status filter
    res_denied = client.get("/api/v1/audit/logs?status=denied_policy", headers=auth_headers)
    assert res_denied.status_code == 200
    assert res_denied.json()["total_events"] == 1

    # Query with limit
    res_limit = client.get("/api/v1/audit/logs?limit=1", headers=auth_headers)
    assert res_limit.status_code == 200
    assert res_limit.json()["total_events"] == 1

    # Query with since filter
    res_since = client.get("/api/v1/audit/logs?since=2026-09-01T11:30:00%2B00:00", headers=auth_headers)
    assert res_since.status_code == 200
    assert res_since.json()["total_events"] == 1
    assert res_since.json()["events"][0]["id"] == "aud_3"


def test_get_audit_logs_unauthorized_role_forbidden(client, auth_headers, temp_config_dir):
    """Role without ha_audit_get_logs permission (e.g. guest) is rejected with 403 and logged."""
    # Issue a token for role 'guest' (which does NOT have ha_audit_get_logs in default policy)
    res_token = client.post(
        "/api/v1/agent/token",
        headers=auth_headers,
        json={"agent_id": "guest_user", "role": "guest", "ttl_minutes": 60},
    )
    assert res_token.status_code == 200
    guest_token = res_token.json()["token"]

    # Attempt to query audit logs with guest token
    res = client.get("/api/v1/audit/logs", headers={"X-Addon-API-Key": guest_token})
    assert res.status_code == 403
    data = res.json()
    assert data["detail"]["error"] == "ForbiddenByPolicy"
    assert "ha_audit_get_logs" in data["detail"]["rule_violated"]

    # Verify a denied_policy audit event was recorded
    audit_file = temp_config_dir / ".audit" / "audit.jsonl"
    assert audit_file.exists()
    import json
    lines = [json.loads(line) for line in audit_file.read_text(encoding="utf-8").strip().splitlines()]
    denied_events = [e for e in lines if e.get("status") == "denied_policy" and e.get("tool") == "ha_audit_get_logs"]
    assert len(denied_events) >= 1
    assert denied_events[-1]["agent_id"] == "guest_user"
    assert denied_events[-1]["role"] == "guest"
    assert denied_events[-1]["action"] == "log_query"
    assert denied_events[-1]["target"] == "audit_logs"


