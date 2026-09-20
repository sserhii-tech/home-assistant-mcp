import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClients, McpToolResult } from "./types.js";

export const getDashboardConfigSchema = {
  dashboard_slug: z
    .string()
    .optional()
    .describe("Dashboard slug (e.g. 'lovelace', 'dashboard-energy', or omit for default)"),
};

export const saveDashboardConfigSchema = {
  config_yaml: z
    .string()
    .describe("Lovelace configuration content in YAML or JSON format"),
  dashboard_slug: z
    .string()
    .optional()
    .describe("Dashboard slug (e.g. 'lovelace', 'dashboard-test')"),
  label: z
    .string()
    .optional()
    .describe("Optional backup/snapshot label description"),
  rationale: z
    .string()
    .optional()
    .describe("Reason for this configuration change"),
};

export const renderScreenshotSchema = {
  url_path: z
    .string()
    .describe("Lovelace dashboard URL path to render (e.g. 'lovelace/0', 'dashboard-energy')"),
  device_preset: z
    .enum(["desktop", "tablet", "mobile"])
    .optional()
    .describe("Device viewport preset ('desktop' = 1920x1080, 'tablet' = 768x1024, 'mobile' = 375x812)"),
  dark_mode: z
    .boolean()
    .optional()
    .describe("Render with dark mode color scheme emulation"),
  element_selector: z
    .string()
    .optional()
    .describe("Optional CSS selector to capture an isolated card or component (e.g. '#card-light')"),
};

export async function handleDashboardGetConfig(
  clients: ToolClients,
  args: { dashboard_slug?: string }
): Promise<McpToolResult> {
  try {
    const slug = args.dashboard_slug?.trim() || null;
    let config: any;

    try {
      if (clients.wsClient) {
        config = await clients.wsClient.getLovelaceConfig(slug);
      }
    } catch {
      const fallbackPath = slug && slug !== "lovelace" ? `dashboards/${slug}.yaml` : "ui-lovelace.yaml";
      const fileRes = await clients.addonClient.readFile(fallbackPath);
      config = fileRes.content;
    }

    if (config === undefined || config === null) {
      const fallbackPath = slug && slug !== "lovelace" ? `dashboards/${slug}.yaml` : "ui-lovelace.yaml";
      const fileRes = await clients.addonClient.readFile(fallbackPath);
      config = fileRes.content;
    }

    const outputText = typeof config === "string" ? config : JSON.stringify(config, null, 2);
    return {
      content: [
        {
          type: "text",
          text: outputText,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to get dashboard configuration: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleDashboardSaveConfig(
  clients: ToolClients,
  args: { config_yaml: string; dashboard_slug?: string; label?: string; rationale?: string }
): Promise<McpToolResult> {
  try {
    const slug = args.dashboard_slug?.trim() || "lovelace";
    const filePath = slug && slug !== "lovelace" ? `dashboards/${slug}.yaml` : "ui-lovelace.yaml";
    const label = args.label || `Dashboard update (${slug})`;

    const writeRes = await clients.addonClient.writeFile(filePath, args.config_yaml, {
      validateYaml: true,
      label,
      rationale: args.rationale,
    });

    try {
      const parsedJson = JSON.parse(args.config_yaml);
      if (typeof parsedJson === "object" && parsedJson !== null) {
        await clients.wsClient.saveLovelaceConfig(parsedJson, slug === "lovelace" ? null : slug);
      }
    } catch {
      // Not JSON or WS save skipped; YAML file write succeeded
    }

    return {
      content: [
        {
          type: "text",
          text: `Dashboard configuration successfully saved for "${slug}". Snapshot ID: ${writeRes.snapshot_id} (${writeRes.bytes_written} bytes written to ${writeRes.path}).`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to save dashboard configuration: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleDashboardRenderScreenshot(
  clients: ToolClients,
  args: {
    url_path: string;
    device_preset?: "desktop" | "tablet" | "mobile";
    dark_mode?: boolean;
    element_selector?: string;
  }
): Promise<McpToolResult> {
  try {
    const result = await clients.renderer.captureDashboard({
      urlPath: args.url_path,
      devicePreset: args.device_preset,
      darkMode: args.dark_mode,
      elementSelector: args.element_selector,
    });

    return {
      content: [
        {
          type: "image",
          data: result.base64Png,
          mimeType: "image/png",
        },
        {
          type: "text",
          text: `Dashboard screenshot rendered for ${result.url} (${result.width}x${result.height})${
            args.element_selector ? ` [selector: ${args.element_selector}]` : ""
          }`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to capture dashboard screenshot: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export function registerDashboardTools(server: McpServer, clients: ToolClients): void {
  server.registerTool(
    "ha_dashboard_get_config",
    {
      description: "Retrieve Home Assistant Lovelace dashboard configuration via WebSocket or storage file.",
      inputSchema: getDashboardConfigSchema,
    },
    async (args) => handleDashboardGetConfig(clients, args)
  );

  server.registerTool(
    "ha_dashboard_save_config",
    {
      description: "Validate, snapshot, and save Home Assistant Lovelace dashboard configuration.",
      inputSchema: saveDashboardConfigSchema,
    },
    async (args) => handleDashboardSaveConfig(clients, args)
  );

  server.registerTool(
    "ha_dashboard_render_screenshot",
    {
      description: "Render a high-resolution screenshot of a Home Assistant dashboard or card via headless browser.",
      inputSchema: renderScreenshotSchema,
    },
    async (args) => handleDashboardRenderScreenshot(clients, args)
  );
}
