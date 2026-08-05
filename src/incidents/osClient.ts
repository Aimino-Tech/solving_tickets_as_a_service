import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { IncidentPr, IncidentStats, NormalizedIncident, RawOsIncident } from './types.js';

const log = rootLogger.child({ module: 'incidents-os-client' });

export const VARIANTS = ['low', 'medium', 'high', 'max'] as const;
export type RoutingVariant = (typeof VARIANTS)[number];

const VARIANTS_BY_TIER: RoutingVariant[] = ['low', 'medium', 'high', 'max'];

export function variantForDifficulty(tier: number): RoutingVariant {
  const clamped = Math.max(1, Math.min(4, Math.round(tier)));
  return VARIANTS_BY_TIER[clamped - 1] ?? 'low';
}

export function severityLabel(severity: number | string | undefined): { level: number; label: string } {
  if (typeof severity === 'number' && Number.isFinite(severity)) {
    const level = Math.max(1, Math.min(3, Math.round(severity)));
    return { level, label: `SEV${level}` };
  }
  if (typeof severity === 'string') {
    const match = /SEV(\d)/i.exec(severity);
    if (match) {
      const level = Math.max(1, Math.min(3, Number(match[1])));
      return { level, label: `SEV${level}` };
    }
    const parsed = Number(severity);
    if (Number.isFinite(parsed)) {
      const level = Math.max(1, Math.min(3, Math.round(parsed)));
      return { level, label: `SEV${level}` };
    }
  }
  return { level: 3, label: 'SEV3' };
}

export function osIncidentsBaseUrl(): string {
  return config.incidents?.osUrl ?? '';
}

export function normalizeIncident(raw: RawOsIncident): NormalizedIncident {
  const severity = severityLabel(raw.severity);
  const status = raw.status === 'resolved' ? 'resolved' : 'active';
  const repos = Array.isArray(raw.repos_override) ? raw.repos_override : [];
  const prs: IncidentPr[] = extractPrs(raw, repos);
  return {
    fingerprint: String(raw.fingerprint ?? ''),
    service: String(raw.service ?? 'unknown'),
    title: String(raw.title ?? 'Untitled incident'),
    severity: severity.level,
    severityLabel: severity.label,
    environment: raw.environment ? String(raw.environment) : undefined,
    labels: Array.isArray(raw.labels) ? raw.labels.map(String) : [],
    traceId: raw.trace_id ? String(raw.trace_id) : undefined,
    firstSeenAt: raw.first_seen_at ? String(raw.first_seen_at) : undefined,
    lastSeenAt: raw.last_seen_at ? String(raw.last_seen_at) : undefined,
    dispatchedAt: raw.dispatched_at ? String(raw.dispatched_at) : undefined,
    resolvedAt: raw.resolved_at ? String(raw.resolved_at) : undefined,
    status,
    difficulty: typeof raw.difficulty === 'number' ? raw.difficulty : 1,
    variant: variantForDifficulty(typeof raw.difficulty === 'number' ? raw.difficulty : 1),
    repos,
    prs,
  };
}

function extractPrs(raw: RawOsIncident, repos: string[]): IncidentPr[] {
  const prs: IncidentPr[] = [];
  const batch = raw.batch;
  if (batch && typeof batch === 'object' && !Array.isArray(batch)) {
    const entries = (batch as Record<string, unknown>).prs ?? (batch as Record<string, unknown>).pr_urls;
    if (Array.isArray(entries)) {
      for (const entry of entries) {
        if (typeof entry === 'string') {
          prs.push({ repo: repos[0] ?? 'unknown', prUrl: entry });
        } else if (entry && typeof entry === 'object') {
          const e = entry as Record<string, unknown>;
          const prUrl = String(e.pr_url ?? e.url ?? e.html_url ?? '');
          if (prUrl) {
            prs.push({
              repo: String(e.repo ?? repos[0] ?? 'unknown'),
              prUrl,
              status: e.status ? String(e.status) : undefined,
            });
          }
        }
      }
    }
  }
  const annotationPrs = raw.annotations?.fix_pr_urls ?? raw.annotations?.pr_url;
  if (Array.isArray(annotationPrs)) {
    for (const url of annotationPrs) {
      if (typeof url === 'string') prs.push({ repo: repos[0] ?? 'unknown', prUrl: url });
    }
  } else if (typeof annotationPrs === 'string' && annotationPrs) {
    prs.push({ repo: repos[0] ?? 'unknown', prUrl: annotationPrs });
  }
  return prs;
}

export function computeStats(incidents: NormalizedIncident[]): IncidentStats {
  const active = incidents.filter((i) => i.status === 'active').length;
  const resolved = incidents.filter((i) => i.status === 'resolved').length;
  const bySeverity: Record<string, number> = { SEV1: 0, SEV2: 0, SEV3: 0 };
  const mttrDurations: number[] = [];
  for (const incident of incidents) {
    bySeverity[incident.severityLabel] = (bySeverity[incident.severityLabel] ?? 0) + 1;
    if (incident.status === 'resolved' && incident.firstSeenAt && incident.resolvedAt) {
      const start = Date.parse(incident.firstSeenAt);
      const end = Date.parse(incident.resolvedAt);
      if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
        mttrDurations.push(Math.round((end - start) / 1000));
      }
    }
  }
  const mttrSeconds =
    mttrDurations.length > 0 ? Math.round(mttrDurations.reduce((a, b) => a + b, 0) / mttrDurations.length) : null;
  return { active, resolved, total: incidents.length, mttrSeconds, bySeverity };
}

export async function fetchOsQueue(): Promise<{ incidents: NormalizedIncident[]; reachable: boolean } | null> {
  const baseUrl = osIncidentsBaseUrl();
  if (!baseUrl) {
    log.warn('OS incidents URL not configured (set OS_INCIDENTS_URL or OSY_DISPATCH_URL)');
    return null;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.incidents?.timeoutMs ?? 10_000);
  try {
    const response = await fetch(`${baseUrl}/api/v1/incidents/queue`, {
      headers: {
        'X-API-Key': config.osy?.apiKey ?? '',
        Accept: 'application/json',
      },
      signal: controller.signal,
    });
    if (!response.ok) {
      log.warn({ status: response.status }, 'OS incidents queue request failed');
      return null;
    }
    const body = (await response.json()) as { incidents?: RawOsIncident[] };
    const rawList = Array.isArray(body.incidents) ? body.incidents : [];
    return { incidents: rawList.map(normalizeIncident), reachable: true };
  } catch (err) {
    const aborted = err instanceof Error && err.name === 'AbortError';
    log.warn({ err: String(err), aborted }, 'Failed to fetch OS incidents queue');
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
