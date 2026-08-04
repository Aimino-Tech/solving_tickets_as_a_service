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
