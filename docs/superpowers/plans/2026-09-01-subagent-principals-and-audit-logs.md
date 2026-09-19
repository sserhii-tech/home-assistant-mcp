# Sub-Agent Principals, Sandboxing Policies, and Audit Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement sub-agent principals, declarative RBAC policies (`/config/ha_ai_policies.yaml`), append-only structured JSONL audit logs (`/config/.audit/audit.jsonl`), and dynamic ephemeral tokens for fine-grained sub-agent sandboxing in Home Assistant.

**Architecture:** 
- The Python Add-on (`ha-mcp-helper`) introduces a `PolicyEngine` that evaluates incoming scoped tokens (`X-Addon-API-Key`) against roles and permission globs, enqueuing every permitted and blocked action to `AuditService` (`audit.jsonl`).
- The TypeScript MCP server (`mcp-server`) forwards agent credentials and optional `rationale` headers, exposing `ha_audit_get_logs`, `ha_agent_issue_token`, and `ha_agent_list_policies` tools to AI agents.

**Tech Stack:** Python 3.11, FastAPI, Pydantic, PyYAML, Pytest, TypeScript 5.7, @modelcontextprotocol/sdk, Vitest.

## Global Constraints

- **Paranoid Security**: File path jailing inside `/config` and hardcoded deny-lists (`secrets.yaml`, `.storage/core.auth`, SSL/SSH keys) cannot be overridden by any role.
- **Constant-Time Auth**: Token comparisons MUST use `hmac.compare_digest`.
- **Deny Precedence**: In policy evaluation, `deny` rules always take precedence over `allow` rules.
- **Append-Only JSONL Audit**: Audit logs are written one atomic JSON object per line and automatically rotated when exceeding 10MB.
- **Lightweight Footprint**: Memory usage must remain < 50MB RAM on Home Assistant.

---

### Task 1: Python Add-on RBAC Policy Engine & Config Loader

**Files:**
- Create: `ha-mcp-helper/app/core/policy.py`
- Test: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `class RoleDefinition(BaseModel)`: `description: str`, `allow_tools: list[str]`, `deny_tools: list[str]`, `allow_paths: list[str]`, `deny_paths: list[str]`, `allow_services: list[str]`, `deny_services: list[str]`
  - `class AgentDefinition(BaseModel)`: `role: str`, `token: str`, `description: str = ""`
  - `class PolicyConfig(BaseModel)`: `version: str`, `roles: dict[str, RoleDefinition]`, `agents: dict[str, AgentDefinition]`
  - `class PolicyEngine`:
    - `load_policies() -> PolicyConfig`
    - `resolve_principal(token: str) -> tuple[str, str]` (returns `(agent_id, role_name)`)
    - `check_tool_permission(role: str, tool_name: str) -> tuple[bool, str]`
    - `check_path_permission(role: str, path: str, is_write: bool) -> tuple[bool, str]`
    - `check_service_permission(role: str, domain: str, service: str) -> tuple[bool, str]`

- [ ] **Step 1: Write comprehensive failing tests for Policy Engine**

Create `ha-mcp-helper/tests/test_policy.py`:
```python
import pytest
from pathlib import Path
from app.core.policy import PolicyEngine, PolicyConfig, RoleDefinition, AgentDefinition

@pytest.fixture
def sample_policies_yaml(tmp_path: Path) -> Path:
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text("""
version: "1.0"
roles:
  dashboard_designer:
    description: "Lovelace designer"
    allow_tools:
      - "ha_dashboard_*"
      - "ha_system_list_entities"
    allow_paths:
      - "dashboards/**"
      - "ui-lovelace.yaml"
    deny_tools:
      - "ha_automation_*"
      - "ha_system_call_service"
  automation_builder:
    description: "Automator"
    allow_tools:
      - "ha_automation_*"
    allow_paths:
      - "automations.yaml"
    allow_services:
      - "automation.reload"
agents:
  designer_bot:
    role: "dashboard_designer"
    token: "sec_agent_designer_123"
""")
    return policy_file

def test_resolve_principal_master_key(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret_key")
    agent_id, role = engine.resolve_principal("master_secret_key")
    assert agent_id == "master"
    assert role == "admin"

def test_resolve_principal_scoped_token(sample_policies_yaml: Path, tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret_key")
    agent_id, role = engine.resolve_principal("sec_agent_designer_123")
    assert agent_id == "designer_bot"
    assert role == "dashboard_designer"

def test_check_tool_permission_allowed(sample_policies_yaml: Path, tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret_key")
    allowed, reason = engine.check_tool_permission("dashboard_designer", "ha_dashboard_save_config")
    assert allowed is True

def test_check_tool_permission_denied(sample_policies_yaml: Path, tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret_key")
    allowed, reason = engine.check_tool_permission("dashboard_designer", "ha_system_call_service")
    assert allowed is False
    assert "denied" in reason.lower()

def test_check_path_permission_glob(sample_policies_yaml: Path, tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret_key")
    allowed, _ = engine.check_path_permission("dashboard_designer", "dashboards/living_room.yaml")
    assert allowed is True
    blocked, reason = engine.check_path_permission("dashboard_designer", "automations.yaml")
    assert blocked is False
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_policy.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.policy'`

