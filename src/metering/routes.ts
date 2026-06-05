/**
 * Usage statistics API endpoints.
 *
 * Routes:
 *   GET /api/v1/credits/usage/stats          — Aggregate statistics
 *   GET /api/v1/credits/usage/current-month   — Current month usage with free tier info
 *   GET /api/v1/credits/usage/forecast        — Forecasted end-of-month usage
 */

import { Router, type Request, type Response } from 'express';
import { getUsageStore } from './tracker.js';
import { getCostConfig, isWithinFreeTier } from './costs.js';

const router = Router();

// ---------------------------------------------------------------------------
// GET /api/v1/credits/usage/stats
// ---------------------------------------------------------------------------

router.get('/stats', (_req: Request, res: Response) => {
  const store = getUsageStore();

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

router.get('/current-month', (_req: Request, res: Response) => {
  const store = getUsageStore();
  const cfg = getCostConfig();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // Filter records from this month
  const thisMonth = store.filter((r) => new Date(r.startedAt) >= startOfMonth);

  const monthlyCredits = thisMonth.reduce((sum, r) => sum + r.totalCredits, 0);
  const monthlyRuns = thisMonth.length;

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

router.get('/forecast', (_req: Request, res: Response) => {
  const store = getUsageStore();
  const cfg = getCostConfig();

  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0);
  const daysInMonth = endOfMonth.getDate();
  const daysElapsed = now.getDate();
  const daysRemaining = daysInMonth - daysElapsed + 1;

  // Current month usage
  const thisMonth = store.filter((r) => new Date(r.startedAt) >= startOfMonth);
  const monthlyCredits = thisMonth.reduce((sum, r) => sum + r.totalCredits, 0);
  const monthlyRuns = thisMonth.length;

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
