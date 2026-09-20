import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClients, McpToolResult } from "./types.js";

export const getAuditLogsSchema = {
  agent_id: z
    .string()
    .optional()
    .describe("Filter by specific agent identifier"),
  role: z
    .string()
    .optional()
    .describe("Filter by role name"),
  status: z
    .string()
    .optional()
    .describe("Filter by event status (e.g., 'allowed', 'denied_policy', 'denied_security')"),
  limit: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Maximum number of events to return"),
  since: z
    .string()
    .optional()
    .describe("ISO timestamp to fetch events from"),
  rationale: z
    .string()
    .optional()
    .describe("Reason or rationale for querying the audit logs"),
};

export async function handleAuditGetLogs(
  clients: ToolClients,
  args: {
    agent_id?: string;
    role?: string;
    status?: string;
    limit?: number;
    since?: string;
    rationale?: string;
  }
): Promise<McpToolResult> {
  try {
    const res = await clients.addonClient.getAuditLogs(args);
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(res, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to retrieve audit logs: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export function registerAuditTools(server: McpServer, clients: ToolClients): void {
  server.registerTool(
    "ha_audit_get_logs",
    {
      description: "Query Home Assistant AI agent audit logs for security, troubleshooting, and compliance.",
      inputSchema: getAuditLogsSchema,
    },
    async (args) => handleAuditGetLogs(clients, args as any)
  );
}
