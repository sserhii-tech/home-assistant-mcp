# Policy Enforcement Integration, Audit Endpoints, and Ephemeral Tokens Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Wire the `PolicyEngine` and `AuditService` into the FastAPI server, add REST endpoints for audit querying, policy inspection, and dynamic ephemeral token issuance, and intercept existing file and backup endpoints with strict RBAC policy checks and audit trail recording.

**Architecture:** Extend `PolicyEngine` with in-memory thread-safe `EphemeralToken` storage and validation. Implement FastAPI dependencies to authenticate tokens, resolve `(agent_id, role)` principals, and inject `AuditService` and `PolicyEngine`. Add new `/agent/token`, `/agent/policies`, and `/audit/logs` routes. Protect `/file/read`, `/file/write`, and `/backup/restore` with policy checks and record every allowed/denied action to `.audit/audit.jsonl` with `X-Agent-Rationale`.

**Tech Stack:** Python 3.11+, FastAPI, Pydantic v2, PyYAML, Pytest, Pytest-Cov.

## Global Constraints
- Target files in `ha-mcp-helper/`
- Every policy denial must return HTTP 403 with `ForbiddenByPolicy` detail structure
- Unauthenticated or expired tokens return HTTP 401
- All file reads, writes, backup restores, policy denials, and security blocks must log a structured `AuditEvent`
- `X-Agent-Rationale` header must be recorded in audit log records and pre-edit snapshot labels
- 100% statement and branch test coverage enforced across `ha-mcp-helper`

---

### Task 1: Ephemeral Token Model & PolicyEngine Dynamic Token Issuance

**Files:**
- Modify: `ha-mcp-helper/app/core/policy.py`
- Modify: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `class EphemeralToken(BaseModel)`
  - `PolicyEngine.issue_token(agent_id: str, role: str, ttl_minutes: int = 60) -> EphemeralToken`
  - `PolicyEngine.resolve_principal(token: str | None) -> tuple[str | None, str | None]` (supports ephemeral tokens & expiration)

- [ ] **Step 1: Write failing tests for ephemeral token issuance and resolution**

In `ha-mcp-helper/tests/test_policy.py`:
```python
from app.core.policy import EphemeralToken

def test_issue_ephemeral_token(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    token_obj = engine.issue_token(agent_id="ephem_bot", role="dashboard_designer", ttl_minutes=30)
    assert isinstance(token_obj, EphemeralToken)
    assert token_obj.agent_id == "ephem_bot"
    assert token_obj.role == "dashboard_designer"
    assert token_obj.token.startswith("sec_agent_ephem_")
    assert token_obj.expires_at is not None

    # Resolve token
    agent_id, role = engine.resolve_principal(token_obj.token)
    assert agent_id == "ephem_bot"
    assert role == "dashboard_designer"

def test_issue_token_invalid_role_raises_value_error(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path)
    with pytest.raises(ValueError, match="Role 'non_existent_role' is not defined"):
        engine.issue_token(agent_id="bot", role="non_existent_role")

def test_ephemeral_token_expiration(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path)
    # Issue token with ttl_minutes=0 or past timestamp
    token_obj = engine.issue_token(agent_id="bot", role="admin", ttl_minutes=1)
    # Manually set expires_at in the past
    token_obj.expires_at = "2020-01-01T00:00:00+00:00"
    engine._ephemeral_tokens[token_obj.token] = token_obj

    # Resolution should return (None, None) and prune the expired token
    agent_id, role = engine.resolve_principal(token_obj.token)
    assert agent_id is None
    assert role is None
    assert token_obj.token not in engine._ephemeral_tokens
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_policy.py -k "test_issue_ephemeral_token" -v`
Expected: FAIL with `AttributeError: 'PolicyEngine' object has no attribute 'issue_token'`

- [ ] **Step 3: Implement `EphemeralToken` and dynamic token methods in `PolicyEngine`**

