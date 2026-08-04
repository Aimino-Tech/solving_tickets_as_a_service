/**
 * Usage statistics API endpoints.
 *
 * Routes:
 *   GET /api/v1/credits/usage/stats          — Aggregate statistics
 *   GET /api/v1/credits/usage/current-month   — Current month usage with free tier info
 *   GET /api/v1/credits/usage/forecast        — Forecasted end-of-month usage
 */

import { Router, type Request, type Response } from 'express';
import { isTableNotFoundError, queryWithRetry } from '../db/connection.js';
import { getCostConfig, isWithinFreeTier } from './costs.js';
import { getUsageStore } from './tracker.js';

// ---------------------------------------------------------------------------
// Rate Limiting: 60 requests per minute on usage statistics endpoints
// ---------------------------------------------------------------------------

const router: Router = Router();

// ---------------------------------------------------------------------------
// DB-backed aggregates (runs table) with in-memory fallback
//
// Completed runs persist credits_used/cost_cents onto the `runs` row at
// tracker stop() time, so these endpoints read the DB as the source of
// truth. The in-memory store is still consulted when the DB has no data
// yet (fresh install, in-flight runs) or is unavailable.
// ---------------------------------------------------------------------------

interface DbRunStats {
  totalRuns: number;
  totalCredits: number;
  totalDurationMs: number;
  prCount: number;
  runsByModel: Record<string, number>;
}

async function getDbRunStats(): Promise<DbRunStats | null> {
  try {
    const agg = await queryWithRetry<{
      total_runs: number;
      total_credits: number;
      total_duration_ms: number;
      pr_count: number;
    }>(
      `SELECT
         COUNT(*)::int AS total_runs,
         COALESCE(SUM(credits_used), 0)::int AS total_credits,
         COALESCE(SUM(duration_ms), 0)::int AS total_duration_ms,
         COUNT(*) FILTER (WHERE pr_url IS NOT NULL)::int AS pr_count
       FROM runs`,
    );

    const row = agg.rows[0];
    if (!row || row.total_runs === 0) return null;

    const byModel = await queryWithRetry<{ model_used: string | null; count: number }>(
      `SELECT model_used, COUNT(*)::int AS count
       FROM runs
       WHERE model_used IS NOT NULL
       GROUP BY model_used
       ORDER BY count DESC`,
    );
    const runsByModel: Record<string, number> = {};
    for (const m of byModel.rows) {
      if (m.model_used) runsByModel[m.model_used] = Number(m.count);
    }

    return {
      totalRuns: Number(row.total_runs),
      totalCredits: Number(row.total_credits),
      totalDurationMs: Number(row.total_duration_ms),
      prCount: Number(row.pr_count),
      runsByModel,
    };
  } catch (err) {
    if (isTableNotFoundError(err)) return null;
    throw err;
  }
}

interface DbMonthlyUsage {
  credits: number;
  runs: number;
}

function monthlyFromStore(store: ReturnType<typeof getUsageStore>, startOfMonth: Date): DbMonthlyUsage {
  const thisMonth = store.filter((r) => new Date(r.startedAt) >= startOfMonth);
  return {
    credits: thisMonth.reduce((sum, r) => sum + r.totalCredits, 0),
    runs: thisMonth.length,
  };
}

async function getDbMonthlyUsage(): Promise<DbMonthlyUsage | null> {
  try {
    const result = await queryWithRetry<{ total_credits: number; total_runs: number }>(
      `SELECT
         COALESCE(SUM(credits_used), 0)::int AS total_credits,
         COUNT(*)::int AS total_runs
       FROM runs
       WHERE created_at >= DATE_TRUNC('month', NOW())`,
    );

    const row = result.rows[0];
    if (!row || row.total_runs === 0) return null;
    return { credits: Number(row.total_credits), runs: Number(row.total_runs) };
  } catch (err) {
    if (isTableNotFoundError(err)) return null;
    throw err;
  }
}

// ---------------------------------------------------------------------------
// GET /api/v1/credits/usage/stats
// ---------------------------------------------------------------------------

