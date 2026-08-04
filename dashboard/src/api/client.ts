import type {
  Run, DashboardStats, AuditEntry, PaginatedResponse, BenchmarkEntry, BenchmarkPrice,
  KpiResponse, PricingData, CostCalculation, VsComparisonData, McpApiKey,
  Incident, IncidentDetail, IncidentStats, IncidentFilters, ServiceCatalogEntry,
} from '@/api/types';

export type { DashboardStats };

const API_BASE = '/api';

function getToken(): string | null {
  try {
    return localStorage.getItem('syntaro_token');
  } catch {
    return null;
  }
}

export function setToken(token: string): void {
  try {
    localStorage.setItem('syntaro_token', token);
  } catch {}
}

export function getRefreshToken(): string | null {
  try {
    return localStorage.getItem('syntaro_refresh_token');
  } catch {
    return null;
  }
}

export function setRefreshToken(token: string): void {
  try {
    localStorage.setItem('syntaro_refresh_token', token);
  } catch {}
}

export function clearToken(): void {
  try {
    localStorage.removeItem('syntaro_token');
    localStorage.removeItem('syntaro_refresh_token');
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
    const _isLogin = path.includes('/auth/login') || path.includes('/auth/register');
    const _isReset = path.includes('/auth/forgot-password') || path.includes('/auth/reset-password');
    const _isAuthFlow = _isLogin || _isReset;
    if (!_isAuthFlow) {
      clearToken();
      if (typeof window !== 'undefined') {
        window.location.href = '/login';
      }
    }
    if (_isReset) {
      const resetBody = await res.json().catch(() => ({ error: 'Invalid credentials' }));
      throw new Error(typeof resetBody.error === 'string' ? resetBody.error : 'Invalid credentials');
    }
    throw new Error(_isLogin ? 'Invalid login credentials' : 'Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    const errorMsg = typeof body.error === 'string' ? body.error : `Request failed: ${res.status}`;
    throw new Error(errorMsg);
  }

  return res.json() as Promise<T>;
}

export interface AuthResult {
  token: string;
  refreshToken: string;
  user: { id: string; email: string; name: string | null; createdAt?: string; role?: string };
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

export interface CreditPack {
  credits: number;
  bonus: number;
  priceCents: number;
  priceId: string;
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
  hasBillingRecord?: boolean;
}

export interface Invoice {
  id: string;
  number: string | null;
  status: string;
  created: string;
  periodStart: string | null;
  periodEnd: string | null;
  amountDueCents: number;
  amountPaidCents: number;
  currency: string;
  invoicePdf: string | null;
  hostedInvoiceUrl: string | null;
}

export interface BillingSettings {
  autoReloadEnabled: boolean;
  autoReloadThresholdCents: number | null;
  autoReloadTopupCents: number | null;
  monthlyLimitCents: number | null;
  monthSpendCents?: number;
}

export interface Coupon {
  id: number;
  code: string;
  amountCredits: number;
  active: boolean;
  maxRedemptions: number | null;
  timesRedeemed: number;
  createdAt: string;
}

export interface BillingSettingsUpdate {
  autoReloadEnabled?: boolean;
  autoReloadThresholdCents?: number | null;
  autoReloadTopupCents?: number | null;
  monthlyLimitCents?: number | null;
}

export const billingSettingsApi = {
  get: (opts?: { signal?: AbortSignal }) =>
    request<BillingSettings>('/v1/credits/billing-settings', opts),
  update: (body: BillingSettingsUpdate) =>
    request<{ settings: BillingSettings }>('/v1/credits/billing-settings', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  redeemCoupon: (code: string) =>
    request<{ coupon: Coupon; newBalance: number }>('/v1/credits/redeem-coupon', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

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
  forgotPassword: (email: string) =>
    request<{ ok: boolean; message?: string }>('/v1/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    }),
  resetPassword: (accessToken: string, password: string) =>
    request<{ ok: boolean; message?: string }>('/v1/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify({ accessToken, password }),
    }),
me: () =>
  request<{
    id: string;
    email: string;
    name: string | null;
    username?: string;
    avatarUrl?: string;
    plan?: string;
    role?: string;
    createdAt: string;
    isAdmin?: boolean;
    impersonating?: boolean;
    impersonator?: { id: string; email: string };
    token?: string;
    refreshToken?: string;
  }>('/v1/auth/me'),
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
  getPacks: (opts?: { signal?: AbortSignal }) => request<CreditPack[]>('/v1/credits/packs', opts),
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
  redeemCoupon: (code: string) =>
    request<{ coupon: Coupon; newBalance: number }>('/v1/credits/redeem-coupon', {
      method: 'POST',
      body: JSON.stringify({ code }),
    }),
};

// -- Usage limits + provider routing (OpenCode Go "Go" parity, AIM-4645) --

export interface UsageLimitWindow {
  usedCredits: number;
  limitCredits: number;
  resetAt: string;
}

export interface UsageLimits {
  continuous: UsageLimitWindow;
  weekly: UsageLimitWindow;
  monthly: UsageLimitWindow;
  useBalanceAfterLimits: boolean;
  enableChinaModels: boolean;
  balance: number;
}

export const usageLimitsApi = {
  get: (opts?: { signal?: AbortSignal }) =>
    request<UsageLimits>('/v1/usage-limits', opts),
  updatePreferences: (body: {
    useBalanceAfterLimits?: boolean;
    enableChinaModels?: boolean;
  }) =>
    request<{ success: boolean; useBalanceAfterLimits: boolean; enableChinaModels: boolean }>(
      '/v1/usage-limits/preferences',
      { method: 'POST', body: JSON.stringify(body) },
    ),
};

// -- Usage & cost analytics (OpenCode Go "Kosten" parity) --

export interface UsageSeriesPoint {
  date: string;
  [model: string]: string | number;
}

export interface UsageTotalsByModel {
  model: string;
  costCents: number;
  runs: number;
}

export interface UsageRequest {
  date: string;
  model: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  costCents: number;
  sessionId?: string;
  runId?: number;
  issueNumber?: number | null;
  prUrl?: string | null;
  durationMs?: number | null;
}

export interface UsageAnalytics {
  month: string;
  series: UsageSeriesPoint[];
  totalsByModel: UsageTotalsByModel[];
  requests: UsageRequest[];
  filters: { models: string[]; apiKeys: string[] };
}

export const usageApi = {
  get: (params?: { month?: string; model?: string; apiKey?: string }, opts?: { signal?: AbortSignal }) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', params.month);
    if (params?.model) qs.set('model', params.model);
    if (params?.apiKey) qs.set('apiKey', params.apiKey);
    const query = qs.toString();
    return request<UsageAnalytics>(`/v1/credits/usage/usage${query ? `?${query}` : ''}`, opts);
  },
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
    syntaroInstalled: boolean;
    webhookId: number | null;
  }>;
}

export interface GitHubConnectionStatus {
  connected: boolean;
  githubLogin?: string;
  githubUserId?: number;
}

export const repos = {
  list: async (opts?: { signal?: AbortSignal }) => {
    const res = await request<any>('/repos', opts);
    return Array.isArray(res) ? res : (res?.data ?? []);
  },
  connect: (body: { owner: string; repo: string; installationId?: number }) =>
    request<{ id: string; owner: string; repo: string; active: boolean }>('/repos', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  disconnect: (id: string) =>
    request<{ success: boolean }>(`/repos/${id}`, { method: 'DELETE' }),
};

export interface TeamMember {
  id: number;
  teamId: number;
  accountId: number;
  role: 'admin' | 'member' | 'viewer';
  monthlyLimitCredits: number | null;
  joinedAt: string;
  accountName?: string;
  accountEmail?: string;
  email?: string;
}

export interface TeamInvite {
  id: number;
  email: string;
  role: string;
  monthlyLimitCredits: number | null;
  createdAt: string;
}

export interface TeamSummary {
  id: number;
  name: string;
  role: 'admin' | 'member' | 'viewer';
  ownerAccountId?: number;
  memberCount?: number;
}

export const teamApi = {
  me: () => request<{ team: TeamSummary }>('/teams/me'),
  members: (teamId: number) =>
    request<{ teamId: number; members: TeamMember[]; invites: TeamInvite[] }>(`/teams/${teamId}/members`),
  invite: (teamId: number, body: { email: string; role?: string; monthlyLimitCredits?: number | null }) =>
    request<{ success: boolean; invite?: { id: number; email: string } }>(`/teams/${teamId}/invite`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  changeRole: (teamId: number, userId: number, role: string) =>
    request<{ success: boolean }>(`/teams/${teamId}/members/${userId}/role`, {
      method: 'POST',
      body: JSON.stringify({ role }),
    }),
  setLimit: (teamId: number, userId: number, monthlyLimitCredits: number | null) =>
    request<{ success: boolean; monthlyLimitCredits: number | null }>(
      `/teams/${teamId}/members/${userId}/limit`,
      { method: 'POST', body: JSON.stringify({ monthlyLimitCredits }) },
    ),
  revokeInvite: (teamId: number, inviteId: number) =>
    request<{ success: boolean }>(`/teams/${teamId}/invites/${inviteId}`, { method: 'DELETE' }),
};

export const github = {
  getOAuthUrl: () =>
    request<{ url: string }>('/v1/auth/github/url', { method: 'POST' }),
  storeToken: (providerToken: string) =>
    request<{ success: boolean }>('/v1/auth/github/token', {
      method: 'POST',
      body: JSON.stringify({ providerToken }),
    }),
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
    request<{ installations: GitHubInstallation[]; error?: string }>('/v1/github/installations', opts),
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

export interface BitbucketRepo {
  name: string;
  fullName: string;
  private: boolean;
  mainbranch: string;
  webhookActive: boolean;
}

export interface BitbucketStatus {
  connected: boolean;
  workspace: string;
  username: string | null;
}

export const bitbucket = {
  getStatus: (opts?: { signal?: AbortSignal }) =>
    request<BitbucketStatus>('/v1/bitbucket/status', opts),
  connect: (body: { username: string; appPassword: string; workspace: string }) =>
    request<{ connected: boolean; workspace: string; repoCount: number }>('/v1/bitbucket/connect', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  disconnect: () =>
    request<{ success: boolean }>('/v1/bitbucket/disconnect', { method: 'DELETE' }),
  listRepos: (opts?: { signal?: AbortSignal }) =>
    request<{ connected: boolean; workspace: string; repos: BitbucketRepo[] }>('/v1/bitbucket/repos', opts),
  configureWebhook: (owner: string, repo: string) =>
    request<{ success: boolean; webhookUuid: string }>(`/v1/bitbucket/repos/${owner}/${repo}/webhook`, {
      method: 'POST',
    }),
  removeWebhook: (owner: string, repo: string) =>
    request<{ success: boolean }>(`/v1/bitbucket/repos/${owner}/${repo}/webhook`, { method: 'DELETE' }),
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
  portal: (returnUrl?: string) =>
    request<{ url: string }>('/v1/billing/subscription/portal', {
      method: 'POST',
      body: JSON.stringify({ returnUrl }),
    }),
  invoices: () =>
    request<{ invoices: Invoice[] }>('/v1/billing/invoices'),
};

// -- Referral API (AIM-4643) --

export interface ReferralReward {
  id: number;
  accountId: number;
  referredEmail: string;
  amountCredits: number;
  status: 'pending' | 'claimed';
  createdAt: string;
  claimedAt: string | null;
}

export const referralApi = {
  code: (opts?: { signal?: AbortSignal }) =>
    request<{ code: string }>('/v1/referral/code', opts),
  createCode: () =>
    request<{ code: string }>('/v1/referral/code', { method: 'POST' }),
  rewards: (opts?: { signal?: AbortSignal }) =>
    request<{ rewards: ReferralReward[] }>('/v1/referral/rewards', opts),
  claim: (id: number) =>
    request<{ claimed: boolean; reward: ReferralReward; newBalance: number }>(
      `/v1/referral/rewards/${id}/claim`,
      { method: 'POST' },
    ),
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
    }>('/v1/me/settings', opts),
  update: (body: {
    label: string;
    model: string;
    maxConcurrent: number;
    sandboxPoolSize: number;
    auditLogEnabled: boolean;
  }) =>
    request<{ success: boolean }>('/v1/me/settings', {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
};

export const privacy = {
  getDeletionStatus: (opts?: { signal?: AbortSignal }) =>
    request<{
      activeRequest: {
        id: number;
        accountId: number;
        requestedAt: string;
        scheduledDeletionAt: string;
        status: 'pending' | 'completed' | 'cancelled';
      } | null;
      retentionDays: number;
    }>('/v1/privacy/deletion-status', opts),
  requestDeletion: () =>
    request<{ deletionRequest: { id: number; scheduledDeletionAt: string; status: string } }>(
      '/v1/privacy/deletion-request',
      { method: 'POST' },
    ),
  cancelDeletion: () =>
    request<{ cancelled: unknown }>('/v1/privacy/deletion-request/cancel', { method: 'POST' }),
  exportData: (opts?: { signal?: AbortSignal }) =>
    request<Record<string, unknown>>('/v1/privacy/portability', opts),
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
      publicUrl?: string;
      mcp?: { apiUrl: string; serverUrl: string };
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
  verifyService: (service: string, apiKey: string) =>
    request<{ connected: boolean; name?: string; error?: string }>('/v1/config/verify', {
      method: 'POST',
      body: JSON.stringify({ service, apiKey }),
    }),
};

export const mcpKeysApi = {
  list: () => request<{ keys: McpApiKey[] }>('/v1/mcp-keys'),
  create: (name: string) =>
    request<{ id: string; name: string; keyPrefix: string; key: string; createdAt: string }>('/v1/mcp-keys', {
      method: 'POST',
      body: JSON.stringify({ name }),
    }),
  rename: (keyId: string, name: string) =>
    request<McpApiKey>(`/v1/mcp-keys/${keyId}`, {
      method: 'PATCH',
      body: JSON.stringify({ name }),
    }),
  get: (keyId: string) => request<{ key: string }>(`/v1/mcp-keys/${keyId}`),
  revoke: (keyId: string) => request<{ success: boolean }>(`/v1/mcp-keys/${keyId}`, { method: 'DELETE' }),
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

export const incidents = {
  list: (filters: IncidentFilters = {}, opts?: { signal?: AbortSignal }) => {
    const qs = new URLSearchParams();
    if (filters.severity) qs.set('severity', filters.severity);
    if (filters.status) qs.set('status', filters.status);
    if (filters.source) qs.set('source', filters.source);
    if (filters.from) qs.set('from', filters.from);
    if (filters.to) qs.set('to', filters.to);
    if (filters.limit) qs.set('limit', String(filters.limit));
    if (filters.offset) qs.set('offset', String(filters.offset));
    const query = qs.toString();
    return request<{ data: Incident[]; total: number; limit: number; offset: number }>(
      `/v1/incidents${query ? `?${query}` : ''}`,
      opts,
    );
  },
  get: (id: number | string, opts?: { signal?: AbortSignal }) =>
    request<{ data: IncidentDetail }>(`/v1/incidents/${id}`, opts),
  getStats: (opts?: { signal?: AbortSignal }) => request<IncidentStats>(`/v1/incidents/stats`, opts),
  transition: (id: number | string, status: string) =>
    request<{ data: Incident }>(`/v1/incidents/${id}/status`, {
      method: 'POST',
      body: JSON.stringify({ status }),
    }),
};

export const serviceCatalog = {
  list: () => request<{ data: ServiceCatalogEntry[] }>(`/v1/incidents/services`),
  create: (body: { name: string; purpose?: string | null; repos?: { owner: string; repo: string }[] }) =>
    request<{ data: ServiceCatalogEntry }>(`/v1/incidents/services`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  update: (
    id: number | string,
    body: { purpose?: string | null; repos?: { owner: string; repo: string }[] },
  ) =>
    request<{ data: ServiceCatalogEntry }>(`/v1/incidents/services/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  remove: (id: number | string) =>
    request<{ success: boolean }>(`/v1/incidents/services/${id}`, { method: 'DELETE' }),
};