In `ha-mcp-helper/app/core/policy.py`:
```python
import threading
from datetime import datetime, timedelta, timezone

class EphemeralToken(BaseModel):
    token: str
    agent_id: str
    role: str
    expires_at: str
    created_at: str = Field(default_factory=lambda: datetime.now(timezone.utc).isoformat())

# Inside PolicyEngine.__init__:
        self._ephemeral_tokens: dict[str, EphemeralToken] = {}
        self._token_lock = threading.Lock()

# Method issue_token:
    def issue_token(self, agent_id: str, role: str, ttl_minutes: int = 60) -> EphemeralToken:
        config = self.load_policies()
        if role not in config.roles:
            raise ValueError(f"Role '{role}' is not defined in policies")
        if ttl_minutes <= 0 or ttl_minutes > 1440:
            raise ValueError("ttl_minutes must be between 1 and 1440")

        token_str = f"sec_agent_ephem_{uuid.uuid4().hex}"
        now_utc = datetime.now(timezone.utc)
        expires_at = (now_utc + timedelta(minutes=ttl_minutes)).isoformat()

        ephem_obj = EphemeralToken(
            token=token_str,
            agent_id=agent_id,
            role=role,
            expires_at=expires_at,
            created_at=now_utc.isoformat(),
        )
        with self._token_lock:
            self._ephemeral_tokens[token_str] = ephem_obj
        return ephem_obj

# Inside resolve_principal:
        # Check ephemeral tokens
        with self._token_lock:
            if token in self._ephemeral_tokens:
                ephem = self._ephemeral_tokens[token]
                try:
                    exp_dt = datetime.fromisoformat(ephem.expires_at)
                    if exp_dt.tzinfo is None:
                        exp_dt = exp_dt.replace(tzinfo=timezone.utc)
                    if datetime.now(timezone.utc) < exp_dt:
                        return (ephem.agent_id, ephem.role)
                except Exception:
                    pass
                del self._ephemeral_tokens[token]
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_policy.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(policy): implement in-memory ephemeral token issuance and expiration resolution"
```

---

### Task 2: FastAPI Dependencies & Principal Authentication

**Files:**
- Create: `ha-mcp-helper/app/core/dependencies.py`
- Modify: `ha-mcp-helper/app/core/config.py`
- Modify: `ha-mcp-helper/app/api/__init__.py`
- Modify: `ha-mcp-helper/tests/test_security.py`

**Interfaces:**
- Produces:
  - `get_policy_engine(config_root: str = Depends(get_config_root)) -> PolicyEngine`
  - `get_audit_service(config_root: str = Depends(get_config_root)) -> AuditService`
  - `get_current_principal(x_addon_api_key: str | None = Header(...), policy_engine: PolicyEngine = Depends(...)) -> tuple[str, str]`
  - `get_agent_rationale(x_agent_rationale: str | None = Header(...)) -> str`

- [ ] **Step 1: Write failing tests for principal authentication dependencies**

In `ha-mcp-helper/tests/test_security.py`:
```python
from app.core.dependencies import get_policy_engine, get_audit_service, get_current_principal, get_agent_rationale
from app.core.policy import PolicyEngine
from app.services.audit_service import AuditService

def test_dependencies_instantiation(tmp_path: Path):
    engine = get_policy_engine(config_root=str(tmp_path))
    assert isinstance(engine, PolicyEngine)
    assert engine.config_dir == tmp_path

    audit = get_audit_service(config_root=str(tmp_path))
    assert isinstance(audit, AuditService)
    assert audit.audit_dir == tmp_path / ".audit"

def test_get_current_principal_valid_master(tmp_path: Path, monkeypatch):
    monkeypatch.setenv("ADDON_API_KEY", "test_master_key")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="test_master_key")
    principal = get_current_principal(x_addon_api_key="test_master_key", policy_engine=engine)
    assert principal == ("master", "admin")

def test_get_current_principal_invalid_raises_401(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="correct_key")
    with pytest.raises(HTTPException) as exc:
        get_current_principal(x_addon_api_key="wrong_key", policy_engine=engine)
    assert exc.value.status_code == 401

def test_get_agent_rationale_header():
    assert get_agent_rationale("Updating dashboard") == "Updating dashboard"
    assert get_agent_rationale(None) == ""
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_security.py -k "test_dependencies_instantiation" -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.dependencies'`

- [ ] **Step 3: Implement dependencies in `ha-mcp-helper/app/core/dependencies.py`**

```python
"""FastAPI dependency injection providers for policies, audit logging, and principal auth."""

import functools
from pathlib import Path
from fastapi import Depends, Header, HTTPException, status

from .config import get_api_key, get_config_root
from .policy import PolicyEngine
from ..services.audit_service import AuditService

@functools.lru_cache(maxsize=4)
def _get_cached_policy_engine(config_root: str, master_key: str) -> PolicyEngine:
    return PolicyEngine(config_dir=config_root, master_api_key=master_key)

@functools.lru_cache(maxsize=4)
def _get_cached_audit_service(config_root: str) -> AuditService:
    return AuditService(audit_dir=Path(config_root) / ".audit")

def get_policy_engine(config_root: str = Depends(get_config_root)) -> PolicyEngine:
    return _get_cached_policy_engine(config_root, get_api_key())

def get_audit_service(config_root: str = Depends(get_config_root)) -> AuditService:
    return _get_cached_audit_service(config_root)

def get_current_principal(
    x_addon_api_key: str | None = Header(default=None, alias="X-Addon-API-Key"),
    policy_engine: PolicyEngine = Depends(get_policy_engine),
) -> tuple[str, str]:
    if not x_addon_api_key:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing X-Addon-API-Key header",
        )
    agent_id, role = policy_engine.resolve_principal(x_addon_api_key)
    if not agent_id or not role:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired API token",
        )
    return (agent_id, role)

def get_agent_rationale(
    x_agent_rationale: str | None = Header(default="", alias="X-Agent-Rationale"),
) -> str:
    return x_agent_rationale or ""
```

