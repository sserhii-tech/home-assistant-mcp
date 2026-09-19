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

def test_load_policies_parses_default_template(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config = engine.load_policies()
    assert config.version == "1.0"
    assert "admin" in config.roles
    assert "dashboard_designer" in config.roles
    assert config.roles["admin"].allow_tools == ["*"]
    assert config.agents == {}

def test_load_policies_hot_reload_on_mtime_change(tmp_path: Path):
    import os
    import time

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
    import os
    import time

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
    assert config_fallback is config_good

def test_load_policies_caching_and_force(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    c1 = engine.load_policies()
    c2 = engine.load_policies()
    assert c1 is c2

    c3 = engine.load_policies(force=True)
    assert c3 is not None
    assert "admin" in c3.roles

def test_load_policies_guarantees_admin_role_even_when_omitted(tmp_path: Path):
    policy_file = tmp_path / "ha_ai_policies.yaml"
    custom_yaml = """
version: "1.0"
roles:
  viewer:
    description: "Viewer only"
    allow_tools: ["ha_system_health"]
"""
    policy_file.write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config = engine.load_policies()

    assert "viewer" in config.roles
    assert "admin" in config.roles
    assert config.roles["admin"].allow_tools == ["*"]
    assert config.roles["admin"].allow_paths == ["*"]
    assert config.roles["admin"].allow_services == ["*"]

def test_load_policies_handles_empty_file_gracefully(tmp_path: Path):
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text("", encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config = engine.load_policies()

    assert config.version == "1.0"
    assert "admin" in config.roles
    assert config.roles["admin"].allow_tools == ["*"]


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


def test_resolve_principal_no_master_key(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key=None)
    assert engine.resolve_principal("any_token") == (None, None)


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


def test_check_path_permission_admin_allows_all(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    allowed, reason = engine.check_path_permission("admin", "configuration.yaml", is_write=True)
    assert allowed is True
    assert "allowed" in reason.lower()


def test_check_path_permission_windows_and_slashes(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  designer:
    description: "Designer"
    allow_paths:
      - "dashboards/**"
"""
    (tmp_path / "ha_ai_policies.yaml").write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")

    # Windows backslash path
    allowed, _ = engine.check_path_permission("designer", r"dashboards\views\living_room.yaml", is_write=False)
    assert allowed is True

    # Leading slash path
    allowed, _ = engine.check_path_permission("designer", "/dashboards/views/living_room.yaml", is_write=False)
    assert allowed is True


def test_check_path_permission_single_star_glob(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  flat_viewer:
    description: "Flat files only"
    allow_paths:
      - "dashboards/*.yaml"
"""
    (tmp_path / "ha_ai_policies.yaml").write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")

    # Direct file matches single star
    allowed, _ = engine.check_path_permission("flat_viewer", "dashboards/living_room.yaml")
    assert allowed is True

    # Nested subfolder does not match single star
    blocked, _ = engine.check_path_permission("flat_viewer", "dashboards/sub/living_room.yaml")
    assert blocked is False


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


def test_check_service_permission_admin_allows_all(tmp_path: Path):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    allowed, reason = engine.check_service_permission("admin", "homeassistant", "restart")
    assert allowed is True
    assert "allowed" in reason.lower()


def test_path_pattern_advanced_globs(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  glob_tester:
    description: "Glob tester"
    allow_paths:
      - "dashboards/**/cards/*.yaml"
      - "**/secrets.yaml"
      - "dashboards/card**"
      - "dashboards/view?.yaml"
      - "."
      - ""
    deny_paths:
      - "private/**/denied.yaml"
"""
    (tmp_path / "ha_ai_policies.yaml").write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")

    # /**/ test (lines 127-128)
    allowed, _ = engine.check_path_permission("glob_tester", "dashboards/deep/nested/cards/light.yaml")
    assert allowed is True
    allowed, _ = engine.check_path_permission("glob_tester", "dashboards/cards/light.yaml")
    assert allowed is True

    # **/ test (lines 133-134)
    allowed, _ = engine.check_path_permission("glob_tester", "secrets.yaml")
    assert allowed is True
    allowed, _ = engine.check_path_permission("glob_tester", "a/b/c/secrets.yaml")
    assert allowed is True

    # ** without slash (lines 136-137)
    allowed, _ = engine.check_path_permission("glob_tester", "dashboards/card123")
    assert allowed is True

    # ? wildcard (lines 142-143)
    allowed, _ = engine.check_path_permission("glob_tester", "dashboards/view1.yaml")
    assert allowed is True
    allowed, _ = engine.check_path_permission("glob_tester", "dashboards/view12.yaml")
    assert blocked is False if (blocked := engine.check_path_permission("glob_tester", "dashboards/view12.yaml")[0]) else True

    # "." target and pattern (lines 153, 156, 163)
    allowed, _ = engine.check_path_permission("glob_tester", ".")
    assert allowed is True
    allowed, _ = engine.check_path_permission("glob_tester", "")
    assert allowed is True


def test_load_policies_stat_oserror(tmp_path: Path, monkeypatch: pytest.MonkeyPatch):
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    engine.ensure_policy_file()

    orig_stat = Path.stat
    calls = 0

    def mock_stat(self, *args, **kwargs):
        nonlocal calls
        calls += 1
        if calls > 1:
            raise OSError("Simulated disk error")
        return orig_stat(self, *args, **kwargs)

    monkeypatch.setattr(Path, "stat", mock_stat)
    config = engine.load_policies()
    assert "admin" in config.roles


def test_load_policies_non_dict_yaml(tmp_path: Path):
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text("- item1\n- item2\n", encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config = engine.load_policies()
    # Should fallback gracefully to default policy where admin exists
    assert "admin" in config.roles


def test_load_policies_admin_role_replaces_restricted_permissions(tmp_path: Path):
    custom_yaml = """
version: "1.0"
roles:
  admin:
    description: "Restricted admin attempt"
    allow_tools:
      - "ha_system_health"
    allow_paths:
      - "dashboards/**"
    allow_services:
      - "light.*"
"""
    policy_file = tmp_path / "ha_ai_policies.yaml"
    policy_file.write_text(custom_yaml, encoding="utf-8")
    engine = PolicyEngine(config_dir=tmp_path, master_api_key="master_secret")
    config = engine.load_policies()

    assert config.roles["admin"].allow_tools == ["*"]
    assert config.roles["admin"].allow_paths == ["*"]
    assert config.roles["admin"].allow_services == ["*"]




