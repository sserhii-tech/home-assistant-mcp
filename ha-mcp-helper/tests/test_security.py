import os
import sys
import unittest.mock
import pytest
from pathlib import Path

# Add app to path for import
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "app")))

from security import (
    SecurityException,
    verify_api_key,
    sanitize_path,
    sanitize_log_line,
    is_protected_path,
)


class TestVerifyApiKey:
    """Test API key verification with constant-time comparison."""

    def test_valid_key(self):
        assert verify_api_key("super-secret-key-12345", "super-secret-key-12345") is True

    def test_invalid_key(self):
        assert verify_api_key("wrong-key", "super-secret-key-12345") is False

    def test_none_provided_key(self):
        assert verify_api_key(None, "super-secret-key-12345") is False

    def test_empty_provided_key(self):
        assert verify_api_key("", "super-secret-key-12345") is False

    def test_none_expected_key(self):
        assert verify_api_key("super-secret-key-12345", None) is False

    def test_empty_expected_key(self):
        assert verify_api_key("super-secret-key-12345", "") is False

    def test_both_empty(self):
        assert verify_api_key("", "") is False

    def test_key_length_mismatch(self):
        assert verify_api_key("short", "much-longer-key-value-123456789") is False

    def test_unicode_keys(self):
        assert verify_api_key("clé-secrète-🔑", "clé-secrète-🔑") is True
        assert verify_api_key("clé-secrète-🔒", "clé-secrète-🔑") is False


