# RBAC Policy Engine and Config Loader Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the core Role-Based Access Control (RBAC) policy engine and config loader in `ha-mcp-helper` to parse `/config/ha_ai_policies.yaml`, resolve agent tokens with constant-time HMAC, and enforce fine-grained permissions across tools, paths, and services.

**Architecture:** 
- The Python Add-on (`ha-mcp-helper`) introduces `PolicyEngine` in `app/core/policy.py`.
- It defines Pydantic models for roles, agents, and policy configuration.
- It auto-generates the default policy template when missing, tracks file `mtime` to hot-reload config changes without overhead, and evaluates permissions with strict deny-rule precedence and POSIX glob matching.

**Tech Stack:** Python 3.11, FastAPI, Pydantic v2, PyYAML, Pytest, pytest-cov.

## Global Constraints

- **Constant-Time Comparison**: Principal token comparisons MUST use `hmac.compare_digest`.
- **Deny Precedence**: In policy evaluation, `deny_*` rules always take precedence over `allow_*` rules.
- **Built-in Admin Guarantee**: The `admin` role always has unrestricted access (`*` on tools, paths, services).
- **Graceful Fallback**: If `ha_ai_policies.yaml` contains invalid YAML upon hot-reload, the engine logs a warning and retains the last known good configuration.
- **100% Coverage**: `ha-mcp-helper/app/core/policy.py` must achieve 100% test coverage with zero regressions.

---

### Task 1: Pydantic Data Models and Default Template Scaffolding

**Files:**
- Create: `ha-mcp-helper/app/core/policy.py`
- Create: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `class RoleDefinition(BaseModel)`
  - `class AgentDefinition(BaseModel)`
  - `class PolicyConfig(BaseModel)`
  - `DEFAULT_POLICY_YAML: str`
  - `class PolicyEngine`: `ensure_policy_file() -> Path`

- [ ] **Step 1: Write failing test for Pydantic models and default template creation**

Create `ha-mcp-helper/tests/test_policy.py`:
```python
import pytest
from pathlib import Path
from app.core.policy import (
    RoleDefinition,
    AgentDefinition,
    PolicyConfig,
    PolicyEngine,
    DEFAULT_POLICY_YAML,
)

def test_models_instantiation():
    role = RoleDefinition(
        description="Test Role",
        allow_tools=["ha_dashboard_*"],
        deny_tools=["ha_automation_*"],
        allow_paths=["dashboards/**"],
        deny_paths=["secrets.yaml"],
        read_only_paths=["ui-lovelace.yaml"],
        allow_services=["light.*"],
        deny_services=["homeassistant.restart"],
    )
    assert role.allow_tools == ["ha_dashboard_*"]
    assert role.read_only_paths == ["ui-lovelace.yaml"]

    agent = AgentDefinition(
        role="test_role",
        token="sec_agent_123",
        description="Agent 1",
    )
    assert agent.role == "test_role"
    assert agent.token == "sec_agent_123"

    config = PolicyConfig(
        version="1.0",
        roles={"test_role": role},
        agents={"agent_1": agent},
    )
    assert "test_role" in config.roles
    assert config.agents["agent_1"].token == "sec_agent_123"

def test_ensure_policy_file_creates_default_when_missing(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    policy_file = tmp_path / "ha_ai_policies.yaml"
    assert not policy_file.exists()

    created_path = engine.ensure_policy_file()
    assert created_path == policy_file
    assert policy_file.exists()
    content = policy_file.read_text(encoding="utf-8")
    assert "dashboard_designer:" in content
    assert "automation_builder:" in content
    assert "admin:" in content

def test_ensure_policy_file_leaves_existing_intact(tmp_path: Path):
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text("version: \"1.0\"\nroles: {}\nagents: {}\n", encoding="utf-8")
    
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    engine.ensure_policy_file()
    
    assert policy_file.read_text(encoding="utf-8") == "version: \"1.0\"\nroles: {}\nagents: {}\n"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_policy.py -v` in `ha-mcp-helper`
Expected: FAIL with `ModuleNotFoundError: No module named 'app.core.policy'`

- [ ] **Step 3: Implement data models and `ensure_policy_file` in `ha-mcp-helper/app/core/policy.py`**

