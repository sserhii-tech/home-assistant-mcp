import { describe, it, expect, beforeEach, vi } from "vitest";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  handleDashboardGetConfig,
  handleDashboardSaveConfig,
  handleDashboardRenderScreenshot,
  registerDashboardTools,
} from "../src/tools/dashboard.js";
import {
  handleAutomationList,
  handleAutomationRead,
  handleAutomationWrite,
  handleAutomationTrigger,
  registerAutomationTools,
} from "../src/tools/automation.js";
import {
  handleSystemHealth,
  handleSystemListEntities,
  handleSystemGetLogs,
  handleSystemCreateBackup,
  handleSystemRestoreBackup,
  registerSystemTools,
} from "../src/tools/system.js";
import { createServer } from "../src/index.js";
import type { ToolClients } from "../src/tools/types.js";

describe("MCP Tools Suite", () => {
  let mockClients: ToolClients;

  beforeEach(() => {
    mockClients = {
      restClient: {
        haUrl: "http://127.0.0.1:8123",
        haToken: "test-ha-token",
        checkApi: vi.fn().mockResolvedValue({ message: "API running." }),
        getStates: vi.fn().mockResolvedValue([
          {
            entity_id: "light.living_room",
            state: "on",
            attributes: { friendly_name: "Living Room Light", brightness: 255 },
            last_changed: "2026-08-31T08:00:00.000Z",
            last_updated: "2026-08-31T08:00:00.000Z",
          },
          {
            entity_id: "sensor.temperature",
            state: "21.5",
            attributes: { friendly_name: "Living Room Temp", unit_of_measurement: "°C" },
            last_changed: "2026-08-31T08:00:00.000Z",
            last_updated: "2026-08-31T08:00:00.000Z",
          },
          {
            entity_id: "automation.evening_lights",
            state: "on",
            attributes: {
              friendly_name: "Turn On Evening Lights",
              last_triggered: "2026-08-30T19:00:00.000Z",
            },
            last_changed: "2026-08-30T19:00:00.000Z",
            last_updated: "2026-08-30T19:00:00.000Z",
          },
          {
            entity_id: "script.notify_all",
            state: "off",
            attributes: { friendly_name: "Send Notification to All" },
            last_changed: "2026-08-30T19:00:00.000Z",
            last_updated: "2026-08-30T19:00:00.000Z",
          },
        ]),
        callService: vi.fn().mockResolvedValue([{ success: true }]),
      } as any,

      wsClient: {
        haUrl: "http://127.0.0.1:8123",
        haToken: "test-ha-token",
        isConnected: true,
        connect: vi.fn().mockResolvedValue(undefined),
        disconnect: vi.fn().mockResolvedValue(undefined),
        getLovelaceConfig: vi.fn().mockResolvedValue({
          title: "Home",
          views: [{ title: "Main", cards: [] }],
        }),
        saveLovelaceConfig: vi.fn().mockResolvedValue(null),
        fetchStates: vi.fn().mockResolvedValue([]),
        sendMessage: vi.fn().mockResolvedValue({}),
      } as any,

      addonClient: {
        addonUrl: "http://127.0.0.1:8099",
        addonKey: "test-addon-key",
        checkHealth: vi.fn().mockResolvedValue({
          status: "ok",
          version: "1.0.0",
          config_root: "/config",
          snapshots_count: 5,
          memory_mb: 28.4,
        }),
        readFile: vi.fn().mockImplementation(async (filePath: string) => {
          if (filePath === "automations.yaml") {
            return {
              path: "automations.yaml",
              content: `- id: '1700000000001'\n  alias: Turn On Evening Lights\n  trigger:\n    - platform: sun\n      event: sunset\n  action:\n    - service: light.turn_on\n      target:\n        entity_id: light.living_room\n\n- id: '1700000000002'\n  alias: Morning Coffee\n  trigger:\n    - platform: time\n      at: '07:00:00'\n  action:\n    - service: switch.turn_on\n      target:\n        entity_id: switch.coffee_maker\n`,
              size_bytes: 350,
            };
          }
          if (filePath === "configuration.yaml") {
            return {
              path: "configuration.yaml",
              content: "default_config:\nsun:\n",
              size_bytes: 20,
            };
          }
          if (filePath === "ui-lovelace.yaml") {
            return {
              path: "ui-lovelace.yaml",
              content: "title: Fallback Lovelace\nviews: []\n",
              size_bytes: 35,
            };
          }
          throw new Error(`File not found: ${filePath}`);
        }),
        writeFile: vi.fn().mockResolvedValue({
          success: true,
          path: "automations.yaml",
          snapshot_id: "snap_20260831_120000_automations_yaml",
          bytes_written: 400,
        }),
        listSnapshots: vi.fn().mockResolvedValue([
          {
            snapshot_id: "snap_20260831_120000_automations_yaml",
            timestamp: "2026-08-31T12:00:00Z",
            original_file: "automations.yaml",
            backup_file: ".snapshots/automations.yaml.20260831_120000.bak",
            label: "pre-edit",
            file_size_bytes: 350,
          },
        ]),
        restoreSnapshot: vi.fn().mockResolvedValue({
          success: true,
          restored_file: "automations.yaml",
          restored_from: ".snapshots/automations.yaml.20260831_120000.bak",
          safety_backup: ".snapshots/automations.yaml.safety.bak",
        }),
        getLogs: vi.fn().mockResolvedValue({
          lines: [
            "2026-08-31 08:00:00 INFO (MainThread) [homeassistant.core] Starting Home Assistant",
            "2026-08-31 08:00:01 INFO (MainThread) [homeassistant.components.automation] Loaded 2 automations",
          ],
          count: 2,
        }),
        getAuditLogs: vi.fn().mockResolvedValue({ total_events: 1, events: [{ id: "1" }] }),
        issueAgentToken: vi.fn().mockResolvedValue({ agent_id: "a1", role: "r1", token: "tok1", expires_at: "2026" }),
        getAgentPolicies: vi.fn().mockResolvedValue({ roles: {}, agents: {} }),
      } as any,

      renderer: {
        isInitialized: true,
        initBrowser: vi.fn().mockResolvedValue(undefined),
        close: vi.fn().mockResolvedValue(undefined),
        captureDashboard: vi.fn().mockResolvedValue({
          imageBuffer: Buffer.from("fake-png-bytes"),
          base64Png: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
          width: 1920,
          height: 1080,
          url: "http://127.0.0.1:8123/lovelace/0",
        }),
      } as any,
    };
  });

  describe("Dashboard Tools", () => {
    it("ha_dashboard_get_config should return config via WebSocket", async () => {
      const res = await handleDashboardGetConfig(mockClients, { dashboard_slug: "lovelace" });
      expect(res.isError).toBeFalsy();
      expect(res.content).toHaveLength(1);
      expect(res.content[0].type).toBe("text");
      expect(res.content[0].text).toContain("Main");
      expect(mockClients.wsClient.getLovelaceConfig).toHaveBeenCalledWith("lovelace");
    });

    it("ha_dashboard_get_config should fall back to AddonClient when WS client is unavailable", async () => {
      (mockClients.wsClient.getLovelaceConfig as any).mockRejectedValueOnce(
        new Error("WS connection refused")
      );
      const res = await handleDashboardGetConfig(mockClients, {});
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Fallback Lovelace");
      expect(mockClients.addonClient.readFile).toHaveBeenCalledWith("ui-lovelace.yaml");
    });

    it("ha_dashboard_get_config should return error when both WS and file read fail", async () => {
      (mockClients.wsClient.getLovelaceConfig as any).mockRejectedValueOnce(
        new Error("WS error")
      );
      (mockClients.addonClient.readFile as any).mockRejectedValueOnce(
        new Error("File not found")
      );
      const res = await handleDashboardGetConfig(mockClients, { dashboard_slug: "unknown" });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to get dashboard configuration");
    });

    it("ha_dashboard_save_config should save config and create snapshot", async () => {
      const yamlContent = "title: Updated Dashboard\nviews: []\n";
      const res = await handleDashboardSaveConfig(mockClients, {
        config_yaml: yamlContent,
        dashboard_slug: "lovelace",
        label: "test update",
      });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("saved");
      expect(mockClients.addonClient.writeFile).toHaveBeenCalled();
    });

    it("ha_dashboard_save_config should also save to WS if config is valid JSON", async () => {
      const jsonContent = JSON.stringify({ title: "JSON Dashboard", views: [] });
      const res = await handleDashboardSaveConfig(mockClients, {
        config_yaml: jsonContent,
        dashboard_slug: "lovelace",
      });
      expect(res.isError).toBeFalsy();
      expect(mockClients.wsClient.saveLovelaceConfig).toHaveBeenCalled();
    });

    it("ha_dashboard_save_config should handle write error gracefully", async () => {
      (mockClients.addonClient.writeFile as any).mockRejectedValueOnce(
        new Error("Invalid YAML syntax")
      );
      const res = await handleDashboardSaveConfig(mockClients, {
        config_yaml: "invalid: [yaml",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Invalid YAML syntax");
    });

    it("ha_dashboard_render_screenshot should return image and metadata", async () => {
      const res = await handleDashboardRenderScreenshot(mockClients, {
        url_path: "lovelace/0",
        device_preset: "desktop",
        dark_mode: true,
        element_selector: "#card-light",
      });
      expect(res.isError).toBeFalsy();
      expect(res.content).toHaveLength(2);
      expect(res.content[0].type).toBe("image");
      expect((res.content[0] as any).mimeType).toBe("image/png");
      expect((res.content[0] as any).data).toBeDefined();
      expect(res.content[1].type).toBe("text");
      expect(res.content[1].text).toContain("1920x1080");
      expect(res.content[1].text).toContain("#card-light");
      expect(mockClients.renderer.captureDashboard).toHaveBeenCalledWith({
        urlPath: "lovelace/0",
        devicePreset: "desktop",
        darkMode: true,
        elementSelector: "#card-light",
      });
    });

    it("ha_dashboard_render_screenshot should handle renderer error gracefully", async () => {
      (mockClients.renderer.captureDashboard as any).mockRejectedValueOnce(
        new Error("Navigation timeout")
      );
      const res = await handleDashboardRenderScreenshot(mockClients, {
        url_path: "lovelace/nonexistent",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Navigation timeout");
    });
  });

  describe("Automation Tools", () => {
    it("ha_automation_list should list all automations by default", async () => {
      const res = await handleAutomationList(mockClients, {});
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].entity_id).toBe("automation.evening_lights");
    });

    it("ha_automation_list should filter by domain (e.g. script)", async () => {
      const res = await handleAutomationList(mockClients, { domain: "script" });
      expect(res.isError).toBeFalsy();
      const parsed = JSON.parse(res.content[0].text);
      expect(parsed).toHaveLength(1);
      expect(parsed[0].entity_id).toBe("script.notify_all");
    });

    it("ha_automation_list should handle API error gracefully", async () => {
      (mockClients.restClient.getStates as any).mockRejectedValueOnce(
        new Error("HA REST API error")
      );
      const res = await handleAutomationList(mockClients, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to list automations");
    });

    it("ha_automation_read should find and return target automation by id", async () => {
      const res = await handleAutomationRead(mockClients, { automation_id: "1700000000001" });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Turn On Evening Lights");
      expect(res.content[0].text).toContain("sunset");
    });

    it("ha_automation_read should find target automation by alias", async () => {
      const res = await handleAutomationRead(mockClients, { automation_id: "Morning Coffee" });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("switch.coffee_maker");
    });

    it("ha_automation_read should return error if automation not found", async () => {
      const res = await handleAutomationRead(mockClients, { automation_id: "nonexistent_id" });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("not found");
    });

    it("ha_automation_read should handle file read error gracefully", async () => {
      (mockClients.addonClient.readFile as any).mockRejectedValueOnce(
        new Error("Permission denied")
      );
      const res = await handleAutomationRead(mockClients, { automation_id: "1700000000001" });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Permission denied");
    });

    it("ha_automation_write should update an existing automation and reload", async () => {
      const updatedBlock = `- id: '1700000000001'\n  alias: Turn On Evening Lights Updated\n  trigger:\n    - platform: sun\n      event: sunset\n      offset: '-00:30:00'\n  action:\n    - service: light.turn_on\n      target:\n        entity_id: light.living_room\n`;
      const res = await handleAutomationWrite(mockClients, {
        automation_id: "1700000000001",
        yaml_code: updatedBlock,
        label: "update offset",
      });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("successfully saved");
      expect(mockClients.addonClient.writeFile).toHaveBeenCalledWith(
        "automations.yaml",
        expect.stringContaining("Turn On Evening Lights Updated"),
        expect.objectContaining({ validateYaml: true, label: "update offset" })
      );
      expect(mockClients.restClient.callService).toHaveBeenCalledWith("automation", "reload");
    });

    it("ha_automation_write should append new automation if id not found", async () => {
      const newBlock = `- id: '1700000000003'\n  alias: Night Lights\n  trigger: []\n  action: []\n`;
      const res = await handleAutomationWrite(mockClients, {
        automation_id: "1700000000003",
        yaml_code: newBlock,
      });
      expect(res.isError).toBeFalsy();
      expect(mockClients.addonClient.writeFile).toHaveBeenCalledWith(
        "automations.yaml",
        expect.stringContaining("Night Lights"),
        expect.anything()
      );
    });

    it("ha_automation_write should handle service reload error gracefully", async () => {
      (mockClients.restClient.callService as any).mockRejectedValueOnce(
        new Error("Reload service unavailable")
      );
      const res = await handleAutomationWrite(mockClients, {
        automation_id: "1700000000001",
        yaml_code: `- id: '1700000000001'\n  alias: Test\n`,
      });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("service reload failed");
    });

    it("ha_automation_write should handle file write failure", async () => {
      (mockClients.addonClient.writeFile as any).mockRejectedValueOnce(
        new Error("Invalid YAML structure")
      );
      const res = await handleAutomationWrite(mockClients, {
        automation_id: "1700000000001",
        yaml_code: "invalid",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to write automation");
    });

    it("ha_automation_trigger should trigger automation entity", async () => {
      const res = await handleAutomationTrigger(mockClients, {
        entity_id: "automation.evening_lights",
      });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Successfully triggered");
      expect(mockClients.restClient.callService).toHaveBeenCalledWith("automation", "trigger", {
        entity_id: "automation.evening_lights",
      });
    });

    it("ha_automation_trigger should handle trigger error gracefully", async () => {
      (mockClients.restClient.callService as any).mockRejectedValueOnce(
        new Error("Entity not found")
      );
      const res = await handleAutomationTrigger(mockClients, {
        entity_id: "automation.nonexistent",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to trigger");
    });
  });

  describe("System Tools", () => {
    it("ha_system_health should return combined health report", async () => {
      const res = await handleSystemHealth(mockClients);
      expect(res.isError).toBeFalsy();
      const report = JSON.parse(res.content[0].text);
      expect(report.status).toBe("ok");
      expect(report.addon.version).toBe("1.0.0");
      expect(report.homeassistant.api).toBe("ok");
    });

    it("ha_system_health should report degraded status when HA API fails", async () => {
      (mockClients.restClient.checkApi as any).mockRejectedValueOnce(
        new Error("Connection refused")
      );
      const res = await handleSystemHealth(mockClients);
      expect(res.isError).toBeFalsy();
      const report = JSON.parse(res.content[0].text);
      expect(report.status).toBe("degraded");
      expect(report.homeassistant.api).toBe("unreachable");
    });

    it("ha_system_list_entities should filter by domain and search query", async () => {
      const res = await handleSystemListEntities(mockClients, {
        domain_filter: "light",
        search_query: "living",
      });
      expect(res.isError).toBeFalsy();
      const entities = JSON.parse(res.content[0].text);
      expect(entities).toHaveLength(1);
      expect(entities[0].entity_id).toBe("light.living_room");
      expect(entities[0].friendly_name).toBe("Living Room Light");
    });

    it("ha_system_list_entities should handle error gracefully", async () => {
      (mockClients.restClient.getStates as any).mockRejectedValueOnce(
        new Error("Unauthorized")
      );
      const res = await handleSystemListEntities(mockClients, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to list entities");
    });

    it("ha_system_get_logs should return tailed log lines", async () => {
      const res = await handleSystemGetLogs(mockClients, { lines_count: 50 });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Starting Home Assistant");
      expect(mockClients.addonClient.getLogs).toHaveBeenCalledWith(50);
    });

    it("ha_system_get_logs should handle logs error gracefully", async () => {
      (mockClients.addonClient.getLogs as any).mockRejectedValueOnce(
        new Error("Log file locked")
      );
      const res = await handleSystemGetLogs(mockClients, {});
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to retrieve logs");
    });

    it("ha_system_create_backup should create snapshot and return snapshot ID", async () => {
      const res = await handleSystemCreateBackup(mockClients, { label: "manual backup before update" });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Backup created");
      expect(mockClients.addonClient.writeFile).toHaveBeenCalled();
    });

    it("ha_system_create_backup should handle backup creation error", async () => {
      (mockClients.addonClient.writeFile as any).mockRejectedValueOnce(
        new Error("Disk full")
      );
      const res = await handleSystemCreateBackup(mockClients, { label: "backup fail" });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to create backup snapshot");
    });

    it("ha_system_restore_backup should restore snapshot", async () => {
      const res = await handleSystemRestoreBackup(mockClients, {
        snapshot_id: "snap_20260831_120000_automations_yaml",
      });
      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Successfully restored");
      expect(mockClients.addonClient.restoreSnapshot).toHaveBeenCalledWith(
        "snap_20260831_120000_automations_yaml",
        { rationale: undefined }
      );
    });

    it("ha_system_restore_backup should handle restore failure", async () => {
      (mockClients.addonClient.restoreSnapshot as any).mockRejectedValueOnce(
        new Error("Snapshot not found")
      );
      const res = await handleSystemRestoreBackup(mockClients, {
        snapshot_id: "invalid_snap",
      });
      expect(res.isError).toBe(true);
      expect(res.content[0].text).toContain("Failed to restore backup snapshot");
    });
  });

  describe("MCP Server Tool Registration & Factory", () => {
    it("should register all tools on McpServer instance", () => {
      const server = new McpServer({ name: "ha-ai-mcp", version: "0.1.0" });
      registerDashboardTools(server, mockClients);
      registerAutomationTools(server, mockClients);
      registerSystemTools(server, mockClients);

      // Verify internal tool registrations
      const registeredTools = (server as any)._registeredTools;
      expect(registeredTools).toBeDefined();
      expect(registeredTools["ha_dashboard_get_config"]).toBeDefined();
      expect(registeredTools["ha_dashboard_save_config"]).toBeDefined();
      expect(registeredTools["ha_dashboard_render_screenshot"]).toBeDefined();
      expect(registeredTools["ha_automation_list"]).toBeDefined();
      expect(registeredTools["ha_automation_read"]).toBeDefined();
      expect(registeredTools["ha_automation_write"]).toBeDefined();
      expect(registeredTools["ha_automation_trigger"]).toBeDefined();
      expect(registeredTools["ha_system_health"]).toBeDefined();
      expect(registeredTools["ha_system_list_entities"]).toBeDefined();
      expect(registeredTools["ha_system_get_logs"]).toBeDefined();
      expect(registeredTools["ha_system_create_backup"]).toBeDefined();
      expect(registeredTools["ha_system_restore_backup"]).toBeDefined();
      expect(registeredTools["ha_system_call_service"]).toBeDefined();
    });

    it("createServer factory should initialize server and clients properly", () => {
      const { server, clients } = createServer(mockClients);
      expect(server).toBeDefined();
      expect(clients).toBe(mockClients);
      const registeredTools = (server as any)._registeredTools;
      expect(Object.keys(registeredTools).length).toBe(16);
    });
  });
});
