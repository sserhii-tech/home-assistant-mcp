# Design Document: RBAC Policy Engine and Config Loader

- **Date**: 2026-09-19
- **Status**: Approved Spec
- **GitHub Issue**: [#1 Implement RBAC policy engine and config loader](https://github.com/sserhii-tech/home-assistant-mcp/issues/1)
- **Target Repository**: `home-assistant-mcp`
- **Component**: `ha-mcp-helper` (`app/core/policy.py`, `tests/test_policy.py`)

---

## 1. Objective & Scope

Implement the core Role-Based Access Control (RBAC) policy engine for the Home Assistant Add-on (`ha-mcp-helper`). The engine:
1. Parses declarative YAML policy configurations from `/config/ha_ai_policies.yaml`.
2. Hot-reloads configuration automatically when modified on disk via `mtime` cache invalidation.
3. Automatically scaffolds a default policy template if the configuration file is missing.
4. Resolves incoming tokens to `(agent_id, role)` using constant-time `hmac.compare_digest`.
5. Evaluates fine-grained permissions for MCP tools, configuration file paths, and Home Assistant services using glob pattern matching with strict deny-rule precedence.
6. Enforces hardcoded protected system deny lists across all roles before policy evaluation.

---

## 2. Data Models (`app/core/policy.py`)

```python
from pydantic import BaseModel, Field

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
```

---

## 3. Default Policy Template (`ha_ai_policies.yaml`)

When `/config/ha_ai_policies.yaml` is not present, `PolicyEngine` generates the file with the following default contents:

```yaml
version: "1.0"

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
  # Pre-configured sub-agents:
  # designer_bot:
  #   role: "dashboard_designer"
  #   token: "sec_agent_designer_example"
```

---

## 4. PolicyEngine Architecture

### 4.1 Lifecycle & Caching
- `PolicyEngine(config_dir: Path | str, master_api_key: str | None = None)`
- Caches parsed `PolicyConfig` and tracks `_last_mtime`.
- On every evaluation call (`resolve_principal`, `check_*_permission`), verifies whether `policy_file.stat().st_mtime > self._last_mtime`. If changed, reloads and re-validates YAML.
- Always enforces the built-in `admin` role with `allow_tools: ["*"]`, `allow_paths: ["*"]`, `allow_services: ["*"]` and empty deny lists.

### 4.2 Principal Resolution (`resolve_principal`)
- Input: `token: str | None`
- Returns: `tuple[str | None, str | None]` representing `(agent_id, role)`
- Logic:
  1. If `token` is non-empty and matches `master_api_key` via `hmac.compare_digest` -> return `("master", "admin")`.
  2. Iterates over `config.agents`:
     - Compares `token` with `agent.token` using `hmac.compare_digest`.
     - On match, returns `(agent_id, agent.role)`.
  3. If no match -> return `(None, None)`.

### 4.3 Permission Validation Logic & Deny Precedence

All matching supports recursive globs (`*`, `**`):

1. **Tool Permissions** (`check_tool_permission(role: str, tool_name: str) -> (bool, str)`):
   - Check `deny_tools` -> if match, return `(False, "Tool '<tool_name>' explicitly denied for role '<role>'")`.
   - Check `allow_tools` -> if match, return `(True, "Allowed by policy")`.
   - Else return `(False, "Tool '<tool_name>' not permitted for role '<role>'")`.

2. **Path Permissions** (`check_path_permission(role: str, path: str, is_write: bool = False) -> (bool, str)`):
   - Inviolable check: if `is_protected_path(path)` matches protected system deny lists or path traversal, return `(False, "Access denied: '<path>' is a protected system file")`.
   - Normalize path to relative POSIX string.
   - Check `deny_paths` -> if match, return `(False, "Path '<path>' explicitly denied for role '<role>'")`.
   - Read-only handling:
     - If `is_write` is True, check `read_only_paths` -> if match, return `(False, "Path '<path>' is read-only for role '<role>'")`.
     - If `is_write` is False, check `read_only_paths` -> if match, return `(True, "Allowed by policy (read-only)")`.
   - Check `allow_paths` -> if match, return `(True, "Allowed by policy")`.
   - Else return `(False, "Path '<path>' not permitted for role '<role>'")`.

3. **Service Permissions** (`check_service_permission(role: str, domain: str, service: str) -> (bool, str)`):
   - Format target as `"{domain}.{service}"`.
   - Check `deny_services` -> if match, return `(False, "Service '{domain}.{service}' explicitly denied for role '{role}'")`.
   - Check `allow_services` -> if match, return `(True, "Allowed by policy")`.
   - Else return `(False, "Service '{domain}.{service}' not permitted for role '{role}'")`.

---

## 5. Verification & Testing

Unit tests in `ha-mcp-helper/tests/test_policy.py`:
1. Default template creation on empty/missing directory.
2. `mtime`-based hot-reload when file is updated.
3. Constant-time `resolve_principal` for master key, scoped agent tokens, and unknown tokens.
4. Tool permission allow, deny precedence, and glob matching (`ha_dashboard_*`).
5. Path permission allow, deny, read-only paths (`guest` role read vs write), and recursive glob matching (`dashboards/**`).
6. Service permission allow, deny, and service glob matching (`light.*`, `*.reload`).
7. Protected system file access denial across all roles.
8. 100% statement coverage on `app/core/policy.py`.
