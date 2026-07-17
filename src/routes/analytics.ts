/**
 * Agent Performance Analytics API (AIM-2002).
 *
 * Endpoints:
 *   GET /api/analytics/summary   -- Overall aggregate metrics
 *   GET /api/analytics/by-model   -- Performance breakdown by model
 *   GET /api/analytics/by-task    -- Performance breakdown by task type
 *
 * Query params:
 *   days       -- Number of days to look back (default: 30, max: 365)
 *   from       -- Start date (ISO 8601, overrides days)
 *   to         -- End date (ISO 8601)
 */

import { Router, type Request, type Response } from 'express';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'analytics-api' });

const router: Router = Router();


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DailySummary {
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  fixRate: number;
  totalCostCents: number;
  avgCostPerFixCents: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalTokens: number;
  uniqueModels: number;
  uniqueTaskTypes: number;
  daysCovered: number;
  generatedAt: string;
}

interface ModelPerformance {
  model: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  fixRate: number;
  totalCostCents: number;
  avgCostCents: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalTokens: number;
}

interface TaskTypePerformance {
  taskType: string;
  totalRuns: number;
  successfulRuns: number;
  failedRuns: number;
  fixRate: number;
  totalCostCents: number;
  avgCostCents: number;
  totalDurationMs: number;
  avgDurationMs: number;
  totalTokens: number;
}

// ---------------------------------------------------------------------------
// Helper: build WHERE clause from query params
// ---------------------------------------------------------------------------

function buildTimeConditions(
  days: number,
  from?: string,
  to?: string,
): { clause: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];

  if (from) {
    conditions.push('snapshot_date >= $' + (params.length + 1));
    params.push(from);
  } else if (days) {
    conditions.push('snapshot_date >= CURRENT_DATE - $' + (params.length + 1) + '::integer');
    params.push(days);
  }

  if (to) {
    conditions.push('snapshot_date <= $' + (params.length + 1));
    params.push(to);
  }

  return {
    clause: conditions.length > 0 ? conditions.join(' AND ') : '1=1',
    params,
  };
}

// ---------------------------------------------------------------------------
// GET /summary
// ---------------------------------------------------------------------------

router.get('/summary', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.abs(Number(req.query.days) || 30), 365);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const { clause, params } = buildTimeConditions(days, from, to);

    const result = await queryWithRetry<Record<string, unknown>>(
      `
      SELECT
        COALESCE(SUM(total_runs), 0)::integer AS total_runs,
        COALESCE(SUM(successful_runs), 0)::integer AS successful_runs,
        COALESCE(SUM(failed_runs), 0)::integer AS failed_runs,
        COALESCE(SUM(total_cost_cents), 0)::integer AS total_cost_cents,
        COALESCE(SUM(total_duration_ms), 0)::bigint AS total_duration_ms,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens,
        COUNT(DISTINCT model)::integer AS unique_models,
        COUNT(DISTINCT task_type)::integer AS unique_task_types,
        COUNT(DISTINCT snapshot_date)::integer AS days_covered
      FROM agent_analytics_daily
      WHERE ${clause}
      `,
      params,
    );

    const row = result.rows[0];
    if (!row) {
      res.json(emptySummary());
      return;
    }

    const totalRuns = Number(row.total_runs);
    const successfulRuns = Number(row.successful_runs);
    const failedRuns = Number(row.failed_runs);
    const totalCostCents = Number(row.total_cost_cents);
    const totalDurationMs = Number(row.total_duration_ms);
    const totalTokens = Number(row.total_tokens);

    const fixRate = totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 10000) / 10000 : 0;
    const avgCostPerFixCents = successfulRuns > 0 ? Math.round((totalCostCents / successfulRuns) * 100) / 100 : 0;
    const avgDurationMs = totalRuns > 0 ? Math.round(totalDurationMs / totalRuns) : 0;

    const summary: DailySummary = {
      totalRuns,
      successfulRuns,
      failedRuns,
      fixRate,
      totalCostCents,
      avgCostPerFixCents,
      totalDurationMs,
      avgDurationMs,
      totalTokens,
      uniqueModels: Number(row.unique_models),
      uniqueTaskTypes: Number(row.unique_task_types),
      daysCovered: Number(row.days_covered),
      generatedAt: new Date().toISOString(),
    };

    res.json(summary);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch analytics summary');
    res.status(500).json({ error: 'Failed to fetch analytics summary' });
  }
});

// ---------------------------------------------------------------------------
// GET /by-model
// ---------------------------------------------------------------------------