Update `ha-mcp-helper/app/api/__init__.py` to use `Depends(get_current_principal)` on `api_v1`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_security.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/dependencies.py ha-mcp-helper/app/api/__init__.py ha-mcp-helper/tests/test_security.py
git commit -m "feat(auth): implement FastAPI principal authentication and dependency injection"
```

---

### Task 3: Agent Management & Audit Log Query Endpoints

**Files:**
- Modify: `ha-mcp-helper/app/api/schemas.py`
- Create: `ha-mcp-helper/app/api/routes/agent.py`
- Create: `ha-mcp-helper/app/api/routes/audit.py`
- Modify: `ha-mcp-helper/app/api/__init__.py`
- Modify: `ha-mcp-helper/tests/test_api.py`

**Interfaces:**
- Produces:
  - `POST /api/v1/agent/token` -> `IssueTokenResponse`
  - `GET /api/v1/agent/policies` -> `PoliciesResponse`
  - `GET /api/v1/audit/logs` -> `AuditLogsResponse`

- [ ] **Step 1: Write failing tests for agent and audit endpoints**

In `ha-mcp-helper/tests/test_api.py`:
```python
def test_issue_token_endpoint_admin_success(client, auth_headers):
    resp = client.post(
        "/api/v1/agent/token",
        json={"agent_id": "test_bot", "role": "dashboard_designer", "ttl_minutes": 60},
        headers=auth_headers,
    )
    assert resp.status_code == 200
    data = resp.json()
    assert data["agent_id"] == "test_bot"
    assert data["role"] == "dashboard_designer"
    assert data["token"].startswith("sec_agent_ephem_")
    assert "expires_at" in data

def test_issue_token_non_admin_forbidden(client, monkeypatch, tmp_path):
    # Setup scoped token for non-admin
    # Expect 403 Forbidden
    ...