- [ ] **Step 3: Implement `PolicyEngine` in `ha-mcp-helper/app/core/policy.py`**

Implement `ha-mcp-helper/app/core/policy.py` with Pydantic models, default template generation if missing, `fnmatch` wildcard matching, and constant-time HMAC token comparisons.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_policy.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(addon): implement RBAC policy engine and policy schema parser"
```

---

### Task 2: Python Add-on JSONL Audit Log Manager

**Files:**
- Create: `ha-mcp-helper/app/services/audit_service.py`
- Test: `ha-mcp-helper/tests/test_audit.py`

**Interfaces:**
- Produces:
  - `class AuditEvent(BaseModel)`: `id: str`, `timestamp: str`, `agent_id: str`, `role: str`, `action: str`, `tool: str`, `target: str`, `status: str`, `reason: str`, `rationale: str = ""`, `snapshot_id: str = ""`, `client_ip: str = ""`
  - `class AuditService`:
    - `log_event(event: AuditEvent) -> AuditEvent`
    - `query_logs(agent_id: str = None, role: str = None, status: str = None, limit: int = 50, since: str = None) -> list[AuditEvent]`
    - `rotate_if_needed()`

- [ ] **Step 1: Write failing tests for Audit Log Manager**

Create `ha-mcp-helper/tests/test_audit.py`:
```python
import pytest
import json
from pathlib import Path
from app.services.audit_service import AuditService, AuditEvent

def test_log_event_appends_jsonl(tmp_path: Path):
    audit_service = AuditService(audit_dir=tmp_path / ".audit")
    event = AuditEvent(
        id="aud_123",
        timestamp="2026-09-01T10:00:00Z",
        agent_id="designer_bot",
        role="dashboard_designer",
        action="file_write",
        tool="ha_dashboard_save_config",
        target="dashboards/main.yaml",
        status="allowed",
        reason="Permitted",
        rationale="Add tile"
    )
    audit_service.log_event(event)
    
    log_file = tmp_path / ".audit" / "audit.jsonl"
    assert log_file.exists()
    lines = log_file.read_text().strip().split("\n")
    assert len(lines) == 1
    data = json.loads(lines[0])
    assert data["agent_id"] == "designer_bot"
    assert data["rationale"] == "Add tile"

def test_query_logs_filtering(tmp_path: Path):
    audit_service = AuditService(audit_dir=tmp_path / ".audit")
    audit_service.log_event(AuditEvent(
        id="1", timestamp="2026-09-01T10:00:00Z", agent_id="bot1", role="role1",
        action="act", tool="t1", target="tgt", status="allowed", reason="ok"
    ))
    audit_service.log_event(AuditEvent(
        id="2", timestamp="2026-09-01T10:01:00Z", agent_id="bot2", role="role2",
        action="act", tool="t2", target="tgt", status="denied_policy", reason="blocked"
    ))

    results = audit_service.query_logs(agent_id="bot2")
    assert len(results) == 1
    assert results[0].id == "2"

    denied = audit_service.query_logs(status="denied_policy")
    assert len(denied) == 1
    assert denied[0].agent_id == "bot2"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_audit.py -v`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.services.audit_service'`

- [ ] **Step 3: Implement `AuditService` in `ha-mcp-helper/app/services/audit_service.py`**