```python
"""Role-Based Access Control (RBAC) policy engine and configuration loader."""

from pathlib import Path
from pydantic import BaseModel, Field

DEFAULT_POLICY_YAML = """version: "1.0"

roles:
  admin:
    description: "Full administrative access"
    allow_tools: ["*"]
    allow_paths: ["*"]
    allow_services: ["*"]

  dashboard_designer:
    description: "Lovelace visual UI designer"
    allow_tools:
      - "ha_dashboard_*"
      - "ha_system_list_entities"
      - "ha_audit_get_logs"
    allow_paths:
      - "dashboards/**"
      - "ui-lovelace.yaml"
    deny_tools:
      - "ha_automation_*"
      - "ha_system_call_service"
      - "ha_system_restore_backup"

  automation_builder:
    description: "Automation and script authoring"
    allow_tools:
      - "ha_automation_*"
      - "ha_system_list_entities"
      - "ha_system_call_service"
      - "ha_audit_get_logs"
    allow_paths:
      - "automations.yaml"
      - "scripts.yaml"
      - "scenes.yaml"
    allow_services:
      - "automation.*"
      - "script.*"
      - "scene.*"
    deny_tools:
      - "ha_system_restore_backup"

  diagnostics_monitor:
    description: "Read-only diagnostics and health monitoring"
    allow_tools:
      - "ha_system_list_entities"
      - "ha_system_health"
      - "ha_system_get_logs"
      - "ha_audit_get_logs"
    allow_paths:
      - "home-assistant.log"
      - "configuration.yaml"
    read_only_paths:
      - "**"
    deny_tools:
      - "ha_dashboard_save_config"
      - "ha_automation_write"
      - "ha_system_call_service"
      - "ha_system_restore_backup"

  guest:
    description: "Minimal read-only inspection"
    allow_tools:
      - "ha_system_list_entities"
      - "ha_system_health"
    read_only_paths:
      - "**"

agents:
  # Pre-configured sub-agent identities:
  # designer_bot:
  #   role: "dashboard_designer"
  #   token: "sec_agent_designer_example"
"""

class RoleDefinition(BaseModel):
    description: str = ""
    allow_tools: list[str] = Field(default_factory=list)
    deny_tools: list[str] = Field(default_factory=list)
    allow_paths: list[str] = Field(default_factory=list)
    deny_paths: list[str] = Field(default_factory=list)
    read_only_paths: list[str] = Field(default_factory=list)
    allow_services: list[str] = Field(default_factory=list)
    deny_services: list[str] = Field(default_factory=list)

class AgentDefinition(BaseModel):
    role: str
    token: str
    description: str = ""

class PolicyConfig(BaseModel):
    version: str = "1.0"
    roles: dict[str, RoleDefinition] = Field(default_factory=dict)
    agents: dict[str, AgentDefinition] = Field(default_factory=dict)

class PolicyEngine:
    def __init__(self, config_dir: Path | str, master_api_key: str | None = None):
        self.config_dir = Path(config_dir)
        self.policy_file = self.config_dir / "ha_ai_policies.yaml"
        self.master_api_key = master_api_key
        self._cached_config: PolicyConfig | None = None
        self._last_mtime: float = -1.0

    def ensure_policy_file(self) -> Path:
        if not self.policy_file.exists():
            self.config_dir.mkdir(parents=True, exist_ok=True)
            self.policy_file.write_text(DEFAULT_POLICY_YAML, encoding="utf-8")
        return self.policy_file
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_policy.py -v` in `ha-mcp-helper`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(policy): define RBAC data models and default policy template generator"
```

---

### Task 2: Policy File Loading, Parsing, and Hot-Reloading

**Files:**
- Modify: `ha-mcp-helper/app/core/policy.py`
- Modify: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `PolicyEngine.load_policies(force: bool = False) -> PolicyConfig`

- [ ] **Step 1: Write failing tests for `load_policies` and `mtime` hot-reloading**

Append to `ha-mcp-helper/tests/test_policy.py`:
```python
import os
import time
import yaml

