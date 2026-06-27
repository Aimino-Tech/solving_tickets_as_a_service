import { Redis } from 'ioredis';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'rate-budget' });

const BUDGET_KEY_PREFIX = 'ratelimit:budget:';
const DAILY_BUDGET_USD = Number(process.env.RATE_LIMIT_DAILY_BUDGET_USD) || 5;
const WARNING_THRESHOLD = 0.8;

let redisClient: Redis | null = null;

function getClient(): Redis {
  if (!redisClient) {
    redisClient = new Redis(config.queue.redisUrl, {
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      retryStrategy: (times: number) => {
        const delay = Math.min(times * 100, 3000);
        return delay;
      },
      lazyConnect: true,
    });
    redisClient.on('error', (err) => {
      log.error({ err: String(err) }, 'Budget tracker Redis error');
    });
  }
  return redisClient;
}

export async function closeBudgetClient(): Promise<void> {
  if (redisClient) {
    try {
      await redisClient.quit();
    } catch (err) {
      log.warn({ err: String(err) }, 'Error closing budget Redis client');
    }
    redisClient = null;
  }
}

export interface BudgetResult {
  allowed: boolean;
  dailyBudgetUsd: number;
  currentSpendUsd: number;
  remainingUsd: number;
  usagePercent: number;
  atWarning: boolean;
  windowReset: string;
}

function dailyKey(tenantId: string): string {
  const today = new Date().toISOString().slice(0, 10);
  return `${BUDGET_KEY_PREFIX}${tenantId}:${today}`;
}

function getTierDailyBudget(_tenantId: number): number {
  return DAILY_BUDGET_USD;
}

export async function checkDailyBudget(tenantId: number, tenantLabel: string): Promise<BudgetResult> {
  const dailyBudgetUsd = getTierDailyBudget(tenantId);
  const client = getClient();
  const key = dailyKey(tenantLabel);

  try {
    const currentSpendStr = await client.get(key);
    const currentSpendUsd = currentSpendStr ? Number.parseFloat(currentSpendStr) : 0;
    const usagePercent = dailyBudgetUsd > 0 ? currentSpendUsd / dailyBudgetUsd : 0;
    const remainingUsd = Math.max(0, dailyBudgetUsd - currentSpendUsd);
    const atWarning = usagePercent >= WARNING_THRESHOLD;

    const ttl = await client.ttl(key);
    const windowReset = ttl > 0
      ? new Date(Date.now() + ttl * 1000).toISOString()
      : new Date(Date.now() + 86400000).toISOString();

    return {
      allowed: currentSpendUsd < dailyBudgetUsd,
      dailyBudgetUsd,
      currentSpendUsd,
      remainingUsd,
      usagePercent,
      atWarning,
      windowReset,
    };
  } catch (err) {
    log.error({ err: String(err), tenantId }, 'Daily budget check failed');
    return {
      allowed: true,
      dailyBudgetUsd,
      currentSpendUsd: 0,
      remainingUsd: dailyBudgetUsd,
      usagePercent: 0,
      atWarning: false,
      windowReset: new Date(Date.now() + 86400000).toISOString(),
    };
  }
}

export async function recordDailyCost(tenantId: number, tenantLabel: string, costUsd: number): Promise<void> {
  const client = getClient();
  const key = dailyKey(tenantLabel);

  try {
    const pipeline = client.pipeline();
    pipeline.incrbyfloat(key, costUsd);
    pipeline.expire(key, 86400);
    await pipeline.exec();
  } catch (err) {
    log.error({ err: String(err), tenantId, costUsd }, 'Failed to record daily cost');
  }
}

export async function resetDailyBudget(tenantLabel: string): Promise<void> {
  const client = getClient();
  const key = dailyKey(tenantLabel);
  try {
    await client.del(key);
  } catch (err) {
    log.error({ err: String(err), tenantLabel }, 'Failed to reset daily budget');
  }
}
