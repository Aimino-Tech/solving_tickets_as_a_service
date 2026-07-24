const API_BASE = '/api';

function getToken(): string | null {
  return localStorage.getItem('stas_token');
}

export function setToken(token: string): void {
  localStorage.setItem('stas_token', token);
}

export function clearToken(): void {
  localStorage.removeItem('stas_token');
}

async function request<T>(
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
    clearToken();
    window.location.href = '/login';
    throw new Error('Unauthorized');
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// Auth
export const auth = {
  loginUrl: () => `${API_BASE}/auth/github`,
  me: () => request<{ user: { githubId: string; username: string; avatarUrl?: string } }>('/auth/me'),
  logout: () => request<{ success: boolean }>('/auth/logout', { method: 'POST' }),
};

// Runs
export const runs = {
  list: (params?: { page?: number; perPage?: number; status?: string; repo?: string; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    if (params?.status) qs.set('status', params.status);
    if (params?.repo) qs.set('repo', params.repo);
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const query = qs.toString();
    return request<{ data: import('./types').Run[]; total: number; page: number; perPage: number; totalPages: number }>(
      `/runs${query ? `?${query}` : ''}`,
    );
  },
  get: (id: string) => request<import('./types').Run>(`/runs/${id}`),
};

// Repos
export const repos = {
  list: () => request<import('./types').Repo[]>('/repos'),
  connect: (body: { owner: string; repo: string; installationId?: number }) =>
    request<import('./types').Repo>('/repos', { method: 'POST', body: JSON.stringify(body) }),
  disconnect: (id: string) =>
    request<{ success: boolean }>(`/repos/${id}`, { method: 'DELETE' }),
};

// Stats
export const stats = {
  get: () => request<import('./types').DashboardStats>('/stats'),
};

// Audit
export const audit = {
  list: (params?: { page?: number; perPage?: number }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    const query = qs.toString();
    return request<{ data: import('./types').AuditEntry[]; total: number; page: number; perPage: number; totalPages: number }>(
      `/audit${query ? `?${query}` : ''}`,
    );
  },
};

// Benchmarks
export const benchmarks = {
  get: () =>
    request<{ generatedAt: string; source: string; disclaimer: string; competitors: import('./types').BenchmarkEntry[] }>('/benchmarks'),
  getPrices: () =>
    request<{ generatedAt: string; currency: string; prices: import('./types').BenchmarkPrice[] }>('/benchmarks/price'),
};

// KPI Dashboard (admin key required)
export const kpi = {
  get: (params?: { days?: number; from?: string; to?: string }) => {
    const qs = new URLSearchParams();
    if (params?.days) qs.set('days', String(params.days));
    if (params?.from) qs.set('from', params.from);
    if (params?.to) qs.set('to', params.to);
    const query = qs.toString();
    return request<import('./types').KpiResponse>('/kpi' + (query ? '?' + query : ''));
  },
  exportUrl: (days?: number) => {
    const qs = days ? '?days=' + days : '';
    return API_BASE + '/kpi/export' + qs;
  },
};

// Pricing
export const pricing = {
  get: () =>
    request<import('./types').PricingData>('/pricing'),
  calculate: (fixes: number, tier?: string) => {
    const qs = new URLSearchParams({ fixes: String(fixes) });
    if (tier) qs.set('tier', tier);
    return request<import('./types').CostCalculation>(`/pricing/calculate?${qs.toString()}`);
  },
  vs: (competitor: string) =>
    request<import('./types').VsComparisonData & { competitor: string }>(`/pricing/vs/${competitor}`),
};

export interface WizardProgress {
  tenantId: string; state: string; currentStep: string;
  steps: { githubInstalled: boolean; repoSelected: boolean; billingSetup: boolean; teamSetup: boolean };
  completedAt?: string; createdAt?: string; updatedAt?: string; metadata?: Record<string, unknown>;
}

export interface WizardConfig {
  enabled: boolean; requiredSteps: string[]; githubAppUrl: string;
}

export const onboarding = {
  getStatus: () => request<{ progress: WizardProgress; availableTransitions: string[] }>('/onboarding/status'),
  start: () => request<WizardProgress>('/onboarding/start', { method: 'POST' }),
  getWizard: () => request<{ progress: WizardProgress; config: WizardConfig; githubAppUrl: string }>('/onboarding'),
  getConfig: () => request<WizardConfig>('/onboarding/config'),
  completeGitHubInstall: (installationId: number, accountLogin?: string, reposGranted?: number) =>
    request<WizardProgress>('/onboarding/step/github-install', {
      method: 'POST', body: JSON.stringify({ installationId, accountLogin, reposGranted }),
    }),
  completeRepoSelection: (repoOwner: string, repoName: string, repoId?: number) =>
    request<WizardProgress>('/onboarding/step/repo-selection', {
      method: 'POST', body: JSON.stringify({ repoOwner, repoName, repoId }),
    }),
  completeBillingSetup: (params: { planId?: string; trialDays?: number; skipBilling?: boolean }) =>
    request<WizardProgress>('/onboarding/step/billing-setup', {
      method: 'POST', body: JSON.stringify(params),
    }),
  completeTeamSetup: (params: { teamName?: string; skipTeam?: boolean }) =>
    request<WizardProgress>('/onboarding/step/team-setup', {
      method: 'POST', body: JSON.stringify(params),
    }),
  skip: () => request<WizardProgress>('/onboarding/skip', { method: 'POST' }),
  reset: () => request<WizardProgress>('/onboarding/reset', { method: 'POST' }),
};

// Settings
export const settings = {
  get: () => request<{
    label: string;
    model: string;
    maxConcurrent: number;
    sandboxPoolSize: number;
    auditLogEnabled: boolean;
  }>('/settings'),
  update: (body: Record<string, unknown>) =>
    request<{ success: boolean }>('/settings', { method: 'PUT', body: JSON.stringify(body) }),
};
