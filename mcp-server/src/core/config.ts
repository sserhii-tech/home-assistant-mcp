import os from "os";
import path from "path";
import { z } from "zod";

export const ConfigSchema = z.object({
  HA_URL: z.string().url().default("http://localhost:8123"),
  HA_TOKEN: z.string().default(""),
  ADDON_URL: z.string().url().default("http://localhost:8099"),
  ADDON_KEY: z.string().default(""),
  AGENT_KEY: z.string().optional().default(""),
  AGENT_ID: z.string().optional().default(""),
  BROWSER_STATE_DIR: z.string().default(() => path.join(os.homedir(), ".ha-ai")),
});

export type RawConfig = z.infer<typeof ConfigSchema>;

export interface AppConfig {
  haUrl: string;
  haToken: string;
  addonUrl: string;
  addonKey: string;
  agentKey: string;
  agentId: string;
  browserStateDir: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = ConfigSchema.parse({
    HA_URL: env.HA_URL,
    HA_TOKEN: env.HA_TOKEN,
    ADDON_URL: env.ADDON_URL,
    ADDON_KEY: env.ADDON_KEY,
    AGENT_KEY: env.AGENT_KEY,
    AGENT_ID: env.AGENT_ID,
    BROWSER_STATE_DIR: env.BROWSER_STATE_DIR,
  });

  return {
    haUrl: parsed.HA_URL.replace(/\/+$/, ""),
    haToken: parsed.HA_TOKEN,
    addonUrl: parsed.ADDON_URL.replace(/\/+$/, ""),
    addonKey: parsed.ADDON_KEY,
    agentKey: parsed.AGENT_KEY,
    agentId: parsed.AGENT_ID,
    browserStateDir: parsed.BROWSER_STATE_DIR,
  };
}