router.get('/stats', async (_req: Request, res: Response) => {
  const store = getUsageStore();

  // Prefer DB aggregates over persisted runs; fall back to the in-memory
  // store when the DB has no runs yet or is unavailable.
  let dbStats: DbRunStats | null = null;
  try {
    dbStats = await getDbRunStats();
  } catch {
    dbStats = null;
  }

  if (dbStats) {
    res.json({
      totalRuns: dbStats.totalRuns,
      totalCredits: dbStats.totalCredits,
      averageCreditsPerRun: Math.round((dbStats.totalCredits / dbStats.totalRuns) * 100) / 100,
      totalDurationMs: dbStats.totalDurationMs,
      runsBySource: {},
      runsByModel: dbStats.runsByModel,
      prCreationRate: Math.round((dbStats.prCount / dbStats.totalRuns) * 10000) / 100, // %
      fallbackRate: 0,
    });
    return;
  }

  if (store.length === 0) {
    res.json({
      totalRuns: 0,
      totalCredits: 0,
      averageCreditsPerRun: 0,
      totalDurationMs: 0,
      runsBySource: {},
      runsByModel: {},
      prCreationRate: 0,
      fallbackRate: 0,
    });
    return;
  }

  // Aggregate
  let totalCredits = 0;
  let totalDurationMs = 0;
  let prCount = 0;
  let fallbackCount = 0;
  const runsBySource: Record<string, number> = {};
  const runsByModel: Record<string, number> = {};

  for (const record of store) {
    totalCredits += record.totalCredits;
    totalDurationMs += record.durationMs;
    if (record.prCreated) prCount++;
    if (record.fallbackUsed) fallbackCount++;

    runsBySource[record.source] = (runsBySource[record.source] ?? 0) + 1;

    for (const model of record.modelsUsed) {
      runsByModel[model] = (runsByModel[model] ?? 0) + 1;
    }
  }

  res.json({
    totalRuns: store.length,
    totalCredits,
    averageCreditsPerRun: Math.round((totalCredits / store.length) * 100) / 100,
    totalDurationMs,
    runsBySource,
    runsByModel,
    prCreationRate: Math.round((prCount / store.length) * 10000) / 100, // %
    fallbackRate: Math.round((fallbackCount / store.length) * 10000) / 100,
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/usage/current-month
// ---------------------------------------------------------------------------

router.get('/current-month', async (_req: Request, res: Response) => {
  const store = getUsageStore();
  const cfg = getCostConfig();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Prefer DB aggregates over persisted runs; fall back to the in-memory
  // store when the DB has no runs this month yet or is unavailable.
  let monthlyCredits: number;
  let monthlyRuns: number;
  try {
    const dbUsage = await getDbMonthlyUsage();
    if (dbUsage) {
      monthlyCredits = dbUsage.credits;
      monthlyRuns = dbUsage.runs;
    } else {
      const storeUsage = monthlyFromStore(store, startOfMonth);
      monthlyCredits = storeUsage.credits;
      monthlyRuns = storeUsage.runs;
    }
  } catch {
    const storeUsage = monthlyFromStore(store, startOfMonth);
    monthlyCredits = storeUsage.credits;
    monthlyRuns = storeUsage.runs;
  }

  res.json({
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    totalCreditsUsed: monthlyCredits,
    totalRuns: monthlyRuns,
    freeTierLimit: cfg.freeMonthlyCredits,
    freeTierRemaining: cfg.freeMonthlyCredits > 0
      ? Math.max(0, cfg.freeMonthlyCredits - monthlyCredits)
      : 'unlimited',
    withinFreeTier: cfg.freeMonthlyCredits > 0 ? isWithinFreeTier(monthlyCredits) : true,
    costConfig: {
      triage: cfg.triage,
      opencodePrimary: cfg.opencodePrimary,
      opencodeFallback: cfg.opencodeFallback,
      prCreation: cfg.prCreation,
      retryPenalty: cfg.retryPenalty,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/usage/usage
//
// OpenCode Go "Kosten" parity: daily cost series stacked by model, totals by
// model, and a per-request breakdown for a given month. DB-backed with the
// same in-memory fallback as /stats. Optional query params:
//   month  — YYYY-MM (default: current month)
//   model  — filter by runs.model_used (default: all models)
//   apiKey — accepted for client compatibility, but the `runs` table has no
//            API-key column, so it is a no-op (no key-specific breakdown).
// The `runs` table has no per-request token columns either, so token fields
// are omitted; `sessionId` is the runs.id of the fix run.
// ---------------------------------------------------------------------------

/** Matches persistRunUsage() in tracker.ts: 100-credit pack → $10.00 → 10¢/credit. */
const USAGE_CREDIT_VALUE_CENTS = 10;

interface UsageSeriesPoint {
  date: string;
  [model: string]: string | number;
}

interface UsageTotalsByModel {
  model: string;
  costCents: number;
  runs: number;
}

interface UsageRequest {
  date: string;
  model: string | null;
  costCents: number;
  sessionId: string;
  runId: number;
  issueNumber: number | null;
  prUrl: string | null;
  durationMs: number | null;
}

interface UsageAnalytics {
  month: string;
  series: UsageSeriesPoint[];
  totalsByModel: UsageTotalsByModel[];
  requests: UsageRequest[];
  filters: { models: string[]; apiKeys: string[] };
}

function isValidMonth(month: string): boolean {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return false;
  const year = Number(match[1]);
  const mon = Number(match[2]);
  return year >= 2000 && year <= 2100 && mon >= 1 && mon <= 12;
}

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

interface DbUsageRow {
  date: string;
  model: string;
  cost_cents: number;
}

interface DbTotalRow {
  model: string;
  cost_cents: number;
  runs: number;
}

interface DbRequestRow {
  id: number;
  created_at: string;
  model_used: string | null;
  cost_cents: number | null;
  duration_ms: number | null;
  issue_number: number | null;
  pr_url: string | null;
}

async function getDbUsage(month: string, model: string | null): Promise<UsageAnalytics | null> {
  const conditions: string[] = [
    `created_at >= DATE_TRUNC('month', $1::date)`,
    `created_at < DATE_TRUNC('month', $1::date) + INTERVAL '1 month'`,
  ];
  const params: unknown[] = [`${month}-01`];
  if (model) {
    conditions.push(`model_used = $2`);
    params.push(model);
  }
  const whereSql = conditions.join(' AND ');

  try {
    const series = await queryWithRetry<DbUsageRow>(
      `SELECT TO_CHAR(DATE_TRUNC('day', created_at), 'YYYY-MM-DD') AS date,
              COALESCE(model_used, 'unknown') AS model,
              COALESCE(SUM(cost_cents), 0)::int AS cost_cents
       FROM runs
       WHERE ${whereSql}
       GROUP BY 1, 2
       ORDER BY 1`,
      params,
    );

    const totals = await queryWithRetry<DbTotalRow>(
      `SELECT COALESCE(model_used, 'unknown') AS model,
              COALESCE(SUM(cost_cents), 0)::int AS cost_cents,
              COUNT(*)::int AS runs
       FROM runs
       WHERE ${whereSql}
       GROUP BY 1
       ORDER BY cost_cents DESC`,
      params,
    );

    const requests = await queryWithRetry<DbRequestRow>(
      `SELECT id, created_at, model_used, cost_cents, duration_ms, issue_number, pr_url
       FROM runs
       WHERE ${whereSql}
       ORDER BY created_at DESC
       LIMIT 200`,
      params,
    );

    if (totals.rows.length === 0 && requests.rows.length === 0) return null;

    const byDay = new Map<string, UsageSeriesPoint>();
    for (const row of series.rows) {
      const point = byDay.get(row.date) ?? { date: row.date };
      point[row.model] = Number(row.cost_cents);
      byDay.set(row.date, point);
    }

    return {
      month,
      series: Array.from(byDay.values()),
      totalsByModel: totals.rows.map((row) => ({
        model: row.model,
        costCents: Number(row.cost_cents),
        runs: Number(row.runs),
      })),
      requests: requests.rows.map((row) => ({
        date: new Date(row.created_at).toISOString(),
        model: row.model_used,
        costCents: Number(row.cost_cents ?? 0),
        sessionId: String(row.id),
        runId: row.id,
        issueNumber: row.issue_number,
        prUrl: row.pr_url,
        durationMs: row.duration_ms,
      })),
      filters: {
        models: totals.rows.map((row) => row.model),
        apiKeys: [], // runs has no API-key column
      },
    };
  } catch (err) {
    if (isTableNotFoundError(err)) return null;
    throw err;
  }
}

/** In-memory fallback when the DB has no runs for the month yet or is unavailable. */
function usageFromStore(store: ReturnType<typeof getUsageStore>, month: string, model: string | null): UsageAnalytics {
  const [yearStr, monthStr] = month.split('-');
  const year = Number(yearStr);
  const mon = Number(monthStr);
  const start = new Date(year, mon - 1, 1);
  const end = new Date(year, mon, 1);

  const records = store.filter((r) => {
    const started = new Date(r.startedAt);
    if (started < start || started >= end) return false;
    if (model && !r.modelsUsed.includes(model)) return false;
    return true;
  });

  const byDay = new Map<string, UsageSeriesPoint>();
  const byModel = new Map<string, { costCents: number; runs: number }>();

  for (const record of records) {
    const date = new Date(record.startedAt);
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    const runModel = record.modelsUsed[0] ?? 'unknown';
    const costCents = Math.round(record.totalCredits * USAGE_CREDIT_VALUE_CENTS);

    const point = byDay.get(day) ?? { date: day };
    point[runModel] = (Number(point[runModel]) || 0) + costCents;
    byDay.set(day, point);

    const agg = byModel.get(runModel) ?? { costCents: 0, runs: 0 };
    agg.costCents += costCents;
    agg.runs += 1;
    byModel.set(runModel, agg);
  }

  const totalsByModel = Array.from(byModel.entries())
    .map(([m, agg]) => ({ model: m, costCents: agg.costCents, runs: agg.runs }))
    .sort((a, b) => b.costCents - a.costCents);

  return {
    month,
    series: Array.from(byDay.values()).sort((a, b) => a.date.localeCompare(b.date)),
    totalsByModel,
    requests: records.map((record) => ({
      date: record.startedAt,
      model: record.modelsUsed[0] ?? null,
      costCents: Math.round(record.totalCredits * USAGE_CREDIT_VALUE_CENTS),
      sessionId: record.runId,
      runId: Number(record.runId) || 0,
      issueNumber: record.issueNumber != null ? Number(record.issueNumber) : null,
      prUrl: null,
      durationMs: record.durationMs,
    })),
    filters: {
      models: totalsByModel.map((t) => t.model),
      apiKeys: [],
    },
  };
}

router.get('/usage', async (req: Request, res: Response) => {
  const store = getUsageStore();

  const rawMonth = typeof req.query.month === 'string' ? req.query.month : '';
  const month = isValidMonth(rawMonth) ? rawMonth : currentMonth();
  const model = typeof req.query.model === 'string' && req.query.model.length > 0 ? req.query.model : null;
  // Accepted for client compatibility; no API-key column exists on `runs`.
  const apiKey = typeof req.query.apiKey === 'string' && req.query.apiKey.length > 0 ? req.query.apiKey : null;

  let data: UsageAnalytics | null = null;
  try {
    data = await getDbUsage(month, model);
  } catch {
    data = null;
  }

  if (!data) data = usageFromStore(store, month, model);

  res.json({
    ...data,
    filters: {
      ...data.filters,
      apiKeys: apiKey && !data.filters.apiKeys.includes(apiKey) ? [apiKey] : data.filters.apiKeys,
    },
  });
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/usage/forecast
// ---------------------------------------------------------------------------

router.get('/forecast', async (_req: Request, res: Response) => {
  const store = getUsageStore();
  const cfg = getCostConfig();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysInMonth = endOfMonth.getDate();
  const daysElapsed = now.getDate();
  const daysRemaining = daysInMonth - daysElapsed + 1;

  // Current month usage — DB-backed with in-memory fallback (same as /current-month)
  let monthlyCredits: number;
  let monthlyRuns: number;
  try {
    const dbUsage = await getDbMonthlyUsage();
    if (dbUsage) {
      monthlyCredits = dbUsage.credits;
      monthlyRuns = dbUsage.runs;
    } else {
      const storeUsage = monthlyFromStore(store, startOfMonth);
      monthlyCredits = storeUsage.credits;
      monthlyRuns = storeUsage.runs;
    }
  } catch {
    const storeUsage = monthlyFromStore(store, startOfMonth);
    monthlyCredits = storeUsage.credits;
    monthlyRuns = storeUsage.runs;
  }

  // Daily average
  const avgDailyCredits = daysElapsed > 0 ? monthlyCredits / daysElapsed : 0;
  const avgDailyRuns = daysElapsed > 0 ? monthlyRuns / daysElapsed : 0;

  // Forecast
  const forecastCredits = Math.round(avgDailyCredits * daysInMonth);
  const forecastRuns = Math.round(avgDailyRuns * daysInMonth);
  const projectedRemaining = Math.round(avgDailyCredits * daysRemaining);

  const wouldExceedFreeTier = cfg.freeMonthlyCredits > 0
    && (monthlyCredits + projectedRemaining) > cfg.freeMonthlyCredits;

  res.json({
    forecastDate: now.toISOString(),
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
    daysElapsed,
    daysRemaining,
    daysInMonth,
    currentUsage: {
      credits: monthlyCredits,
      runs: monthlyRuns,
    },
    dailyAverage: {
      credits: Math.round(avgDailyCredits * 100) / 100,
      runs: Math.round(avgDailyRuns * 100) / 100,
    },
    forecast: {
      endOfMonthCredits: forecastCredits,
      endOfMonthRuns: forecastRuns,
      projectedRemainingCredits: projectedRemaining,
    },
    freeTier: {
      limit: cfg.freeMonthlyCredits,
      wouldExceed: wouldExceedFreeTier,
      estimatedOverage: cfg.freeMonthlyCredits > 0
        ? Math.max(0, forecastCredits - cfg.freeMonthlyCredits)
        : 0,
    },
  });
});

export { router as usageRouter };
