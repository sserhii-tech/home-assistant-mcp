#!/usr/bin/env node

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { fileURLToPath } from "url";
import path from "path";

import { loadConfig } from "./core/config.js";
import { defaultLogger } from "./core/logger.js";
import { HARestAdapter } from "./adapters/ha/ha-rest.adapter.js";
import { HAWsAdapter } from "./adapters/ha/ha-ws.adapter.js";
import { AddonAdapter } from "./adapters/addon/addon.adapter.js";
import { PlaywrightDashboardAdapter } from "./adapters/browser/playwright.adapter.js";
import { registerDashboardTools } from "./tools/dashboard.js";
import { registerAutomationTools } from "./tools/automation.js";
import { registerSystemTools } from "./tools/system.js";
import type { ToolClients } from "./tools/types.js";

export function createClients(): ToolClients {
  const config = loadConfig();
  const restClient = new HARestAdapter({ haUrl: config.haUrl, haToken: config.haToken });
  const wsClient = new HAWsAdapter({ haUrl: config.haUrl, haToken: config.haToken });
  const addonClient = new AddonAdapter({
    addonUrl: config.addonUrl,
    addonKey: config.addonKey,
    agentKey: config.agentKey,
    agentId: config.agentId,
  });
  const renderer = new PlaywrightDashboardAdapter({
    haUrl: config.haUrl,
    haToken: config.haToken,
    browserStateDir: config.browserStateDir,
  });

  return { restClient, wsClient, addonClient, renderer };
}

export function createServer(providedClients?: ToolClients): {
  server: McpServer;
  clients: ToolClients;
} {
  const clients = providedClients || createClients();

  const server = new McpServer({
    name: "ha-ai-mcp",
    version: "1.0.0",
  });

  registerDashboardTools(server, clients);
  registerAutomationTools(server, clients);
  registerSystemTools(server, clients);

  return { server, clients };
}

import { syncSkills } from "./cli/skills.js";

export { syncSkills };

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("install-skills") || args.includes("update-skills") || args.includes("sync-skills")) {
    const customDir = args.find((a) => a.startsWith("--dir="))?.split("=")[1];
    console.log("🚀 Synchronizing Home Assistant AI Skills...");
    const result = syncSkills(customDir, false);
    console.log(`✨ Successfully synchronized ${result.installedCount} skill files across ${result.targetDirs.length} directories.`);
    process.exit(0);
  }

  // Background auto-sync skills if enabled or if standard skills folder exists
  if (process.env.AUTO_SYNC_SKILLS !== "false") {
    try {
      syncSkills(undefined, true);
    } catch {
      // Non-blocking auto-sync
    }
  }

  const { server, clients } = createServer();
  const transport = new StdioServerTransport();

  const cleanup = async () => {
    defaultLogger.info("Shutting down Home Assistant AI MCP Server...");
    try {
      clients.wsClient.disconnect();
      await clients.renderer.close();
      await server.close();
    } catch {
      // Ignore teardown errors during exit
    }
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  try {
    await server.connect(transport);
    defaultLogger.info("Home Assistant AI MCP Server running on stdio.");
  } catch (err: any) {
    defaultLogger.error("Fatal MCP Server startup error:", err);
    process.exit(1);
  }
}

const isDirectEntrypoint = (): boolean => {
  if (!process.argv[1]) return false;
  try {
    const currentFilePath = fileURLToPath(import.meta.url).toLowerCase();
    const executedScriptPath = path.resolve(process.argv[1]).toLowerCase();
    const normalizedArg = process.argv[1].replace(/\\/g, "/").toLowerCase();
    return (
      currentFilePath === executedScriptPath ||
      normalizedArg.endsWith("dist/index.js") ||
      normalizedArg.endsWith("src/index.ts")
    );
  } catch {
    return false;
  }
};

if (isDirectEntrypoint()) {
  main().catch((err) => {
    defaultLogger.error("Unhandled top-level error:", err);
    process.exit(1);
  });
}
