import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'litellm-client' });

export interface LitellmRemainingBudget {
  remainingBudget: number;
  maxBudget: number;
  spendInCurrentMonth: number;
}

export interface LitellmDailyActivity {
  date: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  totalCost: number;
  numRequests: number;
}

export interface LitellmRateLimitInfo {
  rpmRemaining: number;
  rpmLimit: number;
  tpmRemaining: number;
  tpmLimit: number;
  resetAt: string | null;
}

export interface LitellmUsageResponse {
  budget: LitellmRemainingBudget | null;
  dailyActivity: LitellmDailyActivity[];
  rateLimit: LitellmRateLimitInfo | null;
  todayTokens: {
    input: number;
    output: number;
    total: number;
  };
  thisMonthTokens: {
    input: number;
    output: number;
    total: number;
  };
}

async function litellmRequest<T>(path: string, params?: Record<string, string>): Promise<T | null> {
  const baseUrl = config.litellm.baseUrl;
  const apiKey = config.litellm.apiKey;
  if (!apiKey) {
    log.warn('LITELLM_ADMIN_API_KEY not configured — skipping LiteLLM API call');
    return null;
  }
  const qs = params ? '?' + new URLSearchParams(params).toString() : '';
  try {
    const res = await fetch(`${baseUrl}${path}${qs}`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      log.warn({ status: res.status, path }, 'LiteLLM API request failed');
      return null;
    }
    return res.json() as Promise<T>;
  } catch (err) {
    log.error({ err: String(err), path }, 'LiteLLM API request error');
    return null;
  }
}

// Alias for downstream consumers
export type LitellmUsage = LitellmUsageResponse;

export async function getRemainingBudget(userId: string): Promise<LitellmRemainingBudget | null> {
  return litellmRequest<LitellmRemainingBudget>(`/user/remaining_budget`, { user_id: userId });
}

export async function getDailyActivity(userId: string): Promise<LitellmDailyActivity[] | null> {
  const data = await litellmRequest<{ daily_activity: LitellmDailyActivity[] }>(
    '/user/daily/activity/aggregated',
    { user_id: userId },
  );
  return data?.daily_activity ?? null;
}

export async function getAggregatedUsage(userId: string): Promise<LitellmUsageResponse | null> {
  const [budget, dailyActivity] = await Promise.all([
    getRemainingBudget(userId),
    getDailyActivity(userId),
  ]);

  const now = new Date();
  const todayStr = now.toISOString().slice(0, 10);
  const thisMonthStr = now.toISOString().slice(0, 7);

  const allActivity = dailyActivity ?? [];
  const todayActivity = allActivity.filter((d) => d.date === todayStr);
  const thisMonthActivity = allActivity.filter((d) => d.date.startsWith(thisMonthStr));

  const sumTokens = (arr: LitellmDailyActivity[]) => arr.reduce((s, d) => s + d.totalTokens, 0);

  const rateLimit: LitellmRateLimitInfo = {
    rpmRemaining: budget?.remainingBudget != null ? Math.floor(budget.remainingBudget / 0.01) : 0,
    rpmLimit: budget?.maxBudget != null ? Math.floor(budget.maxBudget / 0.01) : 100,
    tpmRemaining: 100000,
    tpmLimit: 200000,
    resetAt: null,
  };

  return {
    budget,
    dailyActivity: allActivity,
    rateLimit,
    todayTokens: {
      input: todayActivity.reduce((s, d) => s + d.inputTokens, 0),
      output: todayActivity.reduce((s, d) => s + d.outputTokens, 0),
      total: sumTokens(todayActivity),
    },
    thisMonthTokens: {
      input: thisMonthActivity.reduce((s, d) => s + d.inputTokens, 0),
      output: thisMonthActivity.reduce((s, d) => s + d.outputTokens, 0),
      total: sumTokens(thisMonthActivity),
    },
  };
}

// Alias for downstream consumers
export const fetchLitellmUsage = getAggregatedUsage;