router.get('/by-model', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.abs(Number(req.query.days) || 30), 365);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const { clause, params } = buildTimeConditions(days, from, to);

    const result = await queryWithRetry<Record<string, unknown>>(
      `
      SELECT
        model,
        COALESCE(SUM(total_runs), 0)::integer AS total_runs,
        COALESCE(SUM(successful_runs), 0)::integer AS successful_runs,
        COALESCE(SUM(failed_runs), 0)::integer AS failed_runs,
        COALESCE(SUM(total_cost_cents), 0)::integer AS total_cost_cents,
        COALESCE(SUM(total_duration_ms), 0)::bigint AS total_duration_ms,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
      FROM agent_analytics_daily
      WHERE ${clause}
      GROUP BY model
      ORDER BY total_runs DESC
      `,
      params,
    );

    const models: ModelPerformance[] = result.rows.map((row) => {
      const totalRuns = Number(row.total_runs);
      const successfulRuns = Number(row.successful_runs);
      const totalCostCents = Number(row.total_cost_cents);
      const totalDurationMs = Number(row.total_duration_ms);
      const totalTokens = Number(row.total_tokens);

      return {
        model: String(row.model),
        totalRuns,
        successfulRuns,
        failedRuns: Number(row.failed_runs),
        fixRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 10000) / 10000 : 0,
        totalCostCents,
        avgCostCents: totalRuns > 0 ? Math.round((totalCostCents / totalRuns) * 100) / 100 : 0,
        totalDurationMs,
        avgDurationMs: totalRuns > 0 ? Math.round(totalDurationMs / totalRuns) : 0,
        totalTokens,
      };
    });

    res.json({
      models,
      count: models.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch analytics by model');
    res.status(500).json({ error: 'Failed to fetch analytics by model' });
  }
});

// ---------------------------------------------------------------------------
// GET /by-task
// ---------------------------------------------------------------------------

router.get('/by-task', async (req: Request, res: Response) => {
  try {
    const days = Math.min(Math.abs(Number(req.query.days) || 30), 365);
    const from = req.query.from as string | undefined;
    const to = req.query.to as string | undefined;

    const { clause, params } = buildTimeConditions(days, from, to);

    const result = await queryWithRetry<Record<string, unknown>>(
      `
      SELECT
        task_type,
        COALESCE(SUM(total_runs), 0)::integer AS total_runs,
        COALESCE(SUM(successful_runs), 0)::integer AS successful_runs,
        COALESCE(SUM(failed_runs), 0)::integer AS failed_runs,
        COALESCE(SUM(total_cost_cents), 0)::integer AS total_cost_cents,
        COALESCE(SUM(total_duration_ms), 0)::bigint AS total_duration_ms,
        COALESCE(SUM(total_tokens), 0)::bigint AS total_tokens
      FROM agent_analytics_daily
      WHERE ${clause}
      GROUP BY task_type
      ORDER BY total_runs DESC
      `,
      params,
    );

    const tasks: TaskTypePerformance[] = result.rows.map((row) => {
      const totalRuns = Number(row.total_runs);
      const successfulRuns = Number(row.successful_runs);
      const totalCostCents = Number(row.total_cost_cents);
      const totalDurationMs = Number(row.total_duration_ms);
      const totalTokens = Number(row.total_tokens);

      return {
        taskType: String(row.task_type),
        totalRuns,
        successfulRuns,
        failedRuns: Number(row.failed_runs),
        fixRate: totalRuns > 0 ? Math.round((successfulRuns / totalRuns) * 10000) / 10000 : 0,
        totalCostCents,
        avgCostCents: totalRuns > 0 ? Math.round((totalCostCents / totalRuns) * 100) / 100 : 0,
        totalDurationMs,
        avgDurationMs: totalRuns > 0 ? Math.round(totalDurationMs / totalRuns) : 0,
        totalTokens,
      };
    });

    res.json({
      tasks,
      count: tasks.length,
      generatedAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch analytics by task type');
    res.status(500).json({ error: 'Failed to fetch analytics by task type' });
  }
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function emptySummary(): DailySummary {
  return {
    totalRuns: 0,
    successfulRuns: 0,
    failedRuns: 0,
    fixRate: 0,
    totalCostCents: 0,
    avgCostPerFixCents: 0,
    totalDurationMs: 0,
    avgDurationMs: 0,
    totalTokens: 0,
    uniqueModels: 0,
    uniqueTaskTypes: 0,
    daysCovered: 0,
    generatedAt: new Date().toISOString(),
  };
}

export { router as analyticsRouter };
