import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";
import { AddressInfo } from "node:net";

import { loadConfig } from "../src/config.js";
import { HARestClient } from "../src/clients/ha-rest.js";
import { AddonClient } from "../src/clients/addon-client.js";
import { HAWsClient } from "../src/clients/ha-ws.js";

describe("Configuration", () => {
  it("should load default configuration values when env is empty", () => {
    const config = loadConfig({});
    expect(config.haUrl).toBe("http://localhost:8123");
    expect(config.haToken).toBe("");
    expect(config.addonUrl).toBe("http://localhost:8099");
    expect(config.addonKey).toBe("");
    expect(config.agentKey).toBe("");
    expect(config.agentId).toBe("");
    expect(config.browserStateDir).toBeDefined();
    expect(config.browserStateDir).toContain(".ha-ai");
  });

  it("should load configuration from custom env variables", () => {
    const customEnv = {
      HA_URL: "https://my-ha.duckdns.org:8123/",
      HA_TOKEN: "custom-token-xyz",
      ADDON_URL: "http://homeassistant.local:8099///",
      ADDON_KEY: "secret-addon-key-123",
      AGENT_KEY: "sec_agent_custom_456",
      AGENT_ID: "agent_orchestrator",
      BROWSER_STATE_DIR: "/tmp/custom-ha-ai",
    };
    const config = loadConfig(customEnv);
    expect(config.haUrl).toBe("https://my-ha.duckdns.org:8123");
    expect(config.haToken).toBe("custom-token-xyz");
    expect(config.addonUrl).toBe("http://homeassistant.local:8099");
    expect(config.addonKey).toBe("secret-addon-key-123");
    expect(config.agentKey).toBe("sec_agent_custom_456");
    expect(config.agentId).toBe("agent_orchestrator");
    expect(config.browserStateDir).toBe("/tmp/custom-ha-ai");
  });
});

describe("HARestClient", () => {
  let server: http.Server;
  let serverUrl: string;
  let lastHeaders: http.IncomingHttpHeaders;
  let lastRequestBody: any;

  beforeEach(async () => {
    lastHeaders = {};
    lastRequestBody = null;
    server = http.createServer(async (req, res) => {
      lastHeaders = req.headers;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) {
        try {
          lastRequestBody = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          lastRequestBody = Buffer.concat(chunks).toString("utf-8");
        }
      }

      if (req.url === "/api/" && req.method === "GET") {
        if (req.headers.authorization !== "Bearer test-ha-token") {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ message: "Unauthorized" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "API running." }));
        return;
      }

      if (req.url === "/api/states" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              entity_id: "light.living_room",
              state: "on",
              attributes: { brightness: 255, friendly_name: "Living Room Light" },
              last_changed: "2026-08-31T08:00:00.000Z",
              last_updated: "2026-08-31T08:00:00.000Z",
            },
          ])
        );
        return;
      }

      if (req.url === "/api/services/light/turn_on" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              entity_id: "light.living_room",
              state: "on",
            },
          ])
        );
        return;
      }

      if (req.url === "/api/error" && req.method === "GET") {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "Internal server error" }));
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should check API status and pass Bearer token", async () => {
    const client = new HARestClient({ haUrl: serverUrl, haToken: "test-ha-token" });
    const response = await client.checkApi();
    expect(response).toEqual({ message: "API running." });
    expect(lastHeaders.authorization).toBe("Bearer test-ha-token");
  });

  it("should fail checkApi with invalid token", async () => {
    const client = new HARestClient({ haUrl: serverUrl, haToken: "invalid-token" });
    await expect(client.checkApi()).rejects.toThrow(/401|Unauthorized/i);
  });

  it("should get entity states", async () => {
    const client = new HARestClient({ haUrl: serverUrl, haToken: "test-ha-token" });
    const states = await client.getStates();
    expect(states).toHaveLength(1);
    expect(states[0].entity_id).toBe("light.living_room");
    expect(states[0].state).toBe("on");
  });

  it("should call a service with service data", async () => {
    const client = new HARestClient({ haUrl: serverUrl, haToken: "test-ha-token" });
    const result = await client.callService("light", "turn_on", {
      entity_id: "light.living_room",
      brightness: 128,
    });
    expect(result).toHaveLength(1);
    expect(lastRequestBody).toEqual({
      entity_id: "light.living_room",
      brightness: 128,
    });
  });
});