def test_get_agent_policies_endpoint(client, auth_headers):
    resp = client.get("/api/v1/agent/policies", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "roles" in data
    assert "admin" in data["roles"]
    assert "agents" in data

def test_get_audit_logs_endpoint(client, auth_headers):
    resp = client.get("/api/v1/audit/logs?limit=10", headers=auth_headers)
    assert resp.status_code == 200
    data = resp.json()
    assert "total_events" in data
    assert "events" in data
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_api.py -k "test_issue_token_endpoint" -v`
Expected: FAIL with `404 Not Found`

- [ ] **Step 3: Implement Schemas and Routes**

In `ha-mcp-helper/app/api/schemas.py`:
Add `IssueTokenRequest`, `IssueTokenResponse`, `AgentSummary`, `PoliciesResponse`, `AuditLogsResponse`.

In `ha-mcp-helper/app/api/routes/agent.py`:
Implement `/agent/token` and `/agent/policies`.

In `ha-mcp-helper/app/api/routes/audit.py`:
Implement `/audit/logs` with tool permission check `ha_audit_get_logs` and query parameter filtering.

Register routers in `ha-mcp-helper/app/api/__init__.py`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/api/schemas.py ha-mcp-helper/app/api/routes/agent.py ha-mcp-helper/app/api/routes/audit.py ha-mcp-helper/app/api/__init__.py ha-mcp-helper/tests/test_api.py
git commit -m "feat(api): implement /agent/token, /agent/policies, and /audit/logs REST endpoints"
```

---

### Task 4: Policy Interception on File & Backup Endpoints with Audit Logging

**Files:**
- Modify: `ha-mcp-helper/app/api/routes/files.py`
- Modify: `ha-mcp-helper/app/api/routes/backups.py`
- Modify: `ha-mcp-helper/tests/test_api.py`

**Interfaces:**
- Produces:
  - Policy checking & structured audit log recording on `/api/v1/file/read`, `/api/v1/file/write`, and `/api/v1/backup/restore`
  - Structured 403 response on policy denial (`ForbiddenByPolicy`)

- [ ] **Step 1: Write failing tests for policy interception on file read/write and backup restore**

In `ha-mcp-helper/tests/test_api.py`:
```python
def test_file_read_policy_enforcement(client, agent_headers):
    # Sub-agent with dashboard_designer role reads automations.yaml (not in allow_paths)
    resp = client.post("/api/v1/file/read", json={"path": "automations.yaml"}, headers=agent_headers)
    assert resp.status_code == 403
    assert resp.json()["detail"]["error"] == "ForbiddenByPolicy"

def test_file_write_policy_enforcement_and_rationale(client, designer_headers):
    # Sub-agent with dashboard_designer writes to dashboards/view.yaml (allowed) with X-Agent-Rationale
    resp = client.post(
        "/api/v1/file/write",
        json={"path": "dashboards/view.yaml", "content": "title: Test"},
        headers={**designer_headers, "X-Agent-Rationale": "Updating view"},
    )
    assert resp.status_code == 200
    
    # Verify audit log was recorded
    logs_resp = client.get("/api/v1/audit/logs", headers=designer_headers)
    assert logs_resp.status_code == 200
    events = logs_resp.json()["events"]
    assert any(e["target"] == "dashboards/view.yaml" and e["rationale"] == "Updating view" for e in events)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_api.py -k "test_file_read_policy_enforcement" -v`
Expected: FAIL

- [ ] **Step 3: Update `files.py` and `backups.py` with PolicyEngine & AuditService integration**

In `ha-mcp-helper/app/api/routes/files.py`:
- Inject `principal: tuple[str, str] = Depends(get_current_principal)`, `rationale: str = Depends(get_agent_rationale)`, `policy_engine = Depends(get_policy_engine)`, `audit_service = Depends(get_audit_service)`.
- In `read_file`:
  - Check `allowed, reason = policy_engine.check_path_permission(role, req.path, is_write=False)`.
  - If not allowed: log `AuditEvent(status="denied_policy")`, raise 403 with `ForbiddenByPolicy`.
  - If allowed: execute read, log `AuditEvent(status="allowed")`, return response.
  - On `SecurityException`: log `AuditEvent(status="denied_security")`, raise 403.
- In `write_file`:
  - Check `allowed, reason = policy_engine.check_path_permission(role, req.path, is_write=True)`.
  - If not allowed: log `AuditEvent(status="denied_policy", rationale=rationale)`, raise 403 with `ForbiddenByPolicy`.
  - If allowed: execute write with `label=rationale or req.label`, log `AuditEvent(status="allowed", snapshot_id=res["snapshot_id"], rationale=rationale)`, return response.
  - On `SecurityException`: log `AuditEvent(status="denied_security")`, raise 403.

In `ha-mcp-helper/app/api/routes/backups.py`:
- Inject dependencies.
- In `restore_backup`:
  - Check `allowed, reason = policy_engine.check_tool_permission(role, "ha_system_restore_backup")`.
  - If not allowed: log `AuditEvent(status="denied_policy")`, raise 403 with `ForbiddenByPolicy`.
  - If allowed: execute restore, log `AuditEvent(status="allowed", snapshot_id=req.snapshot_id)`, return response.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_api.py -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/api/routes/files.py ha-mcp-helper/app/api/routes/backups.py ha-mcp-helper/tests/test_api.py
git commit -m "feat(api): enforce RBAC policy checks and audit logging on file and backup endpoints"
```

---

### Task 5: End-to-End Integration Verification & 100% Coverage Enforcement

**Files:**
- Modify: `ha-mcp-helper/tests/test_api.py`
- Modify: `ha-mcp-helper/pyproject.toml`
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Write comprehensive integration tests**

In `ha-mcp-helper/tests/test_api.py`:
- Issue temporary token -> authenticate sub-agent -> attempt forbidden file write (assert 403 & audit record) -> perform allowed file write with `X-Agent-Rationale` -> verify snapshot and audit trail -> query audit logs with filters.
- Expired token request -> verify 401.
- Invalid token request -> verify 401.
- Security violation (path traversal / `secrets.yaml` attempt) -> verify 403 and `denied_security` audit record.

- [ ] **Step 2: Run complete test suite with 100% coverage on all touched modules**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests --cov=app --cov-report=term-missing --cov-fail-under=100`

- [ ] **Step 3: Commit**

```bash
git add ha-mcp-helper/tests/test_api.py ha-mcp-helper/pyproject.toml .github/workflows/ci.yml
git commit -m "test(api): add comprehensive end-to-end integration tests and enforce 100% coverage"
```
