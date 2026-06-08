/**
 * Storage interface — abstract data access contract.
 *
 * All storage backends (Postgres, SQLite, etc.) implement this interface,
 * allowing the application to be storage-agnostic.
 */

import type {
  Account,
  NewAccount,
  AuditLog,
  NewAuditLog,
  NewRunHistory,
  NewUsageRecord,
  RunHistory,
  Team,
  NewTeam,
  TeamMember,
  NewTeamMember,
  UsageRecord,
} from '../db/schema/index.js';

// ── Run record types (used by lightweight storage backends) ───────────

export interface RunRecord {
  id?: number;
  installationId: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number;
  status: string;
  confidence?: string;
  summary?: string;
  prUrl?: string;
  branchName?: string;
  error?: string;
  createdAt?: Date;
  updatedAt?: Date;
  durationMs?: number;
  modelUsed?: string;
}

export interface RunFilter {
  repo?: string;
  status?: string;
  issueNumber?: number;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface RunStats {
  total: number;
  passRate: number;
  avgDurationMs: number;
}

export interface RunFilters {
  status?: string;
  repo?: string;
  startedAfter?: Date;
  startedBefore?: Date;
}

export interface StorageBackend {
  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Initialize the storage backend (e.g., run migrations, create pool). */
  initialize(): Promise<void>;

  /** Gracefully shut down (close connections, release resources). */
  destroy(): Promise<void>;

  /** Check the health of the storage backend. */
  health(): Promise<{ ok: boolean; latencyMs: number }>;

  /** Close/release resources (used by lightweight backends). */
  close(): Promise<void>;

  // -------------------------------------------------------------------------
  // Accounts
  // -------------------------------------------------------------------------

  createAccount(data: NewAccount): Promise<Account>;
  getAccount(id: number): Promise<Account | undefined>;
  getAccountByInstallationId(githubInstallationId: number): Promise<Account | undefined>;
  updateAccount(id: number, data: Partial<Pick<Account, 'email' | 'name' | 'tier'>>): Promise<Account | undefined>;
  deleteAccount(id: number): Promise<boolean>;
  listAccounts(limit?: number, offset?: number): Promise<Account[]>;

  // -------------------------------------------------------------------------
  // Teams
  // -------------------------------------------------------------------------

  createTeam(data: NewTeam): Promise<Team>;
  getTeam(id: number): Promise<Team | undefined>;
  getTeamBySlug(slug: string): Promise<Team | undefined>;
  updateTeam(id: number, data: Partial<Pick<Team, 'name' | 'slug'>>): Promise<Team | undefined>;
  deleteTeam(id: number): Promise<boolean>;
  listTeams(accountId?: number, limit?: number, offset?: number): Promise<Team[]>;

  // -------------------------------------------------------------------------
  // Run History (Drizzle ORM schema)
  // -------------------------------------------------------------------------

  createRun(data: NewRunHistory): Promise<RunHistory>;
  getRun(id: number): Promise<RunHistory | undefined>;
  markRunStarted(id: number): Promise<RunHistory | undefined>;
  markRunCompleted(id: number, result?: string): Promise<RunHistory | undefined>;
  markRunFailed(id: number, errorDetails?: string): Promise<RunHistory | undefined>;
  markRunCancelled(id: number): Promise<RunHistory | undefined>;
  listRuns(accountId: number, limit?: number, offset?: number, filters?: RunFilters): Promise<RunHistory[]>;
  latestRunForIssue(accountId: number, issueId: number): Promise<RunHistory | undefined>;

  // -------------------------------------------------------------------------
  // Run History (lightweight — used by SQLite / Postgres backends)
  // -------------------------------------------------------------------------

  saveRun(run: RunRecord): Promise<RunRecord>;
  getRun(id: number | string): Promise<RunRecord | undefined>;
  listRuns(limit: number, offset: number, filters?: RunFilter): Promise<RunRecord[]>;
  countRuns(filter?: RunFilter): Promise<number>;
  getRunStats(filter: RunFilter): Promise<RunStats>;

  // -------------------------------------------------------------------------
  // Usage Tracking
  // -------------------------------------------------------------------------

  recordUsage(data: NewUsageRecord): Promise<UsageRecord>;
  totalCreditsUsed(accountId: number): Promise<number>;
  creditsUsedInRange(accountId: number, startDate: Date, endDate: Date): Promise<number>;
  monthlyUsageStats(accountId: number, months?: number): Promise<unknown[]>;
  listUsageRecords(accountId: number, limit?: number, offset?: number): Promise<UsageRecord[]>;

  // -------------------------------------------------------------------------
  // Audit Log
  // -------------------------------------------------------------------------

  appendAuditLog(data: NewAuditLog): Promise<AuditLog>;
  listAuditLogs(accountId: number, limit?: number, offset?: number): Promise<AuditLog[]>;
  listAuditLogsByAction(action: string, limit?: number, offset?: number): Promise<AuditLog[]>;
  listAuditLogsByDateRange(startDate: Date, endDate: Date, limit?: number, offset?: number): Promise<AuditLog[]>;
}

export type StorageBackendConstructor = new (...args: unknown[]) => StorageBackend;
