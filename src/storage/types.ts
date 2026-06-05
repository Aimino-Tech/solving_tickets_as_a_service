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

  addTeamMember(data: NewTeamMember): Promise<TeamMember>;
  removeTeamMember(teamId: number, accountId: number): Promise<boolean>;
  getTeamMembers(teamId: number): Promise<TeamMember[]>;
  updateTeamMemberRole(teamId: number, accountId: number, role: string): Promise<TeamMember | undefined>;

  // -------------------------------------------------------------------------
  // Run History
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

export interface RunFilters {
  status?: string;
  repo?: string;
  startedAfter?: Date;
  startedBefore?: Date;
}

export type StorageBackendConstructor = new (...args: unknown[]) => StorageBackend;