def test_load_policies_parses_default_template(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config = engine.load_policies()
    assert config.version == "1.0"
    assert "admin" in config.roles
    assert "dashboard_designer" in config.roles
    assert config.roles["admin"].allow_tools == ["*"]

def test_load_policies_hot_reload_on_mtime_change(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config1 = engine.load_policies()
    assert "custom_role" not in config1.roles

    # Modify the policy file and update mtime
    custom_yaml = """
version: "1.0"
roles:
  custom_role:
    description: "Custom role"
    allow_tools: ["ha_system_health"]
agents:
  custom_agent:
    role: "custom_role"
    token: "sec_agent_custom"
"""
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text(custom_yaml, encoding="utf-8")
    # Bump mtime
    new_mtime = time.time() + 10
    os.utime(policy_file, (new_mtime, new_mtime))

    config2 = engine.load_policies()
    assert "custom_role" in config2.roles
    assert "custom_agent" in config2.agents
    assert config2.agents["custom_agent"].token == "sec_agent_custom"

def test_load_policies_handles_invalid_yaml_gracefully(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config_good = engine.load_policies()
    
    # Write invalid YAML
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text("invalid: [yaml: broken", encoding="utf-8")
    new_mtime = time.time() + 20
    os.utime(policy_file, (new_mtime, new_mtime))

    config_fallback = engine.load_policies()
    # Retains previous valid config
    assert "admin" in config_fallback.roles
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_load_policies" -v`
Expected: FAIL with `AttributeError: 'PolicyEngine' object has no attribute 'load_policies'`

- [ ] **Step 3: Implement `load_policies` in `PolicyEngine`**

In `ha-mcp-helper/app/core/policy.py`:
- Implement `load_policies(self, force: bool = False) -> PolicyConfig`:
  - Call `self.ensure_policy_file()`.
  - Check `mtime = self.policy_file.stat().st_mtime`.
  - If not `force` and `self._cached_config is not None` and `mtime <= self._last_mtime`: return `self._cached_config`.
  - Read YAML text. If empty or invalid, keep `self._cached_config` if available or parse `DEFAULT_POLICY_YAML`.
  - Ensure `admin` role is present in `roles` with `allow_tools=["*"]`, `allow_paths=["*"]`, `allow_services=["*"]`.
  - Update `self._last_mtime = mtime` and `self._cached_config = parsed_config`.
  - Return `self._cached_config`.

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_load_policies" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(policy): implement policy config loader with mtime hot-reloading and fallback"
```

---

### Task 3: Principal Resolution (`resolve_principal`)

**Files:**
- Modify: `ha-mcp-helper/app/core/policy.py`
- Modify: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `PolicyEngine.resolve_principal(token: str | None) -> tuple[str | None, str | None]`

- [ ] **Step 1: Write failing tests for `resolve_principal`**

Append to `ha-mcp-helper/tests/test_policy.py`:
```python
def test_resolve_principal_master_key(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret_123")
    agent_id, role = engine.resolve_principal("master_secret_123")
    assert agent_id == "master"
    assert role == "admin"

def test_resolve_principal_scoped_agent_token(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  designer:
    description: "Designer"
    allow_tools: ["ha_dashboard_*"]
agents:
  bot_designer:
    role: "designer"
    token: "sec_agent_designer_token"
"""
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text(custom_yaml, encoding="utf-8")

    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    agent_id, role = engine.resolve_principal("sec_agent_designer_token")
    assert agent_id == "bot_designer"
    assert role == "designer"

def test_resolve_principal_invalid_and_empty_tokens(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    assert engine.resolve_principal(None) == (None, None)
    assert engine.resolve_principal("") == (None, None)
    assert engine.resolve_principal("invalid_token_999") == (None, None)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_resolve_principal" -v`
Expected: FAIL with `AttributeError: 'PolicyEngine' object has no attribute 'resolve_principal'`

- [ ] **Step 3: Implement `resolve_principal` using `hmac.compare_digest`**

In `ha-mcp-helper/app/core/policy.py`:
```python
import hmac

def resolve_principal(self, token: str | None) -> tuple[str | None, str | None]:
    if not token:
        return (None, None)

    # 1. Master API key check
    if self.master_api_key and hmac.compare_digest(
        str(token).encode("utf-8"),
        str(self.master_api_key).encode("utf-8"),
    ):
        return ("master", "admin")

    # 2. Configured agents check
    config = self.load_policies()
    for agent_id, agent in config.agents.items():
        if agent.token and hmac.compare_digest(
            str(token).encode("utf-8"),
            str(agent.token).encode("utf-8"),
        ):
            return (agent_id, agent.role)

    return (None, None)
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_resolve_principal" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(policy): implement constant-time resolve_principal for master and agent tokens"
```

---

### Task 4: Tool Permission Evaluation (`check_tool_permission`)

**Files:**
- Modify: `ha-mcp-helper/app/core/policy.py`
- Modify: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `PolicyEngine.check_tool_permission(role: str, tool_name: str) -> tuple[bool, str]`

- [ ] **Step 1: Write failing tests for `check_tool_permission`**

Append to `ha-mcp-helper/tests/test_policy.py`:
```python
def test_check_tool_permission_admin_allows_all(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    allowed, reason = engine.check_tool_permission("admin", "ha_system_call_service")
    assert allowed is True
    assert "allowed" in reason.lower()

def test_check_tool_permission_glob_and_deny_precedence(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  designer:
    description: "Designer"
    allow_tools:
      - "ha_dashboard_*"
      - "ha_system_list_entities"
    deny_tools:
      - "ha_dashboard_delete_*"
      - "ha_automation_*"
"""
    (tmp_path / "ha_ai_policies.yaml").write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")

    # Allowed by glob
    allowed, _ = engine.check_tool_permission("designer", "ha_dashboard_save_config")
    assert allowed is True

    # Denied by explicit deny rule (takes precedence over allow glob)
    denied, reason = engine.check_tool_permission("designer", "ha_dashboard_delete_view")
    assert denied is False
    assert "explicitly denied" in reason.lower()

    # Denied because not in allow list
    blocked, reason = engine.check_tool_permission("designer", "ha_system_call_service")
    assert blocked is False
    assert "not permitted" in reason.lower()

def test_check_tool_permission_unknown_role(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    allowed, reason = engine.check_tool_permission("non_existent_role", "ha_system_health")
    assert allowed is False
    assert "unknown role" in reason.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_check_tool_permission" -v`
Expected: FAIL with `AttributeError: 'PolicyEngine' object has no attribute 'check_tool_permission'`

- [ ] **Step 3: Implement pattern matching helper and `check_tool_permission`**

In `ha-mcp-helper/app/core/policy.py`:
```python
import fnmatch

def _match_pattern(pattern: str, target: str) -> bool:
    if pattern == "*" or pattern == "**":
        return True
    return fnmatch.fnmatchcase(target.lower(), pattern.lower())

def check_tool_permission(self, role: str, tool_name: str) -> tuple[bool, str]:
    config = self.load_policies()
    role_def = config.roles.get(role)
    if not role_def:
        return (False, f"Unknown role: '{role}'")

    # 1. Deny rules take precedence
    for pattern in role_def.deny_tools:
        if _match_pattern(pattern, tool_name):
            return (False, f"Tool '{tool_name}' explicitly denied for role '{role}'")

    # 2. Allow rules
    for pattern in role_def.allow_tools:
        if _match_pattern(pattern, tool_name):
            return (True, "Allowed by policy")

    return (False, f"Tool '{tool_name}' not permitted for role '{role}'")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_check_tool_permission" -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(policy): implement check_tool_permission with wildcard glob matching and deny precedence"
```

---

### Task 5: Path & Service Permission Evaluation

**Files:**
- Modify: `ha-mcp-helper/app/core/policy.py`
- Modify: `ha-mcp-helper/tests/test_policy.py`

**Interfaces:**
- Produces:
  - `PolicyEngine.check_path_permission(role: str, path: str, is_write: bool = False) -> tuple[bool, str]`
  - `PolicyEngine.check_service_permission(role: str, domain: str, service: str) -> tuple[bool, str]`

- [ ] **Step 1: Write failing tests for path and service permission checks**

Append to `ha-mcp-helper/tests/test_policy.py`:
```python
def test_check_path_permission_globs_and_readonly(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  designer:
    description: "Designer"
    allow_paths:
      - "dashboards/**"
      - "ui-lovelace.yaml"
    deny_paths:
      - "dashboards/private/**"
    read_only_paths:
      - "ui-lovelace.yaml"
"""
    (tmp_path / "ha_ai_policies.yaml").write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")

    # Recursive subfolder allowed
    allowed, _ = engine.check_path_permission("designer", "dashboards/views/living_room.yaml", is_write=True)
    assert allowed is True

    # Denied subfolder
    denied, reason = engine.check_path_permission("designer", "dashboards/private/secret_view.yaml", is_write=False)
    assert denied is False
    assert "explicitly denied" in reason.lower()

    # Read-only path reading allowed
    ro_read, _ = engine.check_path_permission("designer", "ui-lovelace.yaml", is_write=False)
    assert ro_read is True

    # Read-only path writing blocked
    ro_write, reason = engine.check_path_permission("designer", "ui-lovelace.yaml", is_write=True)
    assert ro_write is False
    assert "read-only" in reason.lower()

    # Unlisted path blocked
    blocked, reason = engine.check_path_permission("designer", "configuration.yaml", is_write=False)
    assert blocked is False
    assert "not permitted" in reason.lower()

def test_check_path_permission_unknown_role(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    allowed, reason = engine.check_path_permission("unknown_role", "dashboards/main.yaml")
    assert allowed is False
    assert "unknown role" in reason.lower()

def test_check_service_permission_globs_and_deny(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  automator:
    description: "Automator"
    allow_services:
      - "light.*"
      - "switch.turn_on"
      - "automation.reload"
    deny_services:
      - "light.flash_all"
"""
    (tmp_path / "ha_ai_policies.yaml").write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")

    # Allowed domain glob
    allowed, _ = engine.check_service_permission("automator", "light", "turn_on")
    assert allowed is True

    # Allowed exact service
    allowed, _ = engine.check_service_permission("automator", "switch", "turn_on")
    assert allowed is True

    # Denied service
    denied, reason = engine.check_service_permission("automator", "light", "flash_all")
    assert denied is False
    assert "explicitly denied" in reason.lower()

    # Not allowed service
    blocked, reason = engine.check_service_permission("automator", "climate", "set_temperature")
    assert blocked is False
    assert "not permitted" in reason.lower()

def test_check_service_permission_unknown_role(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    allowed, reason = engine.check_service_permission("unknown_role", "light", "turn_on")
    assert allowed is False
    assert "unknown role" in reason.lower()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run --extra dev pytest tests/test_policy.py -k "test_check_path_permission or test_check_service_permission" -v`
Expected: FAIL with `AttributeError`

- [ ] **Step 3: Implement `check_path_permission` and `check_service_permission`**

In `ha-mcp-helper/app/core/policy.py`:
- Helper `_match_path_pattern(pattern: str, target_path: str) -> bool`:
  - Normalize path with forward slashes: `posix_target = PurePosixPath(target_path).as_posix().lstrip("/")`.
  - Normalize pattern: `posix_pattern = PurePosixPath(pattern).as_posix().lstrip("/")`.
  - If pattern == "*" or pattern == "**": return True.
  - Regex or recursive match handling `**` and `*`.
- Implement `check_path_permission`:
  - Check `deny_paths` -> return `(False, ...)`
  - If `is_write`, check `read_only_paths` -> return `(False, ...)`
  - Check `allow_paths` -> return `(True, ...)`
  - Default -> `(False, ...)`
- Implement `check_service_permission`:
  - Target: `f"{domain}.{service}"`
  - Check `deny_services` -> return `(False, ...)`
  - Check `allow_services` -> return `(True, ...)`
  - Default -> `(False, ...)`

- [ ] **Step 4: Run test to verify it passes**

Run: `uv run --extra dev pytest tests/test_policy.py -v`
Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add ha-mcp-helper/app/core/policy.py ha-mcp-helper/tests/test_policy.py
git commit -m "feat(policy): implement check_path_permission and check_service_permission"
```

---

### Task 6: Full Pytest Suite & 100% Coverage Verification

**Files:**
- Test: `ha-mcp-helper/tests/test_policy.py`
- Test: `ha-mcp-helper/tests/test_api.py`
- Test: `ha-mcp-helper/tests/test_security.py`

- [ ] **Step 1: Run complete test suite with coverage report**

Run: `uv run --extra dev pytest --cov=app.core.policy --cov-report=term-missing tests/test_policy.py -v` in `ha-mcp-helper`
Expected: 100% coverage on `app/core/policy.py` and all tests passing.

- [ ] **Step 2: Run full regression test suite across all existing tests**

Run: `uv run --extra dev pytest -v` in `ha-mcp-helper`
Expected: ALL 69+ tests passing without any regressions or warnings.

- [ ] **Step 3: Commit and verify clean working tree**

```bash
git status
```
