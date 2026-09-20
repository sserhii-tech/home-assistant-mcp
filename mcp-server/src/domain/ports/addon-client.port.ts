import { BackupRestoreResult, LogsTailResult, SnapshotInfo } from "../models/system.js";

export interface FileReadResult {
  path: string;
  content: string;
  size_bytes: number;
}

export interface FileWriteResult {
  success: boolean;
  path: string;
  snapshot_id: string;
  bytes_written: number;
}

export interface AddonHealthResult {
  status: string;
  version: string;
  config_root: string;
  snapshots_count: number;
  memory_mb: number;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  agent_id: string;
  role: string;
  action: string;
  tool?: string;
  target?: string;
  status: "allowed" | "denied_policy" | "denied_security" | string;
  reason?: string;
  diff_summary?: string;
  snapshot_id?: string;
  rationale?: string;
  client_ip?: string;
}

export interface AuditQueryParams {
  agent_id?: string;
  role?: string;
  status?: string;
  limit?: number;
  since?: string;
  rationale?: string;
}

export interface AuditQueryResponse {
  total_events: number;
  events: AuditEvent[];
}

export interface IssueTokenParams {
  agent_id: string;
  role: string;
  ttl_minutes?: number;
  rationale?: string;
}

export interface IssueTokenResponse {
  agent_id: string;
  role: string;
  token: string;
  expires_at: string;
}

export interface RoleDefinition {
  description?: string;
  allow_tools?: string[];
  deny_tools?: string[];
  allow_paths?: string[];
  deny_paths?: string[];
  read_only_paths?: string[];
  allow_services?: string[];
  deny_services?: string[];
}

export interface AgentSummary {
  role: string;
  description?: string;
}

export interface PoliciesResponse {
  roles: Record<string, RoleDefinition>;
  agents: Record<string, AgentSummary>;
}

export interface IAddonClient {
  checkHealth(): Promise<AddonHealthResult>;
  readFile(path: string): Promise<FileReadResult>;
  writeFile(
    path: string,
    content: string,
    options?: { validateYaml?: boolean; label?: string; rationale?: string }
  ): Promise<FileWriteResult>;
  listSnapshots(): Promise<SnapshotInfo[]>;
  restoreSnapshot(snapshotId: string, options?: { rationale?: string }): Promise<BackupRestoreResult>;
  getLogs(lines?: number): Promise<LogsTailResult>;
  getAuditLogs(params?: AuditQueryParams): Promise<AuditQueryResponse>;
  issueAgentToken(params: IssueTokenParams): Promise<IssueTokenResponse>;
  getAgentPolicies(): Promise<PoliciesResponse>;
}
