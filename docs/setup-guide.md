# Home Assistant AI Helper - Installation & Configuration Guide

This guide walks you through setting up the **Home Assistant AI Helper** app on your Home Assistant OS instance and configuring your local AI agent development environments (Antigravity, Gemini CLI, Claude Desktop, Claude Code, OpenCode, and Cursor).

---

## 1. Prerequisites

Before getting started, make sure you have:
1. **Home Assistant OS (HAOS)** or **Home Assistant Supervised** running (version 2024.1.0 or newer recommended).
2. **Node.js** 20+ and **npm** installed on your local workstation.
3. **Network reachability** from your local workstation to your Home Assistant instance (e.g. `http://homeassistant.local:8123` or your static LAN IP).

---

## 2. Home Assistant OS App Setup

The custom app provides the lightweight, paranoid-secure REST companion daemon (< 35MB RAM, ~0% idle CPU) running directly inside HAOS.

### Step 2.1: Add App Repository to Home Assistant

#### Method A: Via App Store Repository (Recommended)
1. Open your Home Assistant Web UI.
2. Navigate to **Settings** -> **Apps** -> **Install App**.
3. Click the three dots (top-right menu) and select **Repositories**.
4. Add your GitHub repository URL: `https://github.com/sserhii-tech/home-assistant-mcp`.
5. Click **Add** and then close the dialog.
6. Click **Check for updates**; **Home Assistant AI Helper** will appear in the App Store under your custom repository.

#### Method B: Manual Copy via Samba or SSH
1. Connect to your Home Assistant instance via Samba Share or SSH/SCP.
2. Navigate to the `/addons` directory on your Home Assistant host.
3. Copy the `ha-mcp-helper/` folder from this repository into `/addons/ha_mcp_helper`:
   ```bash
   # Example via SCP
   scp -r ha-mcp-helper/ root@homeassistant.local:/addons/ha_mcp_helper
   ```
4. Verify the folder structure on Home Assistant:
   ```
   /addons/ha_mcp_helper/
   ├── Dockerfile
   ├── README.md
   ├── config.yaml
   ├── run.sh
   └── app/
       ├── core/
       │   ├── config.py
       │   └── security.py
       ├── services/
       │   ├── file_service.py
       │   ├── snapshot_service.py
       │   └── log_service.py
       ├── api/
       │   ├── schemas.py
       │   └── routes/
       └── main.py
   ```

### Step 2.2: Install and Start the App

1. Open your Home Assistant Web UI.
2. Navigate to **Settings** -> **Apps** -> **Install app**.
3. Click the three dots (top-right menu) and select **Check for updates** / **Reload**.
4. Scroll down to the **** section **Home Assistant AI Repository** and click on **Home Assistant AI Helper**.
5. Click **Install**.
6. After installation completes, switch to the **Configuration** tab:
   - Set `api_key` to a strong random secret token (e.g., `ha_ai_sec_9f83b271a94e8c105e6b12`).
   - Click **Save**.
7. Switch back to the **Info** tab:
   - Enable **Start on boot** and **Watchdog** (optional, recommended).
   - Click **Start**.
8. Check the **Log** tab to confirm startup:
   ```text
   [INFO] Starting Home Assistant AI Helper Addon...
   [INFO] Config Root: /config
   [INFO] Listening on port 8099...
   INFO:     Started server process
   INFO:     Uvicorn running on http://0.0.0.0:8099
   ```

---

## 3. Generate Home Assistant Long-Lived Access Token

The local MCP Server requires a Long-Lived Access Token to interact with the Home Assistant Core REST and WebSocket APIs.

