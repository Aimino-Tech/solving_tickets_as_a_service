import { request } from './client';

export interface AdminUserSummary {
  id: string;
  email: string;
  name: string | null;
  plan: string;
  role: string;
  createdAt: string;
}

export interface AdminUserDetail extends AdminUserSummary {
  accounts: Array<{ id: string; email: string | null; plan: string | null; name: string | null }>;
}

export interface AdminUsersListResponse {
  users: AdminUserSummary[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface ImpersonateResponse {
  token: string;
  refreshToken: string;
  user: AdminUserSummary;
  impersonator: { id: string; email: string };
}

export const adminUsers = {
  list: (params?: { page?: number; limit?: number; q?: string; role?: string }) => {
    const sp = new URLSearchParams();
    if (params?.page) sp.set('page', String(params.page));
    if (params?.limit) sp.set('limit', String(params.limit));
    if (params?.q) sp.set('q', params.q);
    if (params?.role) sp.set('role', params.role);
    const qs = sp.toString();
    return request<AdminUsersListResponse>(`/v1/admin/users${qs ? `?${qs}` : ''}`);
  },

  get: (id: string) => request<AdminUserDetail>(`/v1/admin/users/${id}`),

  setRole: (id: string, role: 'admin' | 'user') =>
    request<{ id: string; email: string; role: string }>(`/v1/admin/users/${id}/role`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),

  impersonate: (id: string) =>
    request<ImpersonateResponse>(`/v1/admin/users/${id}/impersonate`, { method: 'POST' }),

  exitImpersonation: () =>
    request<{ ok: boolean }>('/v1/admin/users/impersonate/exit', { method: 'POST' }),
};
