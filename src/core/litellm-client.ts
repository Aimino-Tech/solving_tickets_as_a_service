import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'litellm-client' });

export interface LiteLLMUserInfo {
  user_id: string;
  spend: number;
  max_budget: number | null;
  model_max_budget: Record<string, number> | null;
  budget_duration: string | null;
  token_count: number;
  last_updated: string;
}

export interface LiteLLMSpendEntry {
  group_by_day: string;
  teams: Array<{
    team_name: string;
    spend: number;
    keys: Array<{
      key_name: string;
      usage: Record<string, {
        cost: number;
        input_tokens: number;
        output_tokens: number;
        requests: number;
      }>;
    }>;
  }>;
}

export interface LiteLLMUsageData {
  budget: { maxBudget: number | null; spent: number; remaining: number | null };
  dailyUsage: Array<{ date: string; cost: number; inputTokens: number; outputTokens: number; requests: number }>;
  rateLimits: { remainingRequests: number | null; remainingTokens: number | null; resetAt: string | null };
}

export class LiteLLMClient {
  private baseUrl: string;
  private adminKey: string;

  constructor(baseUrl?: string, adminKey?: string) {
    this.baseUrl = (baseUrl ?? process.env.LITELLM_PROXY_URL ?? 'http://llm-governance:4002').replace(/\/+$/, '');
    this.adminKey = adminKey ?? process.env.LITELLM_ADMIN_KEY ?? '';
  }

  private async request<T>(path: string): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.adminKey) {
      headers['Authorization'] = `Bearer ${this.adminKey}`;
    }
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      throw new Error(`LiteLLM API error: ${res.status} ${res.statusText} for ${path}`);
    }
    return res.json() as Promise<T>;
  }

  async getUserInfo(userId: string): Promise<LiteLLMUserInfo | null> {
    try {
      return await this.request<LiteLLMUserInfo>(`/user/${encodeURIComponent(userId)}`);
    } catch (err) {
      log.warn({ err, userId }, 'Failed to fetch LiteLLM user info');
      return null;
    }
  }

  async getGlobalSpendReport(params: { startDate?: string; endDate?: string; userId?: string }): Promise<LiteLLMSpendEntry[]> {
    const qs = new URLSearchParams();
    if (params.startDate) qs.set('start_date', params.startDate);
    if (params.endDate) qs.set('end_date', params.endDate);
    if (params.userId) qs.set('internal_user_id', params.userId);
    const query = qs.toString();
    try {
      return await this.request<LiteLLMSpendEntry[]>(`/global/spend/report${query ? `?${query}` : ''}`);
    } catch (err) {
      log.warn({ err }, 'Failed to fetch LiteLLM spend report');
      return [];
    }
  }

  async getUsage(userId: string): Promise<LiteLLMUsageData> {
    const [userInfo, spendReport] = await Promise.all([
      this.getUserInfo(userId),
      this.getGlobalSpendReport({ userId }),
    ]);

    const budget = {
      maxBudget: userInfo?.max_budget ?? null,
      spent: userInfo?.spend ?? 0,
      remaining: userInfo?.max_budget != null ? userInfo.max_budget - userInfo.spend : null,
    };

    const dailyUsage: LiteLLMUsageData['dailyUsage'] = [];
    for (const day of spendReport) {
      for (const team of day.teams) {
        for (const key of team.keys) {
          for (const [model, usage] of Object.entries(key.usage)) {
            dailyUsage.push({
              date: day.group_by_day,
              cost: usage.cost,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              requests: usage.requests,
            });
          }
        }
      }
    }

    return {
      budget,
      dailyUsage: dailyUsage.slice(0, 90),
      rateLimits: { remainingRequests: null, remainingTokens: null, resetAt: null },
    };
  }
}
