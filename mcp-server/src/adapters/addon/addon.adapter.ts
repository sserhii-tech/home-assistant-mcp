import axios, { AxiosInstance } from "axios";
import {
  AddonHealthResult,
  AuditQueryParams,
  AuditQueryResponse,
  FileReadResult,
  FileWriteResult,
  IAddonClient,
  IssueTokenParams,
  IssueTokenResponse,
  PoliciesResponse,
} from "../../domain/ports/addon-client.port.js";
import { BackupRestoreResult, LogsTailResult, SnapshotInfo } from "../../domain/models/system.js";
import { ClientError } from "../../core/errors.js";

export interface AddonClientOptions {
  addonUrl: string;
  addonKey: string;
  agentKey?: string;
  agentId?: string;
  timeoutMs?: number;
}

export class AddonAdapter implements IAddonClient {
  private readonly client: AxiosInstance;

  constructor(options: AddonClientOptions | string, addonKey?: string) {
    let url: string;
    let key: string;
    let timeout = 10000;

    if (typeof options === "string") {
      url = options;
      key = addonKey ?? "";
    } else {
      url = options.addonUrl;
      key = options.agentKey || options.addonKey;
      timeout = options.timeoutMs ?? 10000;
    }

    const cleanUrl = url.replace(/\/+$/, "");

    this.client = axios.create({
      baseURL: cleanUrl,
      timeout,
      headers: {
        "X-Addon-API-Key": key,
        "Content-Type": "application/json",
      },
    });
  }

  async checkHealth(): Promise<AddonHealthResult> {
    try {
      const resp = await this.client.get<AddonHealthResult>("/api/v1/health");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon health check failed: ${err.message}`, err.response?.status);
    }
  }

  async readFile(path: string): Promise<FileReadResult> {
    try {
      const resp = await this.client.post<FileReadResult>("/api/v1/file/read", { path });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon readFile failed: ${err.message}`, err.response?.status);
    }
  }

  async writeFile(
    path: string,
    content: string,
    options: { validateYaml?: boolean; label?: string; rationale?: string } = {}
  ): Promise<FileWriteResult> {
    try {
      const headers: Record<string, string> = {};
      if (options.rationale) {
        headers["X-Agent-Rationale"] = options.rationale;
      }
      const resp = await this.client.post<FileWriteResult>(
        "/api/v1/file/write",
        {
          path,
          content,
          validate_yaml: options.validateYaml ?? true,
          label: options.label ?? "",
        },
        { headers }
      );
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon writeFile failed: ${err.message}`, err.response?.status);
    }
  }

  async listSnapshots(): Promise<SnapshotInfo[]> {
    try {
      const resp = await this.client.get<SnapshotInfo[]>("/api/v1/backup/list");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon listSnapshots failed: ${err.message}`, err.response?.status);
    }
  }

  async restoreSnapshot(snapshotId: string, options?: { rationale?: string }): Promise<BackupRestoreResult> {
    try {
      const headers: Record<string, string> = {};
      if (options?.rationale) {
        headers["X-Agent-Rationale"] = options.rationale;
      }
      const resp = await this.client.post<BackupRestoreResult>("/api/v1/backup/restore", {
        snapshot_id: snapshotId,
      }, { headers });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon restoreSnapshot failed: ${err.message}`, err.response?.status);
    }
  }

  async getLogs(lines: number = 100): Promise<LogsTailResult> {
    try {
      const resp = await this.client.get<LogsTailResult>(`/api/v1/logs/tail?lines=${lines}`);
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon getLogs failed: ${err.message}`, err.response?.status);
    }
  }

  async getAuditLogs(params: AuditQueryParams = {}): Promise<AuditQueryResponse> {
    try {
      const queryParams: Record<string, any> = {};
      if (params.agent_id !== undefined) queryParams.agent_id = params.agent_id;
      if (params.role !== undefined) queryParams.role = params.role;
      if (params.status !== undefined) queryParams.status = params.status;
      if (params.limit !== undefined) queryParams.limit = params.limit;
      if (params.since !== undefined) queryParams.since = params.since;

      const headers: Record<string, string> = {};
      if (params.rationale) {
        headers["X-Agent-Rationale"] = params.rationale;
      }

      const resp = await this.client.get<AuditQueryResponse>("/api/v1/audit/logs", {
        params: queryParams,
        headers,
      });
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon getAuditLogs failed: ${err.message}`, err.response?.status);
    }
  }

  async issueAgentToken(params: IssueTokenParams): Promise<IssueTokenResponse> {
    try {
      const headers: Record<string, string> = {};
      if (params.rationale) {
        headers["X-Agent-Rationale"] = params.rationale;
      }

      const resp = await this.client.post<IssueTokenResponse>(
        "/api/v1/agent/token",
        {
          agent_id: params.agent_id,
          role: params.role,
          ttl_minutes: params.ttl_minutes ?? 60,
        },
        { headers }
      );
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon issueAgentToken failed: ${err.message}`, err.response?.status);
    }
  }

  async getAgentPolicies(): Promise<PoliciesResponse> {
    try {
      const resp = await this.client.get<PoliciesResponse>("/api/v1/agent/policies");
      return resp.data;
    } catch (err: any) {
      throw new ClientError(`Addon getAgentPolicies failed: ${err.message}`, err.response?.status);
    }
  }

  async authorize(
    tool: string,
    target?: string,
    domain?: string,
    service?: string,
    options?: { rationale?: string }
  ): Promise<void> {
    try {
      const headers: Record<string, string> = {};
      if (options?.rationale) {
        headers["X-Agent-Rationale"] = options.rationale;
      }

      await this.client.post(
        "/api/v1/audit/authorize",
        {
          tool,
          target,
          domain,
          service,
        },
        { headers }
      );
    } catch (err: any) {
      let errStr = err.message;
      if (err.response?.data?.detail?.error) {
        errStr = err.response.data.detail.error;
      }
      throw new Error(`Authorization denied for ${tool}: ${errStr}`);
    }
  }
}

// Backward-compatible alias
export { AddonAdapter as AddonClient };
