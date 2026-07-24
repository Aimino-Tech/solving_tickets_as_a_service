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
  register: (email: string, password: string, name?: string) =>
    request<import('./types').AuthResponse>('/api/v1/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password, name }),
    }),
  login: (email: string, password: string) =>
    request<import('./types').AuthResponse>('/api/v1/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),
  me: () => request<import('./types').User>('/api/v1/auth/me'),
  logout: () => request<{ message: string }>('/api/v1/auth/logout', { method: 'POST' }),
  refresh: (refreshToken: string) =>
    request<import('./types').AuthResponse>('/api/v1/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken }),
    }),
};

// Runs
export const runs = {
  list: (params?: { page?: number; perPage?: number; status?: string }) => {
    const qs = new URLSearchParams();
    if (params?.page) qs.set('page', String(params.page));
    if (params?.perPage) qs.set('perPage', String(params.perPage));
    if (params?.status) qs.set('status', params.status);
    const query = qs.toString();
    return request<{ data: import('./types').Run[]; total: number; page: number; perPage: number; totalPages: number }>(
      `/api/v1/runs${query ? `?${query}` : ''}`,
    );
  },
  get: (id: string | number) => request<import('./types').Run>(`/api/v1/runs/${id}`),
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

// Credits
export const credits = {
  balance: () =>
    request<import('./types').CreditBalance>('/api/v1/credits/balance'),
  transactions: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<import('./types').CreditTransactionsResponse>(
      `/api/v1/credits/transactions${query ? `?${query}` : ''}`,
    );
  },
  topUp: (priceId: string, successUrl: string, cancelUrl: string) =>
    request<{ url: string; sessionId: string }>('/api/v1/credits/top-up', {
      method: 'POST',
      body: JSON.stringify({ priceId, successUrl, cancelUrl }),
    }),
};

// Account Info
export const account = {
  get: () => request<import('./types').PlanInfo>('/api/v1/me'),
  usage: () => request<{
    totalCreditsUsed: number;
    currentMonth: { creditsUsed: number; startDate: string };
    monthlyStats: Array<{ month: string; creditsUsed: number }>;
    recentUsage: Array<{ id: number; creditsUsed: number; description: string; createdAt: string }>;
  }>('/api/v1/me/usage'),
  transactions: (params?: { limit?: number; offset?: number }) => {
    const qs = new URLSearchParams();
    if (params?.limit) qs.set('limit', String(params.limit));
    if (params?.offset) qs.set('offset', String(params.offset));
    const query = qs.toString();
    return request<{ transactions: import('./types').Transaction[]; total: number; limit: number; offset: number }>(
      `/api/v1/me/transactions${query ? `?${query}` : ''}`,
    );
  },
};
