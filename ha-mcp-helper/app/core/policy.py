"""Role-Based Access Control (RBAC) policy engine and configuration loader."""

import fnmatch
import hmac
import logging
from pathlib import Path, PurePosixPath
import re
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


def _match_pattern(pattern: str, target: str) -> bool:
    if pattern == "*" or pattern == "**":
        return True
    return fnmatch.fnmatchcase(target.lower(), pattern.lower())


def _path_pattern_to_regex(pattern: str) -> str:
    i = 0
    n = len(pattern)
    res: list[str] = []
    while i < n:
        if pattern[i : i + 4] == "/**/":
            res.append("(?:/.+/|/)")
            i += 4
        elif pattern[i : i + 3] == "/**" and i + 3 == n:
            res.append("(?:/.*)?")
            i += 3
        elif pattern[i : i + 3] == "**/":
            res.append("(?:.+/)?")
            i += 3
        elif pattern[i : i + 2] == "**":
            res.append(".*")
            i += 2
        elif pattern[i] == "*":
            res.append("[^/]*")
            i += 1
        elif pattern[i] == "?":
            res.append("[^/]")
            i += 1
        else:
            res.append(re.escape(pattern[i]))
            i += 1
    return "^" + "".join(res) + "$"


def _match_path_pattern(pattern: str, target_path: str) -> bool:
    pure_target = PurePosixPath(str(target_path).replace("\\", "/"))
    pure_pattern = PurePosixPath(str(pattern).replace("\\", "/"))
    if ".." in pure_target.parts or ".." in pure_pattern.parts:
        return False

    posix_target = pure_target.as_posix().lstrip("/")
    if posix_target == ".":
        posix_target = ""
    posix_pattern = pure_pattern.as_posix().lstrip("/")
    if posix_pattern == ".":
        posix_pattern = ""

    if posix_pattern in ("*", "**"):
        return True
    if posix_pattern.lower() == posix_target.lower():
        return True
    if not posix_pattern:
        return not posix_target

    regex = _path_pattern_to_regex(posix_pattern)
    return bool(re.match(regex, posix_target, re.IGNORECASE))



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
            admin_role.deny_tools = []
            admin_role.deny_paths = []
            admin_role.deny_services = []
            admin_role.read_only_paths = []

        self._last_mtime = mtime
        self._cached_config = parsed_config
        return self._cached_config

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

    def check_path_permission(self, role: str, path: str, is_write: bool = False) -> tuple[bool, str]:
        config = self.load_policies()
        role_def = config.roles.get(role)
        if not role_def:
            return (False, f"Unknown role: '{role}'")

        # 1. Deny rules take precedence
        for pattern in role_def.deny_paths:
            if _match_path_pattern(pattern, path):
                return (False, f"Path '{path}' explicitly denied for role '{role}'")

        # 2. Read-only paths blocked if writing
        if is_write:
            for pattern in role_def.read_only_paths:
                if _match_path_pattern(pattern, path):
                    return (False, f"Path '{path}' is read-only for role '{role}'")

        # 3. Allow rules
        for pattern in role_def.allow_paths:
            if _match_path_pattern(pattern, path):
                return (True, "Allowed by policy")

        return (False, f"Path '{path}' not permitted for role '{role}'")

    def check_service_permission(self, role: str, domain: str, service: str) -> tuple[bool, str]:
        config = self.load_policies()
        role_def = config.roles.get(role)
        if not role_def:
            return (False, f"Unknown role: '{role}'")

        target = f"{domain}.{service}"

        # 1. Deny rules take precedence
        for pattern in role_def.deny_services:
            if _match_pattern(pattern, target):
                return (False, f"Service '{domain}.{service}' explicitly denied for role '{role}'")

        # 2. Allow rules
        for pattern in role_def.allow_services:
            if _match_pattern(pattern, target):
                return (True, "Allowed by policy")

        return (False, f"Service '{domain}.{service}' not permitted for role '{role}'")



