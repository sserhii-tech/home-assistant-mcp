"""Role-Based Access Control (RBAC) policy engine and configuration loader."""

import logging
from pathlib import Path
import yaml
from pydantic import BaseModel, Field, field_validator

logger = logging.getLogger(__name__)

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

    @field_validator("roles", "agents", mode="before")
    @classmethod
    def handle_none_dict(cls, v):
        if v is None:
            return {}
        return v

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

    def load_policies(self, force: bool = False) -> PolicyConfig:
        self.ensure_policy_file()
        try:
            mtime = self.policy_file.stat().st_mtime
        except OSError:
            mtime = -1.0

        if not force and self._cached_config is not None and mtime <= self._last_mtime:
            return self._cached_config

        parsed_config: PolicyConfig | None = None
        try:
            content = self.policy_file.read_text(encoding="utf-8")
            if content.strip():
                raw_dict = yaml.safe_load(content)
                if isinstance(raw_dict, dict):
                    parsed_config = PolicyConfig.model_validate(raw_dict)
                else:
                    logger.warning("Policy file %s is not a mapping; using fallback", self.policy_file)
        except Exception as e:
            logger.warning("Failed to load or parse policy file %s: %s", self.policy_file, e)

        if parsed_config is None:
            if self._cached_config is not None:
                self._last_mtime = mtime
                return self._cached_config
            raw_default = yaml.safe_load(DEFAULT_POLICY_YAML) or {}
            parsed_config = PolicyConfig.model_validate(raw_default)

        # Ensure admin role is always present and has wildcard permissions
        if "admin" not in parsed_config.roles:
            parsed_config.roles["admin"] = RoleDefinition(
                description="Full administrative access",
                allow_tools=["*"],
                allow_paths=["*"],
                allow_services=["*"],
            )
        else:
            admin_role = parsed_config.roles["admin"]
            if "*" not in admin_role.allow_tools:
                admin_role.allow_tools = ["*"]
            if "*" not in admin_role.allow_paths:
                admin_role.allow_paths = ["*"]
            if "*" not in admin_role.allow_services:
                admin_role.allow_services = ["*"]

        self._last_mtime = mtime
        self._cached_config = parsed_config
        return self._cached_config
