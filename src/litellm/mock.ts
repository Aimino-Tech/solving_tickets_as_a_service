import { Router, type Request, type Response } from 'express';
import type { LitellmRemainingBudget, LitellmDailyActivity, LitellmUsageResponse } from './client.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'litellm-mock' });

function generateMockBudget(): LitellmRemainingBudget {
  return {
    remainingBudget: 8750,
    maxBudget: 10000,
    spendInCurrentMonth: 1250,
  };
}

function generateMockDailyActivity(days = 30): LitellmDailyActivity[] {
  const activity: LitellmDailyActivity[] = [];
  const now = new Date();
  for (let i = days; i >= 0; i--) {
    const d = new Date(now);
    d.setDate(d.getDate() - i);
    const inputTokens = Math.floor(Math.random() * 500000) + 100000;
    const outputTokens = Math.floor(Math.random() * 200000) + 50000;
    activity.push({
      date: d.toISOString().slice(0, 10),
      inputTokens,
      outputTokens,
      totalTokens: inputTokens + outputTokens,
      totalCost: parseFloat(((inputTokens * 0.000003) + (outputTokens * 0.000015)).toFixed(4)),
      numRequests: Math.floor(Math.random() * 500) + 50,
    });
  }
  return activity;
}

export function createMockLitellmRouter(): Router {
  const router = Router();

  router.get('/user/remaining_budget', (_req: Request, res: Response) => {
    log.debug('Mock LiteLLM: remaining budget requested');
    res.json(generateMockBudget());
  });

  router.get('/user/daily/activity/aggregated', (_req: Request, res: Response) => {
    log.debug('Mock LiteLLM: daily activity requested');
    res.json({ daily_activity: generateMockDailyActivity() });
  });

  router.all('*', (req: Request, res: Response) => {
    res.status(404).json({ error: `Mock LiteLLM: unknown endpoint ${req.method} ${req.path}` });
  });

  return router;
}

export function generateMockUsageResponse(): LitellmUsageResponse {
  const budget = generateMockBudget();
  const dailyActivity = generateMockDailyActivity(7);
  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const thisMonthStr = now.toISOString().slice(0, 7);

  const todayActivity = dailyActivity.filter((d) => d.date === todayStr);
  const thisMonthActivity = dailyActivity.filter((d) => d.date.startsWith(thisMonthStr));

  return {
    budget,
    dailyActivity,
    rateLimit: {
      rpmRemaining: 85,
      rpmLimit: 100,
      tpmRemaining: 150000,
      tpmLimit: 200000,
      resetAt: new Date(Date.now() + 3600000).toISOString(),
    },
    todayTokens: {
      input: todayActivity.reduce((s, d) => s + d.inputTokens, 0),
      output: todayActivity.reduce((s, d) => s + d.outputTokens, 0),
      total: todayActivity.reduce((s, d) => s + d.totalTokens, 0),
    },
    thisMonthTokens: {
      input: thisMonthActivity.reduce((s, d) => s + d.inputTokens, 0),
      output: thisMonthActivity.reduce((s, d) => s + d.outputTokens, 0),
      total: thisMonthActivity.reduce((s, d) => s + d.totalTokens, 0),
    },
  };
}
