/**
 * Incidents types — monitoring-induced incident tracking (AIM-4631).
 *
 * Incidents follow: open → investigating → fixing → resolved. They carry a
 * SEV level, a source, a confidence gate (from the OS pipeline), and an
 * optional service mapping so the webapp can correlate alerts to fix runs
 * and PRs across one or more repositories.
 */

export interface Incident {
  id: number;
  title: string;
  severity: string;
  status: string;
  source: string;
  confidence: string | null;
  summary: string | null;
  alertId: string | null;
  runId: string | null;
  autoFixed: boolean;
  policyDecision: string | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewIncident {
  id?: number;
  title: string;
  severity?: string;
  status?: string;
  source?: string;
  confidence?: string | null;
  summary?: string | null;
  alertId?: string | null;
  runId?: string | null;
  autoFixed?: boolean;
  policyDecision?: string | null;
  resolvedAt?: Date | null;
}

export interface IncidentTimelineEntry {
  id: number;
  incidentId: number;
  event: string;
  detail: string | null;
  createdAt: Date;
}

export interface NewIncidentTimelineEntry {
  incidentId: number;
  event: string;
  detail?: string | null;
}

export interface IncidentRepo {
  id: number;
  incidentId: number;
  repoOwner: string;
  repoName: string;
  status: string;
  prUrl: string | null;
  branchName: string | null;
  runId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewIncidentRepo {
  incidentId: number;
  repoOwner: string;
  repoName: string;
  status?: string;
  prUrl?: string | null;
  branchName?: string | null;
  runId?: string | null;
}

export interface ServiceCatalogEntry {
  id: number;
  name: string;
  purpose: string | null;
  repos: Array<{ owner: string; repo: string }>;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewServiceCatalogEntry {
  name: string;
  purpose?: string | null;
  repos?: Array<{ owner: string; repo: string }>;
}
