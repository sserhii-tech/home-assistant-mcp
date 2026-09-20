import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { ToolClients, McpToolResult } from "./types.js";

export const listAutomationsSchema = {
  domain: z
    .enum(["automation", "script", "scene"])
    .optional()
    .describe("Domain to list (defaults to 'automation')"),
};

export const readAutomationSchema = {
  automation_id: z
    .string()
    .describe("Automation ID or alias to locate in automations.yaml"),
};

export const writeAutomationSchema = {
  automation_id: z
    .string()
    .describe("Automation ID to insert or update"),
  yaml_code: z
    .string()
    .describe("YAML configuration block for the automation"),
  label: z
    .string()
    .optional()
    .describe("Optional snapshot label for safety backup"),
  rationale: z
    .string()
    .optional()
    .describe("Reason for this automation change"),
};

export const triggerAutomationSchema = {
  entity_id: z
    .string()
    .describe("Automation entity_id to trigger (e.g. 'automation.evening_lights')"),
};

function splitYamlBlocks(yamlContent: string): string[] {
  if (!yamlContent.trim()) {
    return [];
  }
  const lines = yamlContent.split("\n");
  const blocks: string[] = [];
  let currentBlock: string[] = [];

  for (const line of lines) {
    if (line.startsWith("- ") && currentBlock.length > 0) {
      blocks.push(currentBlock.join("\n").trim());
      currentBlock = [line];
    } else {
      currentBlock.push(line);
    }
  }

  if (currentBlock.length > 0) {
    const trimmed = currentBlock.join("\n").trim();
    if (trimmed) {
      blocks.push(trimmed);
    }
  }

  return blocks;
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function blockMatchesIdOrAlias(block: string, targetId: string): boolean {
  const idRegex = new RegExp(`(^|\\n)\\s*-\\s*id:\\s*['"]?${escapeRegex(targetId)}['"]?(\\s|$)|(^|\\n)\\s*id:\\s*['"]?${escapeRegex(targetId)}['"]?(\\s|$)`, "i");
  const aliasRegex = new RegExp(`(^|\\n)\\s*alias:\\s*['"]?${escapeRegex(targetId)}['"]?(\\s|$)`, "i");
  return idRegex.test(block) || aliasRegex.test(block);
}

export async function handleAutomationList(
  clients: ToolClients,
  args: { domain?: "automation" | "script" | "scene" }
): Promise<McpToolResult> {
  try {
    const domain = args.domain || "automation";
    const states = await clients.restClient.getStates();

    const filtered = states
      .filter((s) => s.entity_id.startsWith(`${domain}.`))
      .map((s) => ({
        entity_id: s.entity_id,
        state: s.state,
        friendly_name: s.attributes?.friendly_name || s.entity_id,
        last_triggered: s.attributes?.last_triggered || null,
        description: s.attributes?.description,
        mode: s.attributes?.mode,
        current: s.attributes?.current,
      }));

    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(filtered, null, 2),
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to list automations: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleAutomationRead(
  clients: ToolClients,
  args: { automation_id: string }
): Promise<McpToolResult> {
  try {
    const fileRes = await clients.addonClient.readFile("automations.yaml");
    const blocks = splitYamlBlocks(fileRes.content);
    const targetId = args.automation_id.trim();

    const matchedBlock = blocks.find((b) => blockMatchesIdOrAlias(b, targetId));

    if (!matchedBlock) {
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Automation "${targetId}" not found in automations.yaml`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: matchedBlock,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to read automation: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleAutomationWrite(
  clients: ToolClients,
  args: { automation_id: string; yaml_code: string; label?: string; rationale?: string }
): Promise<McpToolResult> {
  try {
    let existingContent = "";
    try {
      const fileRes = await clients.addonClient.readFile("automations.yaml");
      existingContent = fileRes.content;
    } catch {
      existingContent = "";
    }

    const blocks = splitYamlBlocks(existingContent);
    const targetId = args.automation_id.trim();
    let formattedNewBlock = args.yaml_code.trim();

    if (!formattedNewBlock.startsWith("- ")) {
      const lines = formattedNewBlock.split("\n");
      const firstLine = `- ${lines[0]}`;
      const restLines = lines.slice(1).map((l) => (l.trim() ? `  ${l}` : l));
      formattedNewBlock = [firstLine, ...restLines].join("\n");
    }

    const existingIndex = blocks.findIndex((b) => blockMatchesIdOrAlias(b, targetId));

    if (existingIndex >= 0) {
      blocks[existingIndex] = formattedNewBlock;
    } else {
      blocks.push(formattedNewBlock);
    }

    const updatedYaml = blocks.join("\n\n") + "\n";
    const label = args.label || `Update automation ${targetId}`;

    const writeRes = await clients.addonClient.writeFile("automations.yaml", updatedYaml, {
      validateYaml: true,
      label,
      rationale: args.rationale,
    });

    try {
      await clients.restClient.callService("automation", "reload");
    } catch (reloadErr: any) {
      return {
        content: [
          {
            type: "text",
            text: `Automation "${targetId}" written to automations.yaml (Snapshot: ${writeRes.snapshot_id}), but service reload failed: ${reloadErr.message}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: "text",
          text: `Automation "${targetId}" successfully saved and automations reloaded. Snapshot ID: ${writeRes.snapshot_id}.`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to write automation: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export async function handleAutomationTrigger(
  clients: ToolClients,
  args: { entity_id: string }
): Promise<McpToolResult> {
  try {
    const entityId = args.entity_id.trim();
    const domain = entityId.split(".")[0] || "automation";

    await clients.restClient.callService(domain, "trigger", { entity_id: entityId });

    return {
      content: [
        {
          type: "text",
          text: `Successfully triggered ${entityId}`,
        },
      ],
    };
  } catch (error: any) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: `Failed to trigger ${args.entity_id}: ${error.message || String(error)}`,
        },
      ],
    };
  }
}

export function registerAutomationTools(server: McpServer, clients: ToolClients): void {
  server.registerTool(
    "ha_automation_list",
    {
      description: "List all Home Assistant automations, scripts, or scenes with their current states.",
      inputSchema: listAutomationsSchema,
    },
    async (args) => handleAutomationList(clients, args)
  );

  server.registerTool(
    "ha_automation_read",
    {
      description: "Read the YAML configuration block of a specific automation from automations.yaml.",
      inputSchema: readAutomationSchema,
    },
    async (args) => handleAutomationRead(clients, args)
  );

  server.registerTool(
    "ha_automation_write",
    {
      description: "Safely create or update an automation in automations.yaml with automated backup snapshot and service reload.",
      inputSchema: writeAutomationSchema,
    },
    async (args) => handleAutomationWrite(clients, args)
  );

  server.registerTool(
    "ha_automation_trigger",
    {
      description: "Trigger a Home Assistant automation or script entity immediately.",
      inputSchema: triggerAutomationSchema,
    },
    async (args) => handleAutomationTrigger(clients, args)
  );
}
