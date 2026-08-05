/**
 * Incident types — normalized shape shared between the OpenSymphony
 * observability API and the dashboard incidents UI (AIM-4631).
 */

export interface IncidentPr {
  repo: string;
  prUrl: string;
  status?: string;
}

export interface NormalizedIncident {
  fingerprint: string;
  service: string;
  title: string;
  severity: number;
  severityLabel: string;
  environment?: string;
  labels: string[];
  traceId?: string;
  firstSeenAt?: string;
  lastSeenAt?: string;
  dispatchedAt?: string;
  resolvedAt?: string;
  status: 'active' | 'resolved';
  difficulty: number;
  variant?: string;
  repos: string[];
  prs: IncidentPr[];
}

export interface IncidentStats {
  active: number;
  resolved: number;
  total: number;
  mttrSeconds: number | null;
  bySeverity: Record<string, number>;
}

/** Raw incident shape as returned by the OpenSymphony queue endpoint. */
export interface RawOsIncident {
  fingerprint?: string;
  service?: string;
  title?: string;
  severity?: number | string;
  environment?: string;
  labels?: string[];
  annotations?: Record<string, unknown>;
  trace_id?: string;
  first_seen_at?: string;
  last_seen_at?: string;
  dispatched_at?: string;
  resolved_at?: string;
  status?: string;
  repos_override?: string[];
  difficulty?: number;
  batch?: Record<string, unknown> | unknown[];
  [key: string]: unknown;
}
