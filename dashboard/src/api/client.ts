<<<<<<< Updated upstream
import type { User, Run, DashboardStats, AuditEntry, BenchmarkEntry, BenchmarkPrice, KpiResponse, PricingData, CostCalculation, VsComparisonData, PaginatedResponse } from '@/api/types';
=======
import type { DashboardStats, AuditEntry, PaginatedResponse, BenchmarkEntry, BenchmarkPrice, KpiResponse, PricingData, CostCalculation, VsComparisonData } from '@/api/types';
import type { Run } from '@/api/types';

export type { Run };
>>>>>>> Stashed changes

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
      } catch {}
    }
    clearToken();
    if (typeof window !== 'undefined') {
      window.location.href = '/login';
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
  user: { id: number; email: string; name: string | null; username?: string; avatarUrl?: string };
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

// -- Health types --

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
  memoryUsage?: { rss: number; heapTotal: number; heapUsed: number; external: number };
}

// -- SLA metric types --

export interface SLAByTier {
  count: number;
  breaches: number;
  attainmentRate: number;
  p50: number | null;
  p95: number | null;
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

export interface LitellmUsage {
  configured: boolean;
  message?: string;
  budget?: {
    remainingBudget: number;
    maxBudget: number;
    spendInCurrentMonth: number;
    budgetDuration: string;
    budgetResetAt: string;
  };
  todayTokens: { total: number; input: number; output: number };
  thisMonthTokens: { total: number; input: number; output: number };
  requestsToday: number;
  rateLimit?: {
    rpmRemaining: number;
    rpmLimit: number;
    tpmRemaining: number;
    tpmLimit: number;
    resetAt: string | null;
  } | null;
}

export const auth = {
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
    request<User>('/v1/auth/me'),
  refresh: (refreshToken: string) =>
    request<AuthResult>('/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
  logout: () =>
    request<{ message: string }>('/v1/auth/logout', { method: 'POST' }),
  loginUrl: () => '/api/auth/github',
};

export const credits = {
  balance: () => request<CreditBalance>('/v1/credits/balance'),
  transactions: (limit = 50, offset = 0) =>
    request<{ transactions: Transaction[]; pagination: { limit: number; offset: number; total: number } }>(
      `/v1/credits/transactions?limit=${limit}&offset=${offset}`,
    ),
  topUp: (priceId: string, successUrl: string, cancelUrl: string) =>
    request<{ url: string; sessionId: string }>('/v1/credits/top-up', {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    }),
  usage: (period: 'daily' | 'weekly' | 'monthly' = 'monthly') =>
    request<{ accountId: number; period: string; usage: MonthlyUsage[] }>(
      `/v1/credits/usage?period=${period}`,
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
  }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    if (params?.status) qs.set('status', params.status);
    if (params?.repo) qs.set('repo', params.repo);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const query = qs.toString();
    return request<{ data: Run[]; total: number; page: number; perPage: number; totalPages: number }>(
      `/v1/runs${query ? `?${query}` : ''}`,
    );
  },
  get: (id: string) => request<Run>(`/v1/runs/${id}`),
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
  list: () =>
    request<{ id: string; owner: string; repo: string; active: boolean; createdAt: string }[]>('/repos'),
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
  handleCallback: (code: string) =>
    request<{ githubLogin: string; githubUserId: number; avatarUrl: string }>('/v1/auth/github/callback', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
  getStatus: () =>
    request<GitHubConnectionStatus>('/v1/auth/github/status'),
  disconnect: () =>
    request<{ success: boolean }>('/v1/auth/github/disconnect', { method: 'DELETE' }),
  listInstallations: () =>
    request<{ installations: GitHubInstallation[] }>('/v1/github/installations'),
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

// -- Health API --

export const health = {
  getStatus: () =>
    request<HealthResponse>('/health'),
  getVerbose: () =>
    request<HealthResponse>('/health/verbose'),
};

// -- SLA API --

export const sla = {
  getMetrics: () =>
    request<SLAMetrics>('/v1/sla/metrics'),
};

export const litellm = {
  usage: () => request<LitellmUsage>('/v1/litellm/usage'),
};

export const stats = {
  get: () => request<DashboardStats>('/v1/stats'),
};

export const audit = {
  list: (params?: { page?: number; perPage?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    const query = qs.toString();
    return request<PaginatedResponse<AuditEntry>>(`/v1/audit${query ? `?${query}` : ''}`);
  },
};

export const benchmarks = {
  get: () => request<{ competitors: BenchmarkEntry[] }>('/v1/benchmarks'),
  getPrices: () => request<{ prices: BenchmarkPrice[] }>('/v1/benchmarks/prices'),
};

export const kpi = {
  get: (params?: { days?: number; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.days) qs.set('days', String(params.days));
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const query = qs.toString();
    return request<KpiResponse>(`/v1/kpi${query ? `?${query}` : ''}`);
  },
  exportUrl: (days?: number) => {
    const qs = days ? `?days=${days}` : '';
    return `/api/v1/kpi/export${qs}`;
  },
};

export const settings = {
  get: () => request<{ label: string; model: string; maxConcurrent: number; sandboxPoolSize: number; auditLogEnabled: boolean }>('/v1/settings'),
  update: (data: { label?: string; model?: string; maxConcurrent?: number; sandboxPoolSize?: number; auditLogEnabled?: boolean }) =>
    request<{ success: boolean }>('/v1/settings', { method: 'PUT', body: JSON.stringify(data) }),
};

export const pricing = {
  get: () => request<PricingData>('/v1/pricing'),
  calculate: (fixesPerMonth: number, tier: string) =>
    request<CostCalculation>('/v1/pricing/calculate', { method: 'POST', body: JSON.stringify({ fixesPerMonth, tier }) }),
  vs: (competitor: string) =>
    request<VsComparisonData>(`/v1/pricing/vs/${competitor}`),
};
