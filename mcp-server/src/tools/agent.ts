import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ToolClients, McpToolResult } from "./types.js";

export const issueTokenSchema = {
  agent_id: z
    .string()
    .describe("Identifier for the newly created or requested agent"),
  role: z
    .string()
    .describe("Role to assign to the agent (e.g., 'ha-dashboard-designer', 'ha-automation-builder')"),
  ttl_minutes: z
    .number()
    .int()
    .positive()
    .optional()
    .describe("Time-to-live for the token in minutes"),
  rationale: z
    .string()
    .optional()
    .describe("Reason for issuing this token"),
};

export async function handleAgentIssueToken(
  clients: ToolClients,
  args: {
    agent_id: string;
    role: string;
    ttl_minutes?: number;
    rationale?: string;
  }
): Promise<McpToolResult> {
  try {
    const res = await clients.addonClient.issueAgentToken(args);
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
          text: `Failed to issue agent token: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleAgentListPolicies(
  clients: ToolClients
): Promise<McpToolResult> {
  try {
    const res = await clients.addonClient.getAgentPolicies();
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
          text: `Failed to list agent policies: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export function registerAgentTools(server: McpServer, clients: ToolClients): void {
  server.registerTool(
    "ha_agent_issue_token",
    {
      description: "Issue a new ephemeral JWT token for delegating tasks to a subagent.",
      inputSchema: issueTokenSchema,
    },
    async (args) => handleAgentIssueToken(clients, args as any)
  );

  server.registerTool(
    "ha_agent_list_policies",
    {
      description: "Retrieve all active agent roles, tool permissions, path restrictions, and service whitelists.",
    },
    async () => handleAgentListPolicies(clients)
  );
}