class TestSanitizePath:
    """Test paranoid path jail and sensitive file deny-list."""

    @pytest.fixture
    def config_dir(self, tmp_path):
        """Create a mock /config directory structure."""
        config = tmp_path / "config"
        config.mkdir()

        # Safe files & dirs
        (config / "automations.yaml").write_text("automation: []", encoding="utf-8")
        (config / "scripts.yaml").write_text("script: {}", encoding="utf-8")
        (config / "configuration.yaml").write_text("homeassistant: {}", encoding="utf-8")
        
        custom_comp = config / "custom_components" / "test_comp"
        custom_comp.mkdir(parents=True)
        (custom_comp / "sensor.py").write_text("# sensor", encoding="utf-8")

        # Sensitive / Deny-listed files
        (config / "secrets.yaml").write_text("wifi_pass: 1234", encoding="utf-8")
        (config / "ip_bans.yaml").write_text("1.2.3.4: {}", encoding="utf-8")
        (config / "server.pem").write_text("CERT DATA", encoding="utf-8")
        (config / "private.key").write_text("KEY DATA", encoding="utf-8")
        (config / "id_rsa").write_text("SSH KEY DATA", encoding="utf-8")
        (config / "id_rsa.pub").write_text("SSH PUB DATA", encoding="utf-8")

        storage = config / ".storage"
        storage.mkdir()
        (storage / "core.auth").write_text("{}", encoding="utf-8")
        (storage / "core.config_entries").write_text("{}", encoding="utf-8")
        (storage / "safe_storage_file").write_text("{}", encoding="utf-8")

        # Outside directory
        outside = tmp_path / "outside"
        outside.mkdir()
        (outside / "shadow.txt").write_text("root:x:0:0:", encoding="utf-8")

        return config

    def test_valid_safe_relative_paths(self, config_dir):
        config_root = str(config_dir)
        
        res1 = sanitize_path(config_root, "automations.yaml")
        assert res1 == os.path.realpath(str(config_dir / "automations.yaml"))

        res2 = sanitize_path(config_root, "scripts.yaml")
        assert res2 == os.path.realpath(str(config_dir / "scripts.yaml"))

        res3 = sanitize_path(config_root, "custom_components/test_comp/sensor.py")
        assert res3 == os.path.realpath(str(config_dir / "custom_components" / "test_comp" / "sensor.py"))

        res4 = sanitize_path(config_root, ".storage/safe_storage_file")
        assert res4 == os.path.realpath(str(config_dir / ".storage" / "safe_storage_file"))

    def test_valid_safe_absolute_paths_within_root(self, config_dir):
        config_root = str(config_dir)
        abs_path = str(config_dir / "configuration.yaml")
        
        result = sanitize_path(config_root, abs_path)
        assert result == os.path.realpath(abs_path)

    def test_empty_paths_raise_security_exception(self, config_dir):
        config_root = str(config_dir)
        with pytest.raises(SecurityException, match=r"empty"):
            sanitize_path(config_root, "")
        with pytest.raises(SecurityException, match=r"empty"):
            sanitize_path("", "automations.yaml")

    def test_path_traversal_attempts_raise_security_exception(self, config_dir):
        config_root = str(config_dir)

        with pytest.raises(SecurityException, match=r"traversal|outside"):
            sanitize_path(config_root, "../../etc/passwd")

        with pytest.raises(SecurityException, match=r"traversal|outside"):
            sanitize_path(config_root, "../outside/shadow.txt")

        with pytest.raises(SecurityException, match=r"traversal|outside"):
            sanitize_path(config_root, "custom_components/../../outside/shadow.txt")

        with pytest.raises(SecurityException, match=r"traversal|outside"):
            sanitize_path(config_root, "/etc/shadow")

    def test_deny_list_secrets_yaml(self, config_dir):
        config_root = str(config_dir)

        with pytest.raises(SecurityException, match=r"secrets\.yaml|deny|pattern"):
            sanitize_path(config_root, "secrets.yaml")

        with pytest.raises(SecurityException, match=r"secrets\.yaml|deny|pattern"):
            sanitize_path(config_root, "./secrets.yaml")

        with pytest.raises(SecurityException, match=r"secrets\.yaml|deny|pattern"):
            sanitize_path(config_root, "subdir/secrets.yaml")

        with pytest.raises(SecurityException, match=r"secrets\.yaml|deny|pattern"):
            sanitize_path(config_root, "SECRETS.YAML")

    def test_deny_list_storage_auth_and_config_entries(self, config_dir):
        config_root = str(config_dir)

        with pytest.raises(SecurityException, match=r"core\.auth|deny|path"):
            sanitize_path(config_root, ".storage/core.auth")

        with pytest.raises(SecurityException, match=r"core\.config_entries|deny|path"):
            sanitize_path(config_root, ".storage/core.config_entries")

        with pytest.raises(SecurityException, match=r"core\.auth|deny|path"):
            sanitize_path(config_root, ".storage/core.auth.backup")

    def test_deny_list_crypto_and_ssh_keys(self, config_dir):
        config_root = str(config_dir)

        with pytest.raises(SecurityException, match=r"deny|pattern|\*\.pem"):
            sanitize_path(config_root, "server.pem")

        with pytest.raises(SecurityException, match=r"deny|pattern|\*\.key"):
            sanitize_path(config_root, "private.key")

        with pytest.raises(SecurityException, match=r"deny|pattern|id_rsa\*"):
            sanitize_path(config_root, "id_rsa")

        with pytest.raises(SecurityException, match=r"deny|pattern|id_rsa\*"):
            sanitize_path(config_root, "id_rsa.pub")

        with pytest.raises(SecurityException, match=r"deny|pattern|id_rsa\*"):
            sanitize_path(config_root, "id_rsa_backup")

        with pytest.raises(SecurityException, match=r"deny|pattern|\*\.pem"):
            sanitize_path(config_root, "CERT.PEM")

    def test_deny_list_ip_bans(self, config_dir):
        config_root = str(config_dir)

        with pytest.raises(SecurityException, match=r"ip_bans\.yaml|deny|pattern"):
            sanitize_path(config_root, "ip_bans.yaml")

        with pytest.raises(SecurityException, match=r"ip_bans\.yaml|deny|pattern"):
            sanitize_path(config_root, "IP_BANS.YAML")

    def test_symlink_escape_mocked(self, config_dir):
        config_root = str(config_dir)
        outside_path = os.path.realpath(os.path.abspath(os.path.join(config_root, "..", "outside", "shadow.txt")))

        def mock_realpath(path):
            if "symlink_test" in path:
                return outside_path
            return os.path.abspath(path)

        with unittest.mock.patch("os.path.realpath", side_effect=mock_realpath):
            with pytest.raises(SecurityException, match=r"traversal|outside"):
                sanitize_path(config_root, "symlink_test")

    def test_symlink_to_denied_file_mocked(self, config_dir):
        config_root = str(config_dir)
        secrets_path = os.path.realpath(str(config_dir / "secrets.yaml"))

        def mock_realpath(path):
            if "innocent_symlink.txt" in path:
                return secrets_path
            return os.path.abspath(path)

        with unittest.mock.patch("os.path.realpath", side_effect=mock_realpath):
            with pytest.raises(SecurityException, match=r"deny|pattern|secrets\.yaml"):
                sanitize_path(config_root, "innocent_symlink.txt")

    def test_null_byte_injection(self, config_dir):
        config_root = str(config_dir)
        with pytest.raises(SecurityException, match=r"null byte|invalid"):
            sanitize_path(config_root, "automations.yaml\0.txt")


