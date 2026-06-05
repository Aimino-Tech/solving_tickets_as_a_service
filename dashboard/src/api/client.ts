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
