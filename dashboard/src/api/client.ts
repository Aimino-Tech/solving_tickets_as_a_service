import type {
  Run, DashboardStats, AuditEntry, PaginatedResponse, BenchmarkEntry, BenchmarkPrice,
  KpiResponse, PricingData, CostCalculation, VsComparisonData,
} from '@/api/types';

export type { DashboardStats };

const API_BASE = '/api';

function getToken(): string | null {
  try {
    return localStorage.getItem('stas_token');
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem('stas_token', token);
  } catch {}
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem('stas_refresh_token');
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string): void {
  try {
    localStorage.setItem('stas_refresh_token', token);
  } catch {}
}

export function clearToken(): void {
  try {
    localStorage.removeItem('stas_token');
    localStorage.removeItem('stas_refresh_token');
  } catch {}
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    const refreshToken = getRefreshToken();
    if (refreshToken && !path.includes('/auth/refresh')) {
      try {
        const refreshRes = await fetch(`${API_BASE}/v1/auth/refresh`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ refreshToken }),
        });
        if (refreshRes.ok) {
          const data = await refreshRes.json();
          setToken(data.token);
          if (data.refreshToken) setRefreshToken(data.refreshToken);
          headers['Authorization'] = `Bearer ${data.token}`;
          const retryRes = await fetch(`${API_BASE}${path}`, { ...options, headers });
          if (retryRes.ok) return retryRes.json() as Promise<T>;
        }
      } catch (refreshErr) {
        console.warn('Token refresh failed:', refreshErr);
      }
    }
    if (path.includes('/auth/')) {
      clearToken();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  user: { id: string; email: string; name: string | null; createdAt?: string };
}

export interface CreditBalance {
  accountId: number;
  balance: number;
  lifetimeCredits: number;
}

export interface Transaction {
  id: number;
  accountId: number;
  amount: number;
  type: string;
  description: string | null;
  createdAt: string;
}

export interface MonthlyUsage {
  periodStart: string;
  totalCredits: number;
  totalTransactions: number;
}

export interface BillingPlan {
  id: string;
  name: string;
  description?: string;
  price?: string;
  period?: string;
  features?: string[];
  highlighted?: boolean;
  amountCents?: number;
  trialDays?: number;
  monthlyFixLimit?: number;
  concurrentFixes?: number;
}

export const litellm = {
  usage: () =>
    request<LitellmUsage>('/v1/litellm/usage'),
};

export interface HealthCheck {
  status: string;
  latencyMs?: number;
  error?: string;
}

export interface HealthResponse {
  status: 'ok' | 'degraded';
  checks: Record<string, HealthCheck>;
  timestamp: string;
  aiMode?: string;
  uptime?: number;
  memoryUsage?: NodeJS.MemoryUsage;
}

export interface SLAByTier {
  count: number;
  breaches: number;
  attainmentRate: number;
  p50: number | null;
  p95: number | null;
}

export interface LitellmUsage {
  configured: boolean;
  message?: string;
  remainingBudget?: number;
  tokensToday?: { input: number; output: number; total: number };
  requestsToday?: number;
  rateLimit?: { rpmRemaining: number; rpmLimit: number; tpmRemaining: number; tpmLimit: number; resetAt?: string };
  budget?: { remainingBudget: number; spendInCurrentMonth: number; maxBudget: number };
  todayTokens?: { input: number; output: number; total: number };
  thisMonthTokens?: { input: number; output: number; total: number };
}

export interface SLAMetrics {
  totalRecorded: number;
  attainmentRate: number | null;
  fixTimesMs: {
    p50: number | null;
    p95: number | null;
    p99: number | null;
  };
  breaches: number;
  byTier: Record<string, SLAByTier>;
}