describe("AddonClient", () => {
  let server: http.Server;
  let serverUrl: string;
  let lastHeaders: http.IncomingHttpHeaders;
  let lastRequestBody: any;
  let lastReqUrl: string | undefined;

  beforeEach(async () => {
    lastHeaders = {};
    lastRequestBody = null;
    lastReqUrl = undefined;
    server = http.createServer(async (req, res) => {
      lastHeaders = req.headers;
      lastReqUrl = req.url;
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk);
      }
      if (chunks.length > 0) {
        try {
          lastRequestBody = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        } catch {
          lastRequestBody = Buffer.concat(chunks).toString("utf-8");
        }
      }

      if (
        req.headers["x-addon-api-key"] !== "test-addon-key" &&
        req.headers["x-addon-api-key"] !== "test-agent-key"
      ) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "Invalid or missing X-Addon-API-Key header" }));
        return;
      }

      if (req.url === "/api/v1/health" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            status: "ok",
            version: "1.0.0",
            config_root: "/config",
            snapshots_count: 3,
            memory_mb: 24.5,
          })
        );
        return;
      }

      if (req.url === "/api/v1/file/read" && req.method === "POST") {
        if (lastRequestBody?.path === "configuration.yaml") {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              path: "configuration.yaml",
              content: "default_config:\n",
              size_bytes: 16,
            })
          );
          return;
        }
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ detail: "File not found" }));
        return;
      }

      if (req.url === "/api/v1/file/write" && req.method === "POST") {
        if (lastRequestBody?.validate_yaml && lastRequestBody?.content === "invalid: yaml: [") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Invalid YAML syntax" }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            path: lastRequestBody?.path,
            snapshot_id: "snap_20260831_123456_configuration_yaml",
            bytes_written: 32,
          })
        );
        return;
      }

      if (req.url === "/api/v1/backup/list" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify([
            {
              snapshot_id: "snap_20260831_123456_configuration_yaml",
              timestamp: "2026-08-31T08:00:00Z",
              original_file: "configuration.yaml",
              backup_file: ".snapshots/configuration.yaml.20260831_123456.bak",
              label: "before update",
              file_size_bytes: 16,
            },
          ])
        );
        return;
      }

      if (req.url === "/api/v1/backup/restore" && req.method === "POST") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            restored_file: "configuration.yaml",
            restored_from: ".snapshots/configuration.yaml.20260831_123456.bak",
            safety_backup: ".snapshots/configuration.yaml.safety.bak",
          })
        );
        return;
      }

      if (req.url?.startsWith("/api/v1/logs/tail") && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            lines: ["2026-08-31 INFO Home Assistant started", "2026-08-31 INFO Auth successful for ***REDACTED***"],
            count: 2,
          })
        );
        return;
      }

      if (req.url?.startsWith("/api/v1/audit/logs") && req.method === "GET") {
        const parsedUrl = new URL(req.url, "http://127.0.0.1");
        if (parsedUrl.searchParams.get("role") === "forbidden_role") {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: { error: "ForbiddenByPolicy", message: "Role forbidden" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            total_events: 1,
            events: [
              {
                id: "aud_123456789abc",
                timestamp: "2026-09-19T12:00:00Z",
                agent_id: parsedUrl.searchParams.get("agent_id") || "agent_designer",
                role: "dashboard_designer",
                action: "file_write",
                tool: "ha_dashboard_save_config",
                target: "ui-lovelace.yaml",
                status: "allowed",
                reason: "Allowed by role",
                rationale: req.headers["x-agent-rationale"] || "Update cards",
              },
            ],
          })
        );
        return;
      }

      if (req.url === "/api/v1/agent/token" && req.method === "POST") {
        if (lastRequestBody?.role === "invalid_role") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: "Role 'invalid_role' is not defined in policies" }));
          return;
        }
        if (lastRequestBody?.agent_id === "forbidden_agent") {
          res.writeHead(403, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ detail: { error: "ForbiddenByPolicy", message: "Only admin can issue tokens" } }));
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            agent_id: lastRequestBody?.agent_id,
            role: lastRequestBody?.role,
            token: "sec_agent_ephem_abc123456789",
            expires_at: "2026-09-19T13:00:00Z",
          })
        );
        return;
      }

      if (req.url === "/api/v1/agent/policies" && req.method === "GET") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            roles: {
              admin: { description: "Full admin access", allow_tools: ["*"] },
              guest: { description: "Read-only access", allow_tools: ["ha_system_health"] },
            },
            agents: {
              designer_bot: { role: "dashboard_designer", description: "UI designer" },
            },
          })
        );
        return;
      }

      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ detail: "Not found" }));
    });

    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const addr = server.address() as AddressInfo;
    serverUrl = `http://127.0.0.1:${addr.port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it("should check addon health with API key", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const health = await client.checkHealth();
    expect(health.status).toBe("ok");
    expect(health.snapshots_count).toBe(3);
    expect(lastHeaders["x-addon-api-key"]).toBe("test-addon-key");
  });

  it("should prefer agentKey when provided in options", async () => {
    const client = new AddonClient({
      addonUrl: serverUrl,
      addonKey: "fallback-key",
      agentKey: "test-agent-key",
    });
    const health = await client.checkHealth();
    expect(health.status).toBe("ok");
    expect(lastHeaders["x-addon-api-key"]).toBe("test-agent-key");
  });

  it("should fail when API key is invalid", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "wrong-key" });
    await expect(client.checkHealth()).rejects.toThrow(/401|Invalid or missing/i);
  });

  it("should read file content", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const file = await client.readFile("configuration.yaml");
    expect(file.path).toBe("configuration.yaml");
    expect(file.content).toBe("default_config:\n");
    expect(lastRequestBody).toEqual({ path: "configuration.yaml" });
  });

  it("should write file content with optional yaml validation, label, and rationale header", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const result = await client.writeFile("configuration.yaml", "default_config:\nsun:\n", {
      validateYaml: true,
      label: "add sun component",
      rationale: "Automated configuration update",
    });
    expect(result.success).toBe(true);
    expect(result.snapshot_id).toBe("snap_20260831_123456_configuration_yaml");
    expect(lastRequestBody).toEqual({
      path: "configuration.yaml",
      content: "default_config:\nsun:\n",
      validate_yaml: true,
      label: "add sun component",
    });
    expect(lastHeaders["x-agent-rationale"]).toBe("Automated configuration update");
  });

  it("should fail write file when YAML is invalid", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    await expect(
      client.writeFile("configuration.yaml", "invalid: yaml: [", { validateYaml: true })
    ).rejects.toThrow(/400|Invalid YAML/i);
  });

  it("should list snapshots", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const snapshots = await client.listSnapshots();
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].snapshot_id).toBe("snap_20260831_123456_configuration_yaml");
  });

  it("should restore snapshot", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const restore = await client.restoreSnapshot("snap_20260831_123456_configuration_yaml");
    expect(restore.success).toBe(true);
    expect(restore.restored_file).toBe("configuration.yaml");
    expect(lastRequestBody).toEqual({
      snapshot_id: "snap_20260831_123456_configuration_yaml",
    });
  });

  it("should get tail logs", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const logs = await client.getLogs(50);
    expect(logs.count).toBe(2);
    expect(logs.lines[0]).toContain("Home Assistant started");
  });

  it("should query audit logs with filters and rationale header", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const res = await client.getAuditLogs({
      agent_id: "bot_1",
      role: "admin",
      status: "allowed",
      limit: 10,
      since: "2026-09-19T00:00:00Z",
      rationale: "Audit inspection by lead admin",
    });
    expect(res.total_events).toBe(1);
    expect(res.events[0].id).toBe("aud_123456789abc");
    expect(res.events[0].agent_id).toBe("bot_1");
    expect(lastHeaders["x-agent-rationale"]).toBe("Audit inspection by lead admin");
    expect(lastReqUrl).toContain("agent_id=bot_1");
    expect(lastReqUrl).toContain("role=admin");
    expect(lastReqUrl).toContain("status=allowed");
    expect(lastReqUrl).toContain("limit=10");
    expect(lastReqUrl).toContain("since=2026-09-19T00:00:00Z");
  });

  it("should throw ClientError on forbidden audit log query", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    await expect(client.getAuditLogs({ role: "forbidden_role" })).rejects.toThrow(
      /Addon getAuditLogs failed/i
    );
  });

  it("should issue agent ephemeral token with rationale header", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const res = await client.issueAgentToken({
      agent_id: "designer_bot",
      role: "dashboard_designer",
      ttl_minutes: 30,
      rationale: "Spawn ephemeral worker",
    });
    expect(res.agent_id).toBe("designer_bot");
    expect(res.role).toBe("dashboard_designer");
    expect(res.token).toBe("sec_agent_ephem_abc123456789");
    expect(lastRequestBody).toEqual({
      agent_id: "designer_bot",
      role: "dashboard_designer",
      ttl_minutes: 30,
    });
    expect(lastHeaders["x-agent-rationale"]).toBe("Spawn ephemeral worker");
  });

  it("should throw ClientError on failed agent token issuance", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    await expect(
      client.issueAgentToken({ agent_id: "test", role: "invalid_role" })
    ).rejects.toThrow(/Addon issueAgentToken failed/i);
  });

  it("should get agent policies and roles configuration", async () => {
    const client = new AddonClient({ addonUrl: serverUrl, addonKey: "test-addon-key" });
    const policies = await client.getAgentPolicies();
    expect(policies.roles).toBeDefined();
    expect(policies.roles.admin.allow_tools).toEqual(["*"]);
    expect(policies.agents.designer_bot.role).toBe("dashboard_designer");
  });
});

describe("HAWsClient", () => {
  let wss: WebSocketServer;
  let wsPort: number;
  let serverToken = "valid-ws-token";

  beforeEach(async () => {
    wss = new WebSocketServer({ port: 0 });
    await new Promise<void>((resolve) => {
      wss.on("listening", () => {
        const addr = wss.address() as AddressInfo;
        wsPort = addr.port;
        resolve();
      });
    });

    wss.on("connection", (ws: WebSocket) => {
      // 1. Send auth_required
      ws.send(JSON.stringify({ type: "auth_required", ha_version: "2026.8.0" }));

      ws.on("message", (raw: string) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.type === "auth") {
            if (msg.access_token === serverToken) {
              ws.send(JSON.stringify({ type: "auth_ok", ha_version: "2026.8.0" }));
            } else {
              ws.send(JSON.stringify({ type: "auth_invalid", message: "Invalid access token" }));
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
                  title: "My Home",
                  views: [{ title: "Overview", path: msg.url_path || "default" }],
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
                  { entity_id: "sun.sun", state: "above_horizon" },
                  { entity_id: "light.kitchen", state: "off" },
                ],
              })
            );
            return;
          }

          if (msg.type === "fail_command") {
            ws.send(
              JSON.stringify({
                id: msg.id,
                type: "result",
                success: false,
                error: { code: "not_found", message: "Entity not found" },
              })
            );
            return;
          }
        } catch {
          // ignore parse errors
        }
      });
    });
  });

  afterEach(async () => {
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
  });

  it("should connect and complete authentication handshake successfully", async () => {
    const client = new HAWsClient({
      haUrl: `http://127.0.0.1:${wsPort}`,
      haToken: "valid-ws-token",
    });
    await client.connect();
    expect(client.isConnected).toBe(true);
    await client.disconnect();
    expect(client.isConnected).toBe(false);
  });

  it("should fail authentication when invalid token provided", async () => {
    const client = new HAWsClient({
      haUrl: `http://127.0.0.1:${wsPort}`,
      haToken: "invalid-token",
    });
    await expect(client.connect()).rejects.toThrow(/auth_invalid|invalid access token/i);
    expect(client.isConnected).toBe(false);
  });

  it("should fetch Lovelace configuration", async () => {
    const client = new HAWsClient({
      haUrl: `http://127.0.0.1:${wsPort}`,
      haToken: "valid-ws-token",
    });
    await client.connect();
    const config = await client.getLovelaceConfig("dashboard-main");
    expect(config.title).toBe("My Home");
    expect(config.views[0].path).toBe("dashboard-main");
    await client.disconnect();
  });

  it("should save Lovelace configuration", async () => {
    const client = new HAWsClient({
      haUrl: `http://127.0.0.1:${wsPort}`,
      haToken: "valid-ws-token",
    });
    await client.connect();
    const result = await client.saveLovelaceConfig({ title: "Updated Home", views: [] });
    expect(result).toBeNull();
    await client.disconnect();
  });

  it("should fetch states via WebSocket", async () => {
    const client = new HAWsClient({
      haUrl: `http://127.0.0.1:${wsPort}`,
      haToken: "valid-ws-token",
    });
    await client.connect();
    const states = await client.fetchStates();
    expect(states).toHaveLength(2);
    expect(states[0].entity_id).toBe("sun.sun");
    await client.disconnect();
  });

  it("should handle error result from WebSocket command", async () => {
    const client = new HAWsClient({
      haUrl: `http://127.0.0.1:${wsPort}`,
      haToken: "valid-ws-token",
    });
    await client.connect();
    await expect(client.sendMessage({ type: "fail_command" })).rejects.toThrow(/Entity not found/i);
    await client.disconnect();
  });
});
