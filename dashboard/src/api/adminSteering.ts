import { request } from './client';

// ── Admin steering API (AIM-4617) ──────────────────────────────────────────
// Server-side proxy at /api/v1/admin/steering. The Express backend enforces
// the JWT + ADMIN_EMAILS gate and forwards to the OpenSymphony admin API with
// an x-api-key credential — admin credentials never reach the browser.

export interface OsHealthStatus {
  status: string;
  proxy: string;
  stripe: string;
  emergency_paused: boolean;
  timestamp: string;
}

export interface OsActionResponse {
  status: string;
  [key: string]: unknown;
}

export interface OsRefundRequest {
  payment_intent: string;
  amount?: number;
  kill?: boolean;
}

export interface OsRefundResponse {
  status: string;
  refund_id?: string;
  tenant_id?: string;
  also_killed?: boolean;
  error?: string;
  detail?: string;
}

export interface OsMaintenanceStatus {
  active: boolean;
  activated_at: string | null;
  deactivated_at: string | null;
  reason: string | null;
  drain_deadline: string | null;
}

export interface OsMaintenanceResponse {
  status: string;
  maintenance?: boolean;
  reason?: string;
  drain_minutes?: number;
}

export interface OsLoadResponse {
  load_level: 'normal' | 'elevated' | 'critical';
}

export interface OsErrorBudgetResponse {
  [component: string]: number;
}

export interface OsBackupResponse {
  status: string;
  message?: string;
}

export interface OsBackupListResponse {
  backups?: unknown[];
  status?: string;
  message?: string;
}

export const adminSteering = {
  health: () => request<OsHealthStatus>('/v1/admin/steering/health'),

  emergencyPause: () => request<OsActionResponse>('/v1/admin/steering/emergency-pause', { method: 'POST' }),
  emergencyResume: () => request<OsActionResponse>('/v1/admin/steering/emergency-resume', { method: 'POST' }),

  killTenant: (tenantId: string) =>
    request<OsActionResponse>(`/v1/admin/steering/tenant/${encodeURIComponent(tenantId)}/kill`, {
      method: 'POST',
    }),
  refundTenant: (tenantId: string, body: OsRefundRequest) =>
    request<OsRefundResponse>(`/v1/admin/steering/tenant/${encodeURIComponent(tenantId)}/refund`, {
      method: 'POST',
      body: JSON.stringify(body),
    }),

  maintenanceStatus: () => request<OsMaintenanceStatus>('/v1/admin/steering/maintenance/status'),
  maintenanceActivate: (reason: string, drainMinutes: number) =>
    request<OsMaintenanceResponse>('/v1/admin/steering/maintenance/activate', {
      method: 'POST',
      body: JSON.stringify({ reason, drain_minutes: drainMinutes }),
    }),
  maintenanceDeactivate: () =>
    request<OsMaintenanceResponse>('/v1/admin/steering/maintenance/deactivate', {
      method: 'POST',
    }),

  load: () => request<OsLoadResponse>('/v1/admin/steering/load'),
  errorBudget: () => request<OsErrorBudgetResponse>('/v1/admin/steering/error-budget'),

  backupRun: () => request<OsBackupResponse>('/v1/admin/steering/backup', { method: 'POST' }),
  backups: () => request<OsBackupListResponse>('/v1/admin/steering/backups'),
};
