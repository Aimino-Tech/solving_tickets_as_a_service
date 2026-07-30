/**
 * Pipeline Run Store — persistent analytics and search for pipeline run history.
 *
 * Provides:
 * - Create/update pipeline runs with stage-level event tracking
 * - Query runs with filters (tenant, date range, status, agent type)
 * - 90-day automatic retention policy enforcement
 * - CSV export generation
 * - Aggregate statistics
 *
 * @module history/pipelineRunStore
 */

import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'pipeline-run-store' });

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default retention period in days — runs older than this are auto-purged. */
export const DEFAULT_RETENTION_DAYS = 90;

/** Maximum page size for query results. */
export const MAX_PAGE_SIZE = 100;

/** Default page size. */
export const DEFAULT_PAGE_SIZE = 50;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelineStageEvent {
  id?: number;
  runId: number;
  tenantId: string;
  stageName: string;
  status: 'running' | 'completed' | 'failed' | 'skipped';
  startedAt?: string | null;
  completedAt?: string | null;
  durationMs?: number;
  output?: string;
  error?: string;
  metadata?: Record<string, unknown>;
  createdAt?: string;
}

export interface PipelineRun {
  id: number;
  tenantId: string;
  issueId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  agentType: string;
  stages: PipelineStageEvent[];
  error: string;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface NewPipelineRun {
  tenantId: string;
  issueId: string;
  status?: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  agentType?: string;
  stages?: PipelineStageEvent[];
  error?: string;
  startedAt?: string | null;
  completedAt?: string | null;
}

export interface RunQueryFilters {
  tenantId?: string;
  status?: string;
  agentType?: string;
  issueId?: string;
  dateFrom?: string;
  dateTo?: string;
  offset?: number;
  limit?: number;
}

export interface RunStats {
  total: number;
  byStatus: Record<string, number>;
  byAgentType: Record<string, number>;
  successRate: number;
  avgDurationMs: number;
  totalErrors: number;
  retentionDays: number;
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Row types returned by pg
// ---------------------------------------------------------------------------

interface PipelineRunRow {
  id: number;
  tenant_id: string;
  issue_id: string;
  status: string;
  agent_type: string;
  stages: string; // JSON string from DB
  error: string;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface StatsRow {
  total_runs: string;
  by_status: Record<string, unknown>;
  by_agent_type: Record<string, unknown>;
  success_rate: string;
  avg_duration_ms: string;
  total_errors: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseRunRow(row: PipelineRunRow): PipelineRun {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    issueId: row.issue_id,
    status: row.status as PipelineRun['status'],
    agentType: row.agent_type,
    stages: typeof row.stages === 'string' ? JSON.parse(row.stages) : row.stages,
    error: row.error,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export class PipelineRunStore {
  // -----------------------------------------------------------------------
  // Pipeline runs
  // -----------------------------------------------------------------------

  /**
   * Create a new pipeline run record.
   */
  async createRun(data: NewPipelineRun): Promise<PipelineRun> {
    const result = await queryWithRetry<PipelineRunRow>(
      `INSERT INTO pipeline_runs (tenant_id, issue_id, status, agent_type, stages, error, started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [
        data.tenantId,
        data.issueId,
        data.status ?? 'pending',
        data.agentType ?? '',
        JSON.stringify(data.stages ?? []),
        data.error ?? '',
        data.startedAt ?? null,
      ],
    );
    return parseRunRow(result.rows[0]);
  }

  /**
   * Update a pipeline run's status and timeline.
   */
  async updateRun(
    id: number,
    updates: Partial<{
      status: string;
      error: string;
      agentType: string;
      stages: PipelineStageEvent[];
      startedAt: string | null;
      completedAt: string | null;
    }>,
  ): Promise<PipelineRun | undefined> {
    const setClauses: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 0;

    if (updates.status !== undefined) {
      paramIndex++;
      setClauses.push(`status = $${paramIndex}`);
      params.push(updates.status);
    }
    if (updates.error !== undefined) {
      paramIndex++;
      setClauses.push(`error = $${paramIndex}`);
      params.push(updates.error);
    }
    if (updates.agentType !== undefined) {
      paramIndex++;
      setClauses.push(`agent_type = $${paramIndex}`);
      params.push(updates.agentType);
    }
    if (updates.stages !== undefined) {
      paramIndex++;
      setClauses.push(`stages = $${paramIndex}`);
      params.push(JSON.stringify(updates.stages));
    }
    if (updates.startedAt !== undefined) {
      paramIndex++;
      setClauses.push(`started_at = $${paramIndex}`);
      params.push(updates.startedAt);
    }
    if (updates.completedAt !== undefined) {
      paramIndex++;
      setClauses.push(`completed_at = $${paramIndex}`);
      params.push(updates.completedAt);
    }

    if (setClauses.length === 0) {
      return undefined;
    }

    // Always bump updated_at
    setClauses.push('updated_at = NOW()');

    paramIndex++;
    params.push(id);

    const result = await queryWithRetry<PipelineRunRow>(
      `UPDATE pipeline_runs SET ${setClauses.join(', ')} WHERE id = $${paramIndex} RETURNING *`,
      params,
    );
    return result.rows[0] ? parseRunRow(result.rows[0]) : undefined;
  }

  /**
   * Mark a run as completed with final status and timing.
   */
  async completeRun(
    id: number,
    status: 'completed' | 'failed' | 'cancelled',
    error?: string,
  ): Promise<PipelineRun | undefined> {
    return this.updateRun(id, {
      status,
      error: error ?? '',
      completedAt: new Date().toISOString(),
    });
  }

  /**
   * Get a single pipeline run by ID.
   */
  async getRunById(id: number): Promise<PipelineRun | undefined> {
    const result = await queryWithRetry<PipelineRunRow>(
      'SELECT * FROM pipeline_runs WHERE id = $1',
      [id],
    );
    return result.rows[0] ? parseRunRow(result.rows[0]) : undefined;
  }

  /**
   * Query pipeline runs with optional filters.
   */
  async queryRuns(filters: RunQueryFilters = {}): Promise<{
    runs: PipelineRun[];
    total: number;
    offset: number;
    limit: number;
  }> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 0;

    if (filters.tenantId) {
      paramIndex++;
      conditions.push(`tenant_id = $${paramIndex}`);
      params.push(filters.tenantId);
    }
    if (filters.status) {
      paramIndex++;
      conditions.push(`status = $${paramIndex}`);
      params.push(filters.status);
    }
    if (filters.agentType) {
      paramIndex++;
      conditions.push(`agent_type = $${paramIndex}`);
      params.push(filters.agentType);
    }
    if (filters.issueId) {
      paramIndex++;
      conditions.push(`issue_id = $${paramIndex}`);
      params.push(filters.issueId);
    }
    if (filters.dateFrom) {
      paramIndex++;
      conditions.push(`created_at >= $${paramIndex}::timestamptz`);
      params.push(filters.dateFrom);
    }
    if (filters.dateTo) {
      paramIndex++;
      conditions.push(`created_at <= $${paramIndex}::timestamptz`);
      params.push(filters.dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const offset = Math.max(0, filters.offset ?? 0);
    const limit = Math.min(Math.max(1, filters.limit ?? DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);

    // Get total count
    const countResult = await queryWithRetry<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM pipeline_runs ${whereClause}`,
      params,
    );
    const total = Number(countResult.rows[0]?.count ?? 0);

    // Get paginated results
    const dataParams = [...params, limit, offset];
    const dataResult = await queryWithRetry<PipelineRunRow>(
      `SELECT * FROM pipeline_runs ${whereClause} ORDER BY created_at DESC LIMIT $${paramIndex + 1} OFFSET $${paramIndex + 2}`,
      dataParams,
    );

    return {
      runs: dataResult.rows.map(parseRunRow),
      total,
      offset,
      limit,
    };
  }

  // -----------------------------------------------------------------------
  // Stage events
  // -----------------------------------------------------------------------

  /**
   * Record a stage event for a pipeline run.
   */
  async recordStageEvent(event: {
    runId: number;
    tenantId: string;
    stageName: string;
    status: 'running' | 'completed' | 'failed' | 'skipped';
    startedAt?: string | null;
    completedAt?: string | null;
    durationMs?: number;
    output?: string;
    error?: string;
    metadata?: Record<string, unknown>;
  }): Promise<PipelineStageEvent> {
    const result = await queryWithRetry<PipelineStageEvent>(
      `INSERT INTO pipeline_stage_events (run_id, tenant_id, stage_name, status, started_at, completed_at, duration_ms, output, error, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING *`,
      [
        event.runId,
        event.tenantId,
        event.stageName,
        event.status,
        event.startedAt ?? null,
        event.completedAt ?? null,
        event.durationMs ?? 0,
        event.output ?? '',
        event.error ?? '',
        JSON.stringify(event.metadata ?? {}),
      ],
    );
    return result.rows[0];
  }

  /**
   * Get all stage events for a specific run.
   */
  async getStageEvents(runId: number): Promise<PipelineStageEvent[]> {
    const result = await queryWithRetry<PipelineStageEvent>(
      `SELECT * FROM pipeline_stage_events WHERE run_id = $1 ORDER BY created_at ASC`,
      [runId],
    );
    return result.rows;
  }

  // -----------------------------------------------------------------------
  // Retention
  // -----------------------------------------------------------------------

  /**
   * Enforce the retention policy — delete runs older than the specified days.
   * Returns the number of deleted runs.
   */
  async enforceRetention(retentionDays: number = DEFAULT_RETENTION_DAYS): Promise<number> {
    const result = await queryWithRetry<{ deleted: string }>(
      `WITH deleted AS (
         DELETE FROM pipeline_runs
         WHERE created_at < NOW() - $1::integer * INTERVAL '1 day'
         RETURNING id
       )
       SELECT COUNT(*)::text AS deleted FROM deleted`,
      [retentionDays],
    );
    const count = Number(result.rows[0]?.deleted ?? 0);
    if (count > 0) {
      log.info({ deletedRuns: count, retentionDays }, `Retention policy purged ${count} old runs`);
    }
    return count;
  }

  // -----------------------------------------------------------------------
  // Export
  // -----------------------------------------------------------------------

  /**
   * Generate CSV data from filtered pipeline runs.
   * Returns the CSV as a string with a header row.
   */
  async exportToCSV(filters: RunQueryFilters = {}): Promise<string> {
    const { runs } = await this.queryRuns({ ...filters, limit: MAX_PAGE_SIZE });

    const header = 'ID,Tenant ID,Issue ID,Status,Agent Type,Error,Started At,Completed At,Created At,Stage Count';
    const rows = runs.map((r) => {
      const stageCount = Array.isArray(r.stages) ? r.stages.length : 0;
      const escape = (val: string | null | undefined): string => {
        if (val == null) return '';
        const str = String(val);
        if (str.includes(',') || str.includes('"') || str.includes('\n')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      };
      return [
        String(r.id),
        escape(r.tenantId),
        escape(r.issueId),
        escape(r.status),
        escape(r.agentType),
        escape(r.error),
        escape(r.startedAt),
        escape(r.completedAt),
        escape(r.createdAt),
        String(stageCount),
      ].join(',');
    });

    return [header, ...rows].join('\n');
  }

  // -----------------------------------------------------------------------
  // Stats
  // -----------------------------------------------------------------------

  /**
   * Get aggregated statistics for pipeline runs.
   */
  async getStats(tenantId?: string, dateFrom?: string, dateTo?: string): Promise<RunStats> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let paramIndex = 0;

    if (tenantId) {
      paramIndex++;
      conditions.push(`tenant_id = $${paramIndex}`);
      params.push(tenantId);
    }
    if (dateFrom) {
      paramIndex++;
      conditions.push(`created_at >= $${paramIndex}::timestamptz`);
      params.push(dateFrom);
    }
    if (dateTo) {
      paramIndex++;
      conditions.push(`created_at <= $${paramIndex}::timestamptz`);
      params.push(dateTo);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const result = await queryWithRetry<StatsRow>(
      `SELECT
         COUNT(*)::text AS total_runs,
         COALESCE(
           (SELECT json_object_agg(status, cnt) FROM (
             SELECT status, COUNT(*)::text AS cnt FROM pipeline_runs ${whereClause} GROUP BY status
           ) sub),
           '{}'::json
         )::text AS by_status,
         COALESCE(
           (SELECT json_object_agg(agent_type, cnt) FROM (
             SELECT agent_type, COUNT(*)::text AS cnt FROM pipeline_runs ${whereClause} GROUP BY agent_type
           ) sub2),
           '{}'::json
         )::text AS by_agent_type,
         COALESCE(
           (SELECT ROUND(COUNT(*) FILTER (WHERE status = 'completed')::numeric / NULLIF(COUNT(*), 0), 4)::text FROM pipeline_runs ${whereClause}),
           '0'
         ) AS success_rate,
         COALESCE(
           (SELECT COALESCE(
             (SELECT ROUND(AVG(EXTRACT(EPOCH FROM (completed_at - started_at)) * 1000)::numeric, 0)::text
              FROM pipeline_runs ${whereClause} WHERE started_at IS NOT NULL AND completed_at IS NOT NULL),
           '0')),
           '0'
         ) AS avg_duration_ms,
         COALESCE(
           (SELECT COUNT(*)::text FROM pipeline_runs ${whereClause} WHERE error != ''),
           '0'
         ) AS total_errors
      `,
      params,
    );

    const row = result.rows[0];

    let byStatus: Record<string, number> = {};
    let byAgentType: Record<string, number> = {};
    try {
      byStatus = JSON.parse(String(row?.by_status ?? '{}'));
      byAgentType = JSON.parse(String(row?.by_agent_type ?? '{}'));
    } catch {
      // Graceful fallback
    }

    return {
      total: Number(row?.total_runs ?? 0),
      byStatus,
      byAgentType,
      successRate: Number(row?.success_rate ?? 0),
      avgDurationMs: Number(row?.avg_duration_ms ?? 0),
      totalErrors: Number(row?.total_errors ?? 0),
      retentionDays: DEFAULT_RETENTION_DAYS,
      generatedAt: new Date().toISOString(),
    };
  }
}

// ---------------------------------------------------------------------------
// Singleton export
// ---------------------------------------------------------------------------

export const pipelineRunStore = new PipelineRunStore();
