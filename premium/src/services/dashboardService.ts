import { queryWithRetry } from '../../../src/db/connection.js';
import { rootLogger } from '../../../src/utils/logger.js';

const log = rootLogger.child({ module: 'premium-dashboard-service' });

export interface RunRow {
  id: number;
  repoOwner: string;
  repoName: string;
  issueNumber: number | null;
  issueTitle: string | null;
  status: string;
  modelUsed: string | null;
  costCents: number | null;
  durationSeconds: number | null;
  prUrl: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RepoRow {
  id: number;
  owner: string;
  repo: string;
  active: boolean;
  installationId: number | null;
  createdAt: string;
}

export interface AuditEntry {
  id: number;
  action: string;
  actor: string | null;
  target: string | null;
  details: unknown;
  createdAt: string;
}

export interface StatsResponse {
  totalRuns: number;
  passRate: number;
  avgDurationSeconds: number;
  activeRepos: number;
  runsByDay: Array<{ date: string; count: number; passed: number }>;
  costByDay: Array<{ date: string; costCents: number }>;
  fixRateByWeek: Array<{ week: string; rate: number }>;
}

interface DbRun {
  id: number;
  account_id: number;
  repo_id: number | null;
  issue_number: number | null;
  status: string;
  confidence: string | null;
  summary: string | null;
  pr_url: string | null;
  branch_name: string | null;
  error: string | null;
  duration_ms: number | null;
  model_used: string | null;
  created_at: string;
  repo_owner?: string;
  repo_name?: string;
}

interface DbRepo {
  id: number;
  owner: string;
  name: string;
  installation_id: number;
  account_id: number;
  enabled_at: string;
}

interface DbAuditLog {
  id: number;
  timestamp: string;
  actor_type: string;
  actor_id: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  details_jsonb: unknown | null;
  ip_address: string | null;
  user_agent: string | null;
  correlation_id: string | null;
  actor: string | null;
  target: string | null;
}

interface DbAggregation {
  date: string;
  count: number;
}

interface DbRunDay extends DbAggregation {
  passed: number;
}

interface DbCostDay extends DbAggregation {
  cost_cents: number;
}

interface DbFixWeek {
  week: string;
  rate: number;
}

export async function resolveAccountId(githubUserId: string): Promise<number | undefined> {
  const uid = Number(githubUserId);
  if (!Number.isFinite(uid)) return undefined;

  const result = await queryWithRetry<{ id: number }>(
    'SELECT id FROM accounts WHERE github_user_id = $1',
    [uid],
  );
  return result.rows[0]?.id;
}

export async function listRuns(
  accountId: number,
  page: number,
  perPage: number,
  status?: string,
  repo?: string,
): Promise<{ data: RunRow[]; total: number; page: number; perPage: number; totalPages: number }> {
  const conditions: string[] = ['r.account_id = $1'];
  const params: unknown[] = [accountId];
  let idx = 2;

  if (status) {
    conditions.push(`r.status = $${idx++}`);
    params.push(status);
  }
  if (repo) {
    conditions.push(`(rp.owner || '/' || rp.name) ILIKE $${idx++}`);
    params.push(`%${repo}%`);
  }

  const where = conditions.join(' AND ');

  const countResult = await queryWithRetry<{ total: number }>(
    `SELECT COUNT(*) AS total FROM runs r LEFT JOIN repos rp ON r.repo_id = rp.id WHERE ${where}`,
    params,
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.ceil(total / perPage);
  const offset = (page - 1) * perPage;

  params.push(perPage, offset);
  const dataResult = await queryWithRetry<DbRun>(
    `SELECT r.*, rp.owner AS repo_owner, rp.name AS repo_name,
            (SELECT SUM(amount) FROM credit_transactions ct WHERE ct.account_id = r.account_id AND ct.created_at <= r.created_at) AS cost_cents
     FROM runs r
     LEFT JOIN repos rp ON r.repo_id = rp.id
     WHERE ${where}
     ORDER BY r.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    params,
  );

  const data = dataResult.rows.map(mapRun);
  return { data, total, page, perPage, totalPages };
}

export async function getRun(accountId: number, runId: number): Promise<RunRow | undefined> {
  const result = await queryWithRetry<DbRun>(
    `SELECT r.*, rp.owner AS repo_owner, rp.name AS repo_name,
            (SELECT SUM(amount) FROM credit_transactions ct WHERE ct.account_id = r.account_id AND ct.created_at <= r.created_at) AS cost_cents
     FROM runs r
     LEFT JOIN repos rp ON r.repo_id = rp.id
     WHERE r.id = $1 AND r.account_id = $2`,
    [runId, accountId],
  );
  return result.rows[0] ? mapRun(result.rows[0]) : undefined;
}

function mapRun(row: DbRun & { cost_cents?: number | null }): RunRow {
  return {
    id: row.id,
    repoOwner: row.repo_owner ?? '',
    repoName: row.repo_name ?? '',
    issueNumber: row.issue_number,
    issueTitle: row.summary,
    status: row.status,
    modelUsed: row.model_used,
    costCents: row.cost_cents ?? null,
    durationSeconds: row.duration_ms != null ? Math.round(row.duration_ms / 1000) : null,
    prUrl: row.pr_url,
    errorMessage: row.error,
    createdAt: row.created_at,
    updatedAt: row.created_at,
  };
}

export async function listRepos(accountId: number): Promise<RepoRow[]> {
  const result = await queryWithRetry<DbRepo>(
    'SELECT * FROM repos WHERE account_id = $1 ORDER BY enabled_at DESC',
    [accountId],
  );
  return result.rows.map((r: DbRepo) => ({
    id: r.id,
    owner: r.owner,
    repo: r.name,
    active: true,
    installationId: r.installation_id,
    createdAt: r.enabled_at,
  }));
}

export async function createRepo(
  accountId: number,
  owner: string,
  name: string,
  installationId: number | null,
): Promise<RepoRow> {
  const result = await queryWithRetry<DbRepo>(
    `INSERT INTO repos (owner, name, installation_id, account_id)
     VALUES ($1, $2, $3, $4)
     RETURNING *`,
    [owner, name, installationId ?? 0, accountId],
  );
  const r = result.rows[0];
  return {
    id: r.id,
    owner: r.owner,
    repo: r.name,
    active: true,
    installationId: r.installation_id,
    createdAt: r.enabled_at,
  };
}

export async function deleteRepo(accountId: number, repoId: number): Promise<boolean> {
  const result = await queryWithRetry(
    'DELETE FROM repos WHERE id = $1 AND account_id = $2',
    [repoId, accountId],
  );
  return (result.rowCount ?? 0) > 0;
}

export async function getStats(accountId: number): Promise<StatsResponse> {
  const totalResult = await queryWithRetry<{
    total: number;
    completed: number;
    avg_duration_ms: number | null;
    active_repos: number;
  }>(
    `SELECT
       COUNT(*) AS total,
       COUNT(*) FILTER (WHERE status IN ('completed', 'success')) AS completed,
       AVG(duration_ms) AS avg_duration_ms,
       (SELECT COUNT(*) FROM repos WHERE account_id = $1) AS active_repos
     FROM runs WHERE account_id = $1`,
    [accountId],
  );
  const row = totalResult.rows[0];
  const total = Number(row.total);
  const completed = Number(row.completed);
  const passRate = total > 0 ? completed / total : 0;
  const avgDurationSeconds = row.avg_duration_ms != null ? Math.round(Number(row.avg_duration_ms) / 1000) : 0;
  const activeRepos = Number(row.active_repos);

  const runsByDayResult = await queryWithRetry<DbRunDay>(
    `SELECT
       DATE(created_at)::TEXT AS date,
       COUNT(*) AS count,
       COUNT(*) FILTER (WHERE status IN ('completed', 'success')) AS passed
     FROM runs
     WHERE account_id = $1 AND created_at >= NOW() - INTERVAL '14 days'
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [accountId],
  );
  const runsByDay = runsByDayResult.rows.map((r: DbRunDay) => ({
    date: r.date,
    count: Number(r.count),
    passed: Number(r.passed),
  }));

  const costByDayResult = await queryWithRetry<DbCostDay>(
    `SELECT
       DATE(created_at)::TEXT AS date,
       SUM(amount) AS cost_cents
     FROM credit_transactions
     WHERE account_id = $1 AND created_at >= NOW() - INTERVAL '14 days'
     GROUP BY DATE(created_at)
     ORDER BY date ASC`,
    [accountId],
  );
  const costByDay = costByDayResult.rows.map((r: DbCostDay) => ({
    date: r.date,
    costCents: Number(r.cost_cents),
  }));

  const fixRateByWeekResult = await queryWithRetry<DbFixWeek>(
    `SELECT
       DATE_TRUNC('week', created_at)::DATE::TEXT AS week,
       COUNT(*) FILTER (WHERE status IN ('completed', 'success'))::FLOAT / NULLIF(COUNT(*), 0)::FLOAT AS rate
     FROM runs
     WHERE account_id = $1 AND created_at >= NOW() - INTERVAL '8 weeks'
     GROUP BY DATE_TRUNC('week', created_at)
     ORDER BY week ASC`,
    [accountId],
  );
  const fixRateByWeek = fixRateByWeekResult.rows.map((r: DbFixWeek) => ({
    week: r.week,
    rate: Number(r.rate),
  }));

  return {
    totalRuns: total,
    passRate,
    avgDurationSeconds,
    activeRepos,
    runsByDay,
    costByDay,
    fixRateByWeek,
  };
}

export async function listAuditLogs(
  accountId: number,
  page: number,
  perPage: number,
): Promise<{ data: AuditEntry[]; total: number; page: number; perPage: number; totalPages: number }> {
  const countResult = await queryWithRetry<{ total: number }>(
    `SELECT COUNT(*) AS total FROM audit_logs
     WHERE actor_id = $1::TEXT OR actor_type = 'system'`,
    [accountId],
  );
  const total = Number(countResult.rows[0]?.total ?? 0);
  const totalPages = Math.ceil(total / perPage);
  const offset = (page - 1) * perPage;

  const result = await queryWithRetry<DbAuditLog>(
    `SELECT * FROM audit_logs
     WHERE actor_id = $1::TEXT OR actor_type = 'system'
     ORDER BY timestamp DESC
     LIMIT $2 OFFSET $3`,
    [accountId, perPage, offset],
  );

  const data = result.rows.map((r: DbAuditLog) => ({
    id: r.id,
    action: r.action,
    actor: r.actor ?? r.actor_id,
    target: r.target ?? (r.resource_type && r.resource_id ? `${r.resource_type}:${r.resource_id}` : null),
    details: r.details_jsonb,
    createdAt: r.timestamp,
  }));

  return { data, total, page, perPage, totalPages };
}

export interface SettingsResponse {
  label: string;
  model: string;
  maxConcurrent: number;
  sandboxPoolSize: number;
  auditLogEnabled: boolean;
}

export function getSettings(): SettingsResponse {
  return {
    label: process.env.STAS_LABEL || 'stas:fix',
    model: process.env.OPENCODE_MODEL || 'aimino/agi-v1',
    maxConcurrent: Number(process.env.STAS_MAX_CONCURRENT) || 3,
    sandboxPoolSize: Number(process.env.SANDBOX_POOL_SIZE) || 10,
    auditLogEnabled: process.env.STAS_AUDIT_LOG === 'true',
  };
}

export function updateSettings(updates: Record<string, unknown>): { success: boolean } {
  log.info({ updates }, 'Settings update requested (persistence TBD)');
  return { success: true };
}
