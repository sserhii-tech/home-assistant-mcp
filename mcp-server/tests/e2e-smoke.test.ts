import { describe, it, expect, beforeAll, afterAll } from "vitest";
import http from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { AddressInfo } from "node:net";

import { HARestClient } from "../src/clients/ha-rest.js";
import { HAWsClient } from "../src/clients/ha-ws.js";
import { AddonClient } from "../src/clients/addon-client.js";
import { DashboardRenderer } from "../src/browser/renderer.js";
import { createServer } from "../src/index.js";
import type { ToolClients } from "../src/tools/types.js";
import {
  handleSystemHealth,
  handleSystemListEntities,
  handleSystemGetLogs,
  handleSystemRestoreBackup,
} from "../src/tools/system.js";
import {
  handleDashboardSaveConfig,
  handleDashboardRenderScreenshot,
  handleDashboardGetConfig,
} from "../src/tools/dashboard.js";

describe("End-to-End Integration Smoke Test Suite", () => {
  let haHttpServer: http.Server;
  let haWss: WebSocketServer;
  let addonHttpServer: http.Server;

  let haUrl: string;
  let addonUrl: string;

  const HA_TEST_TOKEN = "e2e-test-ha-token-secret-12345";
  const ADDON_TEST_KEY = "e2e-test-addon-api-key-999";

  // In-memory mock addon filesystem & snapshots
  const mockFileSystem = new Map<string, string>();
  const mockSnapshots: Array<{
    snapshot_id: string;
    timestamp: string;
    original_file: string;
    backup_file: string;
    label: string;
    file_size_bytes: number;
    savedContent: string;
  }> = [];

  let toolClients: ToolClients;
  let mcpServerInstance: any;

  beforeAll(async () => {
    // 1. Initial files in addon storage
    mockFileSystem.set(
      "ui-lovelace.yaml",
      "title: Original Home Dashboard\nviews:\n  - title: Main View\n    cards:\n      - type: entities\n        entities:\n          - light.living_room\n"
    );
    mockFileSystem.set(
      "automations.yaml",
      "- id: '1700000000001'\n  alias: Evening Ambient Lighting\n  trigger:\n    - platform: sun\n      event: sunset\n  action:\n    - service: light.turn_on\n      target:\n        entity_id: light.living_room\n"
    );
    mockFileSystem.set("configuration.yaml", "default_config:\nsun:\nfrontend:\n");

    // 2. Setup Mock Home Assistant HTTP + WebSocket Server
    haHttpServer = http.createServer((req, res) => {
      // Check auth header for REST endpoints
      if (req.url?.startsWith("/api/")) {
        const authHeader = req.headers.authorization;
        if (authHeader !== `Bearer ${HA_TEST_TOKEN}`) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Unauthorized: Invalid or missing bearer token" }));
          return;
        }
      }

      // REST /api/
      if (req.url === "/api/" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "API running.", version: "2026.8.0" }));
        return;
      }

      // REST /api/states
      if (req.url === "/api/states" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              entity_id: "light.living_room",
              state: "on",
              attributes: {
                friendly_name: "Living Room Main Light",
                brightness: 255,
                supported_color_modes: ["brightness", "color_temp"],
              },
              last_changed: "2026-08-31T08:00:00.000Z",
              last_updated: "2026-08-31T08:00:00.000Z",
            },
            {
              entity_id: "sensor.living_room_temperature",
              state: "22.4",
              attributes: {
                friendly_name: "Living Room Temperature",
                unit_of_measurement: "°C",
                device_class: "temperature",
              },
              last_changed: "2026-08-31T08:00:00.000Z",
              last_updated: "2026-08-31T08:00:00.000Z",
            },
            {
              entity_id: "automation.evening_ambient_lighting",
              state: "on",
              attributes: {
                friendly_name: "Evening Ambient Lighting",
                last_triggered: "2026-08-30T19:30:00.000Z",
              },
              last_changed: "2026-08-30T19:30:00.000Z",
              last_updated: "2026-08-30T19:30:00.000Z",
            },
          ])
        );
        return;
      }

      // REST /api/services/automation/reload
      if (req.url === "/api/services/automation/reload" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify([{ success: true }]));
        return;
      }

      // Lovelace UI dashboard page for Playwright rendering
      if (req.url === "/lovelace/0" || req.url === "/lovelace" || req.url?.startsWith("/lovelace")) {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end(`
          <!DOCTYPE html>
          <html lang="en">
            <head>
              <meta charset="utf-8" />
              <title>Home Assistant Dashboard</title>
              <style>
                body {
                  margin: 0;
                  padding: 24px;
                  background: #0d1117;
                  color: #c9d1d9;
                  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
                }
                home-assistant-main {
                  display: block;
                }
                hui-view {
                  display: grid;
                  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
                  gap: 16px;
                }
                ha-card {
                  display: block;
                  background: #161b22;
                  border: 1px solid #30363d;
                  border-radius: 12px;
                  padding: 20px;
                  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
                }
                .title {
                  font-size: 1.2rem;
                  font-weight: 600;
                  color: #58a6ff;
                  margin-bottom: 8px;
                }
                .state {
                  font-size: 1.5rem;
                  font-weight: bold;
                  color: #3fb950;
                }
              </style>
            </head>
            <body>
              <home-assistant-main>
                <header>
                  <h1 id="dash-title">Modern Living Dashboard</h1>
                </header>
                <hui-view>
                  <ha-card id="card-light">
                    <div class="title">Living Room Light</div>
                    <div class="state">ON (100%)</div>
                  </ha-card>
                  <ha-card id="card-sensor">
                    <div class="title">Living Room Temperature</div>
                    <div class="state">22.4 °C</div>
                  </ha-card>
                </hui-view>
              </home-assistant-main>
            </body>
          </html>
        `);
        return;
      }

      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    });

    await new Promise<void>((resolve) => {
      haHttpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const haAddr = haHttpServer.address() as AddressInfo;
    haUrl = `http://127.0.0.1:${haAddr.port}`;

    // WebSocket Server attached to HA HTTP server
    haWss = new WebSocketServer({ server: haHttpServer, path: "/api/websocket" });
    haWss.on("connection", (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: "auth_required", ha_version: "2026.8.0" }));

      ws.on("message", (raw: string) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "auth") {
            if (msg.access_token === HA_TEST_TOKEN) {
              ws.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.8.0" }));
            } else {
              ws.send(JSON.stringify({ type: "auth_invalid", message: "Invalid token" }));
              ws.close();
            }
            return;
          }

          if (msg.type === "lovelace/config") {
            ws.send(
              JSON.stringify({
                id: msg.id,
                type: "result",
                success: true,
                result: {
                  title: "Modern Living Dashboard",
                  views: [
                    {
                      title: "Main View",
                      cards: [
                        { type: "light", entity: "light.living_room" },
                        { type: "sensor", entity: "sensor.living_room_temperature" },
                      ],
                    },
                  ],
                },
              })
            );
            return;
          }

          if (msg.type === "lovelace/config/save") {
            ws.send(
              JSON.stringify({
                id: msg.id,
                type: "result",
                success: true,
                result: null,
              })
            );
            return;
          }

          if (msg.type === "get_states") {
            ws.send(
              JSON.stringify({
                id: msg.id,
                type: "result",
                success: true,
                result: [
                  { entity_id: "light.living_room", state: "on" },
                  { entity_id: "sensor.living_room_temperature", state: "22.4" },
                ],
              })
            );
            return;
          }
        } catch {
          // ignore
        }
      });
    });

    // 3. Setup Mock Addon Server (FastAPI replication)
    addonHttpServer = http.createServer(async (req, res) => {
      const authKey = req.headers["x-addon-api-key"];
      if (authKey !== ADDON_TEST_KEY) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Invalid or missing X-Addon-API-Key header" }));
        return;
      }

      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      let body: any = {};
      if (chunks.length > 0) {
        try {
          body = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          body = {};
        }
      }

      // /api/v1/health
      if (req.url === "/api/v1/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            version: "0.1.0",
            config_root: "/config",
            snapshots_count: mockSnapshots.length,
            memory_mb: 28.5,
          })
        );
        return;
      }

      // /api/v1/file/read
      if (req.url === "/api/v1/file/read" && req.method === "POST") {
        const filePath = body.path;
        if (!filePath || !mockFileSystem.has(filePath)) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: `File not found: ${filePath}` }));
          return;
        }
        const content = mockFileSystem.get(filePath)!;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            path: filePath,
            content,
            size_bytes: Buffer.byteLength(content, "utf-8"),
          })
        );
        return;
      }

      // /api/v1/file/write
      if (req.url === "/api/v1/file/write" && req.method === "POST") {
        const filePath = body.path;
        const content = body.content ?? "";
        const label = body.label || "auto-backup";

        // Snapshot existing file if present
        let snapshotId = "";
        if (mockFileSystem.has(filePath)) {
          const oldContent = mockFileSystem.get(filePath)!;
          const ts = new Date().toISOString().replace(/[-:T.Z]/g, "").slice(0, 14);
          const sanitizedName = filePath.replace(/[^a-zA-Z0-9_]/g, "_");
          snapshotId = `snap_${ts}_${sanitizedName}`;

          mockSnapshots.push({
            snapshot_id: snapshotId,
            timestamp: new Date().toISOString(),
            original_file: filePath,
            backup_file: `.snapshots/${filePath}.${ts}.bak`,
            label,
            file_size_bytes: Buffer.byteLength(oldContent, "utf-8"),
            savedContent: oldContent,
          });
        }

        mockFileSystem.set(filePath, content);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            path: filePath,
            snapshot_id: snapshotId || "snap_initial",
            bytes_written: Buffer.byteLength(content, "utf-8"),
          })
        );
        return;
      }

      // /api/v1/backup/list
      if (req.url === "/api/v1/backup/list" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify(
            mockSnapshots.map((s) => ({
              snapshot_id: s.snapshot_id,
              timestamp: s.timestamp,
              original_file: s.original_file,
              backup_file: s.backup_file,
              label: s.label,
              file_size_bytes: s.file_size_bytes,
            }))
          )
        );
        return;
      }

      // /api/v1/backup/restore
      if (req.url === "/api/v1/backup/restore" && req.method === "POST") {
        const snap = mockSnapshots.find((s) => s.snapshot_id === body.snapshot_id);
        if (!snap) {
          res.writeHead(404, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: `Snapshot not found: ${body.snapshot_id}` }));
          return;
        }

        // Restore content
        mockFileSystem.set(snap.original_file, snap.savedContent);

        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            restored_file: snap.original_file,
            restored_from: snap.backup_file,
            safety_backup: `.snapshots/${snap.original_file}.safety.bak`,
          })
        );
        return;
      }

      // /api/v1/logs/tail
      if (req.url?.startsWith("/api/v1/logs/tail") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            lines: [
              "2026-08-31 08:00:00.120 INFO (MainThread) [homeassistant.core] Starting Home Assistant 2026.8.0",
              "2026-08-31 08:00:01.450 INFO (MainThread) [homeassistant.components.http] Authenticated client with token: ***REDACTED***",
              "2026-08-31 08:00:02.890 INFO (MainThread) [homeassistant.components.automation] Loaded 1 active automation",
              "2026-08-31 08:00:05.100 INFO (MainThread) [homeassistant.components.lovelace] Dashboard reloaded successfully",
            ],
            count: 4,
          })
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      addonHttpServer.listen(0, "127.0.0.1", () => resolve());
    });
    const addonAddr = addonHttpServer.address() as AddressInfo;
    addonUrl = `http://127.0.0.1:${addonAddr.port}`;

    // 4. Initialize ToolClients and McpServer
    toolClients = {
      restClient: new HARestClient({ haUrl, haToken: HA_TEST_TOKEN }),
      wsClient: new HAWsClient({ haUrl, haToken: HA_TEST_TOKEN }),
      addonClient: new AddonClient({ addonUrl, addonKey: ADDON_TEST_KEY }),
      renderer: new DashboardRenderer({ haUrl, haToken: HA_TEST_TOKEN }),
    };

    const created = createServer(toolClients);
    mcpServerInstance = created.server;
  });

  afterAll(async () => {
    if (toolClients?.renderer) {
      await toolClients.renderer.close();
    }
    if (toolClients?.wsClient) {
      await toolClients.wsClient.disconnect();
    }
    await new Promise<void>((resolve) => haHttpServer.close(() => resolve()));
    await new Promise<void>((resolve) => addonHttpServer.close(() => resolve()));
  });

  it("Step 1 (Tool: ha_system_health): Verifies connectivity across HA Core API & Addon API", async () => {
    const healthResult = await handleSystemHealth(toolClients);
    expect(healthResult.isError).toBeFalsy();
    expect(healthResult.content).toHaveLength(1);

    const report = JSON.parse(healthResult.content[0].text);
    expect(report.status).toBe("ok");
    expect(report.homeassistant.api).toBe("ok");
    expect(report.addon.status).toBe("ok");
    expect(report.addon.version).toBe("0.1.0");
    expect(report.addon.config_root).toBe("/config");
  });

  it("Step 2 (Tool: ha_system_list_entities): Fetches and filters live Home Assistant entities", async () => {
    const listResult = await handleSystemListEntities(toolClients, {
      domain_filter: "light",
      search_query: "living",
    });
    expect(listResult.isError).toBeFalsy();

    const entities = JSON.parse(listResult.content[0].text);
    expect(Array.isArray(entities)).toBe(true);
    expect(entities).toHaveLength(1);
    expect(entities[0].entity_id).toBe("light.living_room");
    expect(entities[0].friendly_name).toBe("Living Room Main Light");
    expect(entities[0].state).toBe("on");
  });

  let createdSnapshotId = "";
  const updatedLovelaceYaml = `title: Modern Living Dashboard Updated
views:
  - title: Living Room Pro
    cards:
      - type: light
        entity: light.living_room
      - type: sensor
        entity: sensor.living_room_temperature
`;

  it("Step 3 (Tool: ha_dashboard_save_config): Saves new dashboard YAML and triggers automatic pre-snapshot creation", async () => {
    // Check original content before saving
    const originalConfig = await handleDashboardGetConfig(toolClients, { dashboard_slug: "lovelace" });
    expect(originalConfig.isError).toBeFalsy();

    // Perform save
    const saveResult = await handleDashboardSaveConfig(toolClients, {
      config_yaml: updatedLovelaceYaml,
      dashboard_slug: "lovelace",
      label: "e2e visual upgrade test",
    });

    expect(saveResult.isError).toBeFalsy();
    expect(saveResult.content[0].text).toContain("Dashboard configuration successfully saved");
    expect(saveResult.content[0].text).toContain("Snapshot ID: snap_");

    // Extract created snapshot ID from message or addon snapshot list
    const snapshots = await toolClients.addonClient.listSnapshots();
    expect(snapshots.length).toBeGreaterThan(0);
    const lastSnap = snapshots[snapshots.length - 1];
    createdSnapshotId = lastSnap.snapshot_id;
    expect(createdSnapshotId).toMatch(/^snap_\d+_/);
    expect(lastSnap.original_file).toBe("ui-lovelace.yaml");
    expect(lastSnap.label).toBe("e2e visual upgrade test");

    // Verify file content in addon was updated
    expect(mockFileSystem.get("ui-lovelace.yaml")).toBe(updatedLovelaceYaml);
  });

  it("Step 4 (Tool: ha_dashboard_render_screenshot): Renders dashboard in Playwright and returns base64 PNG data", async () => {
    const renderResult = await handleDashboardRenderScreenshot(toolClients, {
      url_path: "lovelace/0",
      device_preset: "desktop",
      dark_mode: true,
      element_selector: "#card-light",
    });

    expect(renderResult.isError).toBeFalsy();
    expect(renderResult.content).toHaveLength(2);

    const imageItem = renderResult.content[0] as any;
    expect(imageItem.type).toBe("image");
    expect(imageItem.mimeType).toBe("image/png");
    expect(typeof imageItem.data).toBe("string");
    expect(imageItem.data.length).toBeGreaterThan(100);

    const textItem = renderResult.content[1];
    expect(textItem.type).toBe("text");
    expect(textItem.text).toContain("Dashboard screenshot rendered");
    expect(textItem.text).toContain("1920x1080");
    expect(textItem.text).toContain("#card-light");

    // Validate PNG Magic Header from Base64 decoded data
    const imageBuf = Buffer.from(imageItem.data, "base64");
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(imageBuf.subarray(0, 8)).toEqual(pngMagic);
  });

  it("Step 5 (Tool: ha_system_restore_backup): Performs atomic rollback to the pre-edit snapshot", async () => {
    expect(createdSnapshotId).toBeTruthy();

    const restoreResult = await handleSystemRestoreBackup(toolClients, {
      snapshot_id: createdSnapshotId,
    });

    expect(restoreResult.isError).toBeFalsy();
    expect(restoreResult.content[0].text).toContain("Successfully restored backup");
    expect(restoreResult.content[0].text).toContain("ui-lovelace.yaml");

    // Verify file in addon storage was rolled back to original content
    const currentFile = mockFileSystem.get("ui-lovelace.yaml");
    expect(currentFile).toContain("Original Home Dashboard");
    expect(currentFile).not.toContain("Modern Living Dashboard Updated");
  });

  it("Step 6 (Tool: ha_system_get_logs): Retrieves sanitized Home Assistant core logs with secrets redacted", async () => {
    const logsResult = await handleSystemGetLogs(toolClients, { lines_count: 50 });
    expect(logsResult.isError).toBeFalsy();
    expect(logsResult.content).toHaveLength(1);

    const logsText = logsResult.content[0].text;
    expect(logsText).toContain("Starting Home Assistant 2026.8.0");
    expect(logsText).toContain("***REDACTED***");
    expect(logsText).not.toContain(HA_TEST_TOKEN);
    expect(logsText).not.toContain(ADDON_TEST_KEY);
  });

  it("McpServer Instance Validation: All 12 tools are registered on server instance", () => {
    const registeredTools = (mcpServerInstance as any)._registeredTools;
    expect(registeredTools).toBeDefined();

    const expectedToolNames = [
      "ha_dashboard_get_config",
      "ha_dashboard_save_config",
      "ha_dashboard_render_screenshot",
      "ha_automation_list",
      "ha_automation_read",
      "ha_automation_write",
      "ha_automation_trigger",
      "ha_system_health",
      "ha_system_list_entities",
      "ha_system_get_logs",
      "ha_system_create_backup",
      "ha_system_restore_backup",
      "ha_system_call_service",
      "ha_audit_get_logs",
      "ha_agent_issue_token",
      "ha_agent_list_policies",
    ];

    for (const toolName of expectedToolNames) {
      expect(registeredTools[toolName], `McpServer should register tool ${toolName}`).toBeDefined();
    }
    expect(Object.keys(registeredTools).length).toBe(16);
  });
});
