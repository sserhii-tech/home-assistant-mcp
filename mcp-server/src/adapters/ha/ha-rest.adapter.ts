import axios, { AxiosInstance } from "axios";
import { IHARestClient } from "../../domain/ports/ha-client.port.js";
import { HAEntityState } from "../../domain/models/entity.js";
import { ClientError } from "../../core/errors.js";

export interface HARestOptions {
  haUrl: string;
  haToken: string;
  timeoutMs?: number;
}

export class HARestAdapter implements IHARestClient {
  private readonly client: AxiosInstance;

  constructor(options: HARestOptions | string, haToken?: string) {
    let url: string;
    let token: string;
    let timeout = 10000;

    if (typeof options === "string") {
      url = options;
      token = haToken ?? "";
    } else {
      url = options.haUrl;
      token = options.haToken;
      timeout = options.timeoutMs ?? 10000;
    }

    const cleanUrl = url.replace(/\/+$/, "");

    this.client = axios.create({
      baseURL: cleanUrl,
      timeout,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
    });
  }

  async checkApi(): Promise<{ message: string }> {
    try {
      const resp = await this.client.get<{ message: string }>("/api/");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`HA REST /api/ check failed: ${err.message}`, err.response?.status);
    }
  }

  async getStates(): Promise<HAEntityState[]> {
    try {
      const resp = await this.client.get<HAEntityState[]>("/api/states");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Failed to fetch HA states: ${err.message}`, err.response?.status);
    }
  }

  async callService(domain: string, service: string, serviceData: Record<string, any> = {}, options?: { rationale?: string }): Promise<any> {
    try {
      const headers: Record<string, string> = {};
      if (options?.rationale) {
        headers["X-Agent-Rationale"] = options.rationale;
      }
      const resp = await this.client.post(`/api/services/${domain}/${service}`, serviceData, { headers });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Failed calling service ${domain}.${service}: ${err.message}`, err.response?.status);
    }
  }

  async getSupervisorLogs(linesCount = 100): Promise<string[]> {
    try {
      const resp = await this.client.get<string>("/api/hassio/supervisor/logs", {
        responseType: "text",
      });
      const lines = String(resp.data).split("\n").filter(Boolean);
      return lines.slice(-linesCount);
    } catch {
      return [];
    }
  }
}

// Backward-compatible alias
export { HARestAdapter as HARestClient };