Implement atomic append-only JSONL writes with thread-safety and log rotation when file size exceeds 10MB.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_audit.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/services/audit_service.py ha-mcp-helper/tests/test_audit.py
git commit -m "feat(addon): implement append-only JSONL audit logging service"
```

---

### Task 3: Python Add-on REST Endpoints for Auditing, Ephemeral Tokens, and RBAC Integration

**Files:**
- Modify: `ha-mcp-helper/app/main.py`
- Modify: `ha-mcp-helper/app/api/schemas.py`
- Modify: `ha-mcp-helper/app/core/security.py`
- Test: `ha-mcp-helper/tests/test_api.py`

**Interfaces:**
- REST Endpoints:
  - `GET /audit/logs`: Query audit events (`agent_id`, `role`, `status`, `lines_count`, `since`)
  - `POST /agent/token`: Issue ephemeral scoped token (`agent_id`, `role`, `ttl_minutes`)
  - `GET /agent/policies`: List configured roles and policies
  - Updated `/file/write`, `/file/read`, `/backup/restore`: Integrated with `PolicyEngine` validation and `X-Agent-Rationale` audit logging.

- [ ] **Step 1: Write API tests for RBAC enforcement and Audit endpoints**

Add tests to `ha-mcp-helper/tests/test_api.py` checking that:
- Scoped tokens are permitted only for allowed files/tools.
- Blocked actions return HTTP 403 with `ForbiddenByPolicy` and generate audit entries.
- `/audit/logs` returns queryable audit trail.
- `/agent/token` issues working ephemeral tokens for Master Key callers.

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests/test_api.py -k "audit or policy"`
Expected: FAIL

- [ ] **Step 3: Integrate `PolicyEngine` and `AuditService` into `main.py` & routes**

Implement middleware/dependency injection in FastAPI routes.

- [ ] **Step 4: Run all Python tests**

Run: `uv run --directory ha-mcp-helper --extra dev pytest tests -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/ ha-mcp-helper/tests/
git commit -m "feat(addon): integrate policy enforcement, audit endpoints, and ephemeral tokens"
```

---

### Task 4: TypeScript MCP Server Scoped Client & Rationale Transport

**Files:**
- Modify: `mcp-server/src/adapters/addon/addon.adapter.ts`
- Modify: `mcp-server/src/domain/ports/addon-client.port.ts`
- Test: `mcp-server/tests/clients.test.ts`

**Interfaces:**
- AddonAdapter methods:
  - `getAuditLogs(params: AuditQueryParams) -> Promise<AuditQueryResponse>`
  - `issueAgentToken(params: IssueTokenParams) -> Promise<IssueTokenResponse>`
  - `getAgentPolicies() -> Promise<PoliciesResponse>`
  - Updated `writeFile(path, content, label, rationale)` passing `X-Agent-Rationale` header.

- [ ] **Step 1: Write failing TypeScript tests for AddonAdapter audit and token methods**

Update `mcp-server/tests/clients.test.ts`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test`
Expected: FAIL with missing method errors.

- [ ] **Step 3: Implement methods in `addon.adapter.ts`**

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm --prefix mcp-server test`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add mcp-server/src/ mcp-server/tests/
git commit -m "feat(mcp): add audit log querying and token issuance methods to AddonAdapter"
```

---

### Task 5: TypeScript MCP Tools, CLI, and Skill Pack Updates

**Files:**
- Create: `mcp-server/src/tools/audit.ts`
- Create: `mcp-server/src/tools/agent.ts`
- Modify: `mcp-server/src/index.ts`
- Modify: `mcp-server/src/tools/dashboard.ts`, `mcp-server/src/tools/automation.ts`, `mcp-server/src/tools/system.ts`
- Update: `skills/` and `mcp-server/src/cli/skills.ts`
- Test: `mcp-server/tests/tools.test.ts`, `mcp-server/tests/e2e-smoke.test.ts`

- [ ] **Step 1: Write failing tool tests for `ha_audit_get_logs`, `ha_agent_issue_token`, and `rationale`**

- [ ] **Step 2: Run test to verify it fails**

Run: `npm --prefix mcp-server test`

- [ ] **Step 3: Implement new tools and register in `index.ts`**

- [ ] **Step 4: Run full TypeScript and Python test suites**

Run: `npm test && npm run test:addon`
Expected: 100% PASS across all suites.

- [ ] **Step 5: Commit**

```bash
git add mcp-server/ skills/
git commit -m "feat(mcp): register audit and agent management tools and update AI skills"
```