1. In Home Assistant, click on your user profile in the bottom-left corner.
2. Select the **Security** tab (or navigate directly to `/profile/security`).
3. Scroll to the bottom to find **Long-Lived Access Tokens**.
4. Click **Create Token**.
5. Enter a token name (e.g., `Antigravity AI MCP Helper`).
6. Copy and store the generated token in a safe password manager or environment file. *(You won't be able to see it again after closing the modal).*

---

## 4. Local MCP Server Installation

On your local workstation:

```bash
# Clone repository
git clone https://github.com/your-org/ha-ai.git
cd ha-ai

# Install root & workspace dependencies
npm install

# Build the TypeScript MCP server
npm run build
```

This compiles the TypeScript code in `mcp-server/src` to executable JavaScript in `mcp-server/dist/index.js`.

---

## 5. Environment Variables Reference

The MCP Server is configured using standard environment variables:

| Variable | Required | Default | Description |
| :--- | :---: | :--- | :--- |
| `HA_URL` | **Yes** | `http://localhost:8123` | Base URL of your Home Assistant instance (e.g. `http://192.168.1.100:8123` or `http://homeassistant.local:8123`). |
| `HA_TOKEN` | **Yes** | *(empty)* | Long-Lived Access Token generated in Step 3. |
| `ADDON_URL` | **Yes** | `http://localhost:8099` | Base URL of the AI Helper Addon daemon (e.g. `http://192.168.1.100:8099` or `http://homeassistant.local:8099`). |
| `ADDON_KEY` | **Yes** | *(empty)* | Secret API Key configured in the Addon UI in Step 2.2. |
| `BROWSER_STATE_DIR` | No | `~/.ha-ai` | Directory used by Playwright to cache authentication tokens and browser state. |

---

### 6.1 Claude Desktop, Cursor, & Antigravity (Recommended: `npx`)

No repository cloning or building required! Configure your MCP client (`claude_desktop_config.json`, `.cursor/mcp.json`, or Antigravity `mcp_config.json`):

```json
{
  "mcpServers": {
    "ha-ai": {
      "command": "npx",
      "args": [
        "-y",
        "ha-ai-mcp-server"
      ],
      "env": {
        "HA_URL": "http://<YOUR_HA_IP>:8123",
        "HA_TOKEN": "your-long-lived-access-token",
        "ADDON_URL": "http://<YOUR_HA_IP>:8099",
        "ADDON_KEY": "your-addon-api-key"
      }
    }
  }
}
```

### 6.2 Local Development / Source Build

If developing locally on the repository code:

```json
{
  "mcpServers": {
    "ha-ai": {
      "command": "node",
      "args": [
        "/path/to/home-assistant-mcp/mcp-server/dist/index.js"
      ],
      "env": {
        "HA_URL": "http://<YOUR_HA_IP>:8123",
        "HA_TOKEN": "your-long-lived-access-token",
        "ADDON_URL": "http://<YOUR_HA_IP>:8099",
        "ADDON_KEY": "your-addon-api-key"
      }
    }
  }
}
```

---

## 7. AI Skills Installation

To equip your AI agent with specialized domain knowledge for Home Assistant, copy or link the skill packages from `skills/` into your agent's skills directory (e.g. `~/.gemini/config/skills/`, `.cursor/rules/`, or your workspace skills directory):

1. **`ha-device-controller`**: SOP for querying live entity states, invoking domain services (`light`, `switch`, `climate`, `media_player`, `cover`), and validating state transitions.
2. **`ha-dashboard-designer`**: SOP for querying entities, drafting Lovelace YAML, capturing headless Playwright screenshots, and visual feedback refinement.
3. **`ha-automation-builder`**: SOP for drafting robust automations, syntax checking, safe saving with auto-reload, and live trigger testing.
4. **`ha-troubleshooter`**: SOP for inspecting sanitized error logs, diagnosing entity faults, and executing instantaneous snapshot rollbacks.

---

## 8. Verification & Diagnostics

Test the setup from your command line:

### Test 1: Verify App Health
```bash
curl -X GET http://192.168.1.100:8099/api/v1/health \
  -H "X-Addon-API-Key: your-addon-api-key"
```
**Expected Output:**
```json
{
  "status": "ok",
  "version": "1.0.0",
  "config_root": "/config",
  "snapshots_count": 0,
  "memory_mb": 24.8
}
```

### Test 2: Verify Home Assistant API
```bash
curl -X GET http://192.168.1.100:8123/api/ \
  -H "Authorization: Bearer your-long-lived-access-token"
```
**Expected Output:**
```json
{
  "message": "API running."
}
```

### Test 3: Run Full Local Test Suite
```bash
# Run TypeScript MCP test suite (including E2E smoke tests)
npm --prefix mcp-server test

# Run Python App security test suite
uv run --directory apps/ha-mcp-helper pytest tests/
```

### Test 4: Verify RBAC Policy & Audit Service
```bash
# Query the active policy roles from the daemon
curl -X GET http://192.168.1.100:8099/api/v1/agent/policies \
  -H "X-Addon-API-Key: your-addon-api-key"

# Query the immutable JSONL audit logs
curl -X GET http://192.168.1.100:8099/api/v1/audit/logs?limit=5 \
  -H "X-Addon-API-Key: your-addon-api-key"
```