export const auth = {
  loginUrl: () => '/api/auth/github',
  register: (email: string, password: string, name?: string) =>
    request<AuthResult>('/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<AuthResult>('/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () =>
    request<{ id: string; email: string; name: string | null; createdAt: string }>('/v1/auth/me'),
  refresh: (refreshToken: string) =>
    request<AuthResult>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  logout: () =>
    request<{ message: string }>('/v1/auth/logout', { method: 'POST' }),
};

export const credits = {
  balance: (opts?: { signal?: AbortSignal }) => request<CreditBalance>('/v1/credits/balance', opts),
  transactions: (limit = 50, offset = 0, opts?: { signal?: AbortSignal }) =>
    request<{ transactions: Transaction[]; pagination: { limit: number; offset: number; total: number } }>(
      `/v1/credits/transactions?limit=${limit}&offset=${offset}`, opts,
    ),
  topUp: (priceId: string, successUrl: string, cancelUrl: string) =>
    request<{ url: string; sessionId: string }>('/v1/credits/top-up', {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    }),
  usage: (period: 'daily' | 'weekly' | 'monthly' = 'monthly', opts?: { signal?: AbortSignal }) =>
    request<{ accountId: number; period: string; usage: MonthlyUsage[] }>(
      `/v1/credits/usage?period=${period}`, opts,
    ),
};

export const runs = {
  list: (params?: {
    page?: number;
    perPage?: number;
    status?: string;
    repo?: string;
    from?: string;
    to?: string;
  }, opts?: { signal?: AbortSignal }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    if (params?.status) qs.set('status', params.status);
    if (params?.repo) qs.set('repo', params.repo);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const query = qs.toString();
    return request<{ data: Run[]; total: number; page: number; perPage: number; totalPages: number }>(
      `/v1/runs${query ? `?${query}` : ''}`, opts,
    );
  },
  get: (id: string, opts?: { signal?: AbortSignal }) => request<Run>(`/v1/runs/${id}`, opts),
  feedbackSubmit: (id: string, verdict: string, comment?: string) =>
    request<{ success: boolean }>(`/v1/runs/${id}/feedback`, {
      method: 'POST',
      body: JSON.stringify({ verdict, comment }),
    }),
  escalate: (id: string, reason: string) =>
    request<{ success: boolean }>(`/v1/runs/${id}/escalate`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
  rollback: (id: string, reason: string) =>
    request<{ success: boolean }>(`/v1/runs/${id}/rollback`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),
};

export interface GitHubInstallation {
  installationId: number;
  accountLogin: string;
  accountType: string;
  repoScope: string;
  repos: Array<{
    id: number;
    name: string;
    fullName: string;
    owner: string;
    private: boolean;
    description: string | null;
    defaultBranch: string;
    language: string | null;
    stasInstalled: boolean;
    webhookId: number | null;
  }>;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  githubLogin?: string;
  githubUserId?: number;
}

export const repos = {
  list: (opts?: { signal?: AbortSignal }) =>
    request<{ id: string; owner: string; repo: string; active: boolean; createdAt: string }[]>('/repos', opts),
  connect: (body: { owner: string; repo: string; installationId?: number }) =>
    request<{ id: string; owner: string; repo: string; active: boolean }>('/repos', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  disconnect: (id: string) =>
    request<{ success: boolean }>(`/repos/${id}`, { method: 'DELETE' }),
};

export const github = {
  getOAuthUrl: () =>
    request<{ url: string }>('/v1/auth/github/url', { method: 'POST' }),
  handleCallback: (code: string, opts?: { signal?: AbortSignal }) =>
    request<{ githubLogin: string; githubUserId: number; avatarUrl: string }>('/v1/auth/github/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
      ...opts,
    }),
  getStatus: (opts?: { signal?: AbortSignal }) =>
    request<GitHubConnectionStatus>('/v1/auth/github/status', opts),
  disconnect: () =>
    request<{ success: boolean }>('/v1/auth/github/disconnect', { method: 'DELETE' }),
  listInstallations: (opts?: { signal?: AbortSignal }) =>
    request<{ installations: GitHubInstallation[] }>('/v1/github/installations', opts),
  syncInstallation: (body: { installationId: number; accountLogin: string; accountType?: string; repoScope?: string }) =>
    request<{ success: boolean }>('/v1/github/installations/sync', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  removeInstallation: (installationId: number) =>
    request<{ success: boolean }>(`/v1/github/installations/${installationId}`, { method: 'DELETE' }),
  configureWebhook: (installationId: number, owner: string, repo: string) =>
    request<{ success: boolean; webhookId: number }>(
      `/v1/github/installations/${installationId}/repos/${owner}/${repo}/webhook`,
      { method: 'POST' },
    ),
  removeWebhook: (installationId: number, owner: string, repo: string) =>
    request<{ success: boolean }>(
      `/v1/github/installations/${installationId}/repos/${owner}/${repo}/webhook`,
      { method: 'DELETE' },
    ),
};

export const billing = {
  plan: () =>
    request<BillingPlan>('/v1/billing/plan'),
  listPlans: () =>
    request<{ plans: BillingPlan[] }>('/v1/billing/plans'),
  createCheckout: (planId: string, successUrl: string, cancelUrl: string) =>
    request<{ url: string; sessionId: string }>('/v1/billing/subscription/create-checkout', {
      method: 'POST',
      body: JSON.stringify({ planId, successUrl, cancelUrl }),
    }),
};

export interface WizardProgress {
  tenantId: string;
  state: 'not_started' | 'in_progress' | 'completed' | 'skipped';
  currentStep: string;
  steps: {
    githubInstalled: boolean;
    repoSelected: boolean;
    billingSetup: boolean;
    teamSetup: boolean;
  };
  completedAt?: string;
  createdAt?: string;
  updatedAt?: string;
  metadata?: Record<string, unknown>;
}

export interface WizardConfig {
  enabled: boolean;
  requiredSteps: string[];
  githubAppUrl: string;
}

export const onboarding = {
  getStatus: () =>
    request<{ progress: WizardProgress; config: WizardConfig }>('/v1/onboarding'),
  start: () =>
    request<{ success: boolean; progress: WizardProgress }>('/v1/onboarding', { method: 'POST' }),
  completeStep: (step: string, body?: Record<string, unknown>) =>
    request<{ success: boolean; progress: WizardProgress }>(
      `/v1/onboarding/step/${step}`,
      { method: 'POST', body: body ? JSON.stringify(body) : undefined },
    ),
  skip: () =>
    request<{ success: boolean; progress: WizardProgress }>('/v1/onboarding/skip', { method: 'POST' }),
  reset: () =>
    request<{ success: boolean; progress: WizardProgress }>('/v1/onboarding/reset', { method: 'POST' }),
  getConfig: () =>
    request<{ config: WizardConfig }>('/v1/onboarding/config'),
};

export const health = {
  getStatus: () =>
    request<HealthResponse>('/health'),
  getVerbose: () =>
    request<HealthResponse>('/health/verbose'),
};

export const settings = {
  get: (opts?: { signal?: AbortSignal }) =>
    request<{
      label: string;
      model: string;
      maxConcurrent: number;
      sandboxPoolSize: number;
      auditLogEnabled: boolean;
    }>('/settings', opts),
  update: (body: {
    label: string;
    model: string;
    maxConcurrent: number;
    sandboxPoolSize: number;
    auditLogEnabled: boolean;
  }) =>
    request<{ success: boolean }>('/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export const configApi = {
  get: (opts?: { signal?: AbortSignal }) =>
    request<{
      env: Record<string, string>;
      rateLimits: Array<{ endpoint: string; limit: number; window: string }>;
      tokens: Array<{ id: string; name: string; scopes: string[]; createdAt: string; lastUsed: string | null }>;
      symphonies: Array<{ id: string; name: string; status: 'connected' | 'disconnected' | 'error'; endpoint: string; lastSync: string | null }>;
      subscriptions: Array<{ id: string; event: string; channel: string; target: string; enabled: boolean }>;
      warnings: Array<{ id: string; type: 'rate_limit' | 'quota' | 'token_expiry' | 'system'; message: string; severity: 'info' | 'warning' | 'critical'; dismissed: boolean; createdAt: string }>;
      integrations: Array<{ id: string; name: string; icon: string; connected: boolean; configUrl?: string }>;
      infrastructure: Record<string, { provider: string; host: string; port: number; status: 'connected' | 'disconnected' | 'error' }>;
    }>('/v1/config', opts),
  updateEnv: (env: Record<string, string>) =>
    request<{ success: boolean }>('/v1/config/env', {
      method: 'PUT',
      body: JSON.stringify(env),
    }),
  updateRateLimits: (rateLimits: Array<{ endpoint: string; limit: number; window: string }>) =>
    request<{ success: boolean }>('/v1/config/rate-limits', {
      method: 'PUT',
      body: JSON.stringify(rateLimits),
    }),
  regenerateToken: (tokenId: string) =>
    request<{ success: boolean }>(`/v1/config/tokens/${tokenId}/regenerate`, { method: 'POST' }),
  revokeToken: (tokenId: string) =>
    request<{ success: boolean }>(`/v1/config/tokens/${tokenId}`, { method: 'DELETE' }),
  toggleIntegration: (id: string, connected: boolean) =>
    request<{ success: boolean }>(`/v1/config/integrations/${id}`, {
      method: 'PUT',
      body: JSON.stringify({ connected }),
    }),
  testInfrastructure: (provider: string) =>
    request<{ status: string }>(`/v1/config/infrastructure/${provider}/test`, { method: 'POST' }),
};

export const sla = {
  getMetrics: () =>
    request<SLAMetrics>('/v1/sla/metrics'),
};

// -- Stats / Analytics API --

export const stats = {
  get: () =>
    request<DashboardStats>('/v1/stats'),
};

// -- Audit Log API --

export const audit = {
  list: (params: { page: number; perPage: number }, opts?: { signal?: AbortSignal }) =>
    request<{
      data: {
        id: string;
        action: string;
        actor: string;
        target?: string;
        details?: Record<string, unknown>;
        createdAt: string;
      }[];
      total: number;
      page: number;
      perPage: number;
      totalPages: number;
    }>(`/v1/audit?page=${params.page}&perPage=${params.perPage}`, opts),
};

// -- Benchmarks API --

export const benchmarks = {
  get: () =>
    request<{
      competitors: {
        agent: string;
        passRate: number;
        costPerFixCents: number;
        agentNative: boolean;
        oss: boolean;
        selfHostable: boolean;
        note?: string;
      }[];
    }>('/v1/benchmarks'),
  getPrices: () =>
    request<{
      prices: {
        agent: string;
        model: string;
        costPerFixCents: number;
        monthlyMinCents: number;
        monthlyMaxFixes: number;
      }[];
    }>('/v1/benchmarks/prices'),
};

// -- KPI API --

export const kpi = {
  get: (params: { days: number }) =>
    request<{
      metrics: {
        id: number;
        snapshotDate: string;
        activeReposMa: number;
        fixCompletionRate: number;
        totalRuns: number;
        successfulRuns: number;
        freeAccounts: number;
        paidAccounts: number;
        freeToPaidConversion: number;
        netRevenueCents: number;
        churnRate: number;
        churnedAccounts: number;
        viralCoefficient: number;
        referredAccounts: number;
        totalNewAccounts: number;
      }[];
      count: number;
      generatedAt: string;
    }>(`/v1/admin/kpi?days=${params.days}`),
  exportUrl: (days: number) =>
    `/api/v1/admin/kpi/export?days=${days}`,
};

// -- Pricing API --

export const pricing = {
  get: () =>
    request<{
      plans: {
        id: string;
        name: string;
        description: string;
        price: string;
        period: string;
        fixes: string;
        monthlyFixLimit: number;
        concurrentFixes: number;
        premiumModels: boolean;
        prioritySupport: boolean;
        customWebhooks: boolean;
        sla: boolean;
        features: string[];
        cta: string;
        highlighted: boolean;
      }[];
      competitors: {
        competitor: string;
        monthlyCostCents: number;
        costPerFixCents: number;
        fixesPerMonth: number;
        passRate: number;
        selfHosted: boolean;
        openSource: boolean;
        ourAgi: boolean;
      }[];
    }>('/v1/pricing'),
  calculate: (fixes: number, tier: string) =>
    request<{
      fixesPerMonth: number;
      monthlyCostCents: number;
      costPerFixCents: number;
      vsCompetitors: {
        name: string;
        monthlyCostCents: number;
        savingsCents: number;
        savingsPercent: number;
      }[];
    }>(`/v1/pricing/calculate?fixes=${fixes}&tier=${tier}`),
  vs: (competitor: string) =>
    request<{
      competitor: string;
      competitorName: string;
      tagline: string;
      ourAdvantage: string;
      categories: {
        name: string;
        items: {
          feature: string;
          us: string;
          them: string;
          advantage: 'us' | 'them' | 'tie';
        }[];
      }[];
      priceComparison: {
        ourMonthlyCents: number;
        theirMonthlyCents: number;
        ourPerFixCents: number;
        theirPerFixCents: number;
        annualSavingsCents: number;
      };
      benchmarkComparison: {
        ourPassRate: number;
        theirPassRate: number;
        ourCostPerFixCents: number;
        theirCostPerFixCents: number;
      };
    }>(`/v1/pricing/vs/${competitor}`),
};