class TestSanitizeLogLine:
    """Test redaction of sensitive credentials in log lines."""

    def test_plain_log_unchanged(self):
        line = "2026-08-31 09:00:00 INFO Home Assistant started in 1.42 seconds"
        assert sanitize_log_line(line) == line

    def test_empty_and_none(self):
        assert sanitize_log_line("") == ""
        assert sanitize_log_line(None) is None

    def test_bearer_token_redaction(self):
        line = "2026-08-31 09:00:01 DEBUG Request headers: Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c"
        redacted = sanitize_log_line(line)
        assert "eyJhbGciOiJIUzI1Ni" not in redacted
        assert "Authorization: Bearer ***REDACTED***" in redacted

    def test_bearer_lowercase_redaction(self):
        line = "authorization: bearer my_token_secret_123"
        redacted = sanitize_log_line(line)
        assert "my_token_secret_123" not in redacted
        assert "authorization: bearer ***REDACTED***" in redacted

    def test_api_key_query_and_json_redaction(self):
        line1 = "GET /api/states?api_key=my_secret_token_12345 HTTP/1.1"
        assert sanitize_log_line(line1) == "GET /api/states?api_key=***REDACTED*** HTTP/1.1"

        line2 = '{"api_key": "secret_key_abcdef123456", "status": "ok"}'
        assert sanitize_log_line(line2) == '{"api_key": "***REDACTED***", "status": "ok"}'

        line3 = '{"apikey": "secret_key_xyz987"}'
        assert sanitize_log_line(line3) == '{"apikey": "***REDACTED***"}'

    def test_password_field_redaction(self):
        line1 = '{"user": "admin", "password": "super_secret_password_999!"}'
        assert "super_secret_password_999!" not in sanitize_log_line(line1)
        assert '"password": "***REDACTED***"' in sanitize_log_line(line1)

        line2 = "auth failed for user 'admin' with password='mypassword123'"
        assert "mypassword123" not in sanitize_log_line(line2)
        assert "password='***REDACTED***'" in sanitize_log_line(line2)

        line3 = "passwd: super_secret_pass"
        assert "super_secret_pass" not in sanitize_log_line(line3)
        assert sanitize_log_line(line3) == "passwd: ***REDACTED***"

    def test_embedded_url_credentials_redaction(self):
        line = "Connecting to mqtt://user:secretpass123@192.168.1.50:1883"
        redacted = sanitize_log_line(line)
        assert "secretpass123" not in redacted
        assert "mqtt://user:***REDACTED***@192.168.1.50:1883" in redacted

        line2 = "Fetching https://ha_admin:ha_pass_secret@myha.local/feed"
        redacted2 = sanitize_log_line(line2)
        assert "ha_pass_secret" not in redacted2
        assert "https://ha_admin:***REDACTED***@myha.local/feed" in redacted2

    def test_access_token_and_secret_redaction(self):
        line1 = "Setting access_token: ABCDEF1234567890XYZ"
        assert sanitize_log_line(line1) == "Setting access_token: ***REDACTED***"

        line2 = "client_secret: 'shhh_top_secret_value'"
        assert sanitize_log_line(line2) == "client_secret: '***REDACTED***'"

        line3 = "ha_key = special_ha_secret_pass"
        assert sanitize_log_line(line3) == "ha_key = ***REDACTED***"

        line4 = '{"webhook_id": "wh_sec_99998888"}'
        assert sanitize_log_line(line4) == '{"webhook_id": "***REDACTED***"}'

        line5 = '{"private_key": "MIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQC"}'
        assert sanitize_log_line(line5) == '{"private_key": "***REDACTED***"}'

    def test_multiple_secrets_in_single_line(self):
        line = "Auth with Authorization: Bearer token123 and api_key=key456 for password: secretpass"
        redacted = sanitize_log_line(line)
        assert "token123" not in redacted
        assert "key456" not in redacted
        assert "secretpass" not in redacted
        assert "Authorization: Bearer ***REDACTED*** and api_key=***REDACTED*** for password: ***REDACTED***" in redacted


class TestIsProtectedPath:
    """Test helper for identifying protected system files and path traversal."""

    def test_empty_and_null_bytes(self):
        assert is_protected_path(None) is True
        assert is_protected_path("safe/path\0null") is True
        assert is_protected_path("") is False
        assert is_protected_path(".") is False

    def test_traversal_paths(self):
        assert is_protected_path("dashboards/../../secrets.yaml") is True
        assert is_protected_path("../secrets.yaml") is True

    def test_protected_deny_list_patterns(self):
        assert is_protected_path("secrets.yaml") is True
        assert is_protected_path("nested/secrets.yaml") is True
        assert is_protected_path("ip_bans.yaml") is True
        assert is_protected_path("server.pem") is True
        assert is_protected_path("private.key") is True
        assert is_protected_path("id_rsa") is True
        assert is_protected_path("id_rsa.pub") is True

    def test_protected_relative_paths(self):
        assert is_protected_path(".storage/core.auth") is True
        assert is_protected_path(".storage/core.auth.bak") is True
        assert is_protected_path(".storage/core.config_entries") is True
        assert is_protected_path(".storage/core.config_entries/sub") is True

    def test_safe_paths(self):
        assert is_protected_path("configuration.yaml") is False
        assert is_protected_path("automations.yaml") is False
        assert is_protected_path("dashboards/living_room.yaml") is False
        assert is_protected_path("themes/dark.yaml") is False

