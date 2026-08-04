import { queryWithRetry, isTableNotFoundError } from '../db/connection.js';
import { notificationHistoryRepository } from '../db/repositories/index.js';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import type { NormalizedIncident } from './types.js';

const log = rootLogger.child({ module: 'incident-notifications' });

interface StatusStateRow {
  fingerprint: string;
  status: string;
}

function loadStates(): Promise<Record<string, string>> {
  return queryWithRetry<StatusStateRow>('SELECT fingerprint, status FROM incident_status_state', [])
    .then((result) => {
      const map: Record<string, string> = {};
      for (const row of result.rows) map[row.fingerprint] = row.status;
      return map;
    })
    .catch((err) => {
      if (isTableNotFoundError(err)) return {};
      log.warn({ err: String(err) }, 'Failed to load incident status state');
      return {};
    });
}

async function persistState(fingerprint: string, status: string): Promise<void> {
  try {
    await queryWithRetry(
      `INSERT INTO incident_status_state (fingerprint, status, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (fingerprint) DO UPDATE SET status = EXCLUDED.status, updated_at = NOW()`,
      [fingerprint, status],
    );
  } catch (err) {
    log.warn({ err: String(err), fingerprint }, 'Failed to persist incident status state');
  }
}

async function createResolvedNotification(incident: NormalizedIncident): Promise<void> {
  try {
    const accounts = await queryWithRetry<{ id: number }>('SELECT id FROM accounts', []);
    const title = `Incident resolved: ${incident.title}`;
    const body = `${incident.severityLabel} ${incident.service} — resolved in ${formatAge(incident)}.`;
    for (const account of accounts.rows) {
      await notificationHistoryRepository.create({
        userId: String(account.id),
        eventType: 'incident_resolved',
        channel: 'in_app',
        title,
        body,
        metadata: {
          incidentFingerprint: incident.fingerprint,
          service: incident.service,
          severity: incident.severityLabel,
          difficulty: incident.difficulty,
          variant: incident.variant,
          prs: incident.prs,
        },
      });
    }
  } catch (err) {
    log.warn({ err: String(err), fingerprint: incident.fingerprint }, 'Failed to create resolved notification');
  }
}

function formatAge(incident: NormalizedIncident): string {
  if (!incident.firstSeenAt || !incident.resolvedAt) return 'unknown duration';
  const start = Date.parse(incident.firstSeenAt);
  const end = Date.parse(incident.resolvedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 'unknown duration';
  const minutes = Math.round((end - start) / 60_000);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.round(minutes / 60)}h ${minutes % 60}m`;
}

export async function persistIncidentStates(incidents: NormalizedIncident[]): Promise<void> {
  for (const incident of incidents) {
    await persistState(incident.fingerprint, incident.status);
  }
}

export async function notifyIncidentResolutions(incidents: NormalizedIncident[]): Promise<void> {
  if (!config.incidents?.resolveNotifications) return;
  const states = await loadStates();
  let fired = 0;
  for (const incident of incidents) {
    const previous = states[incident.fingerprint];
    if (incident.status === 'resolved' && previous !== 'resolved') {
      await createResolvedNotification(incident);
      fired += 1;
    }
  }
  if (fired > 0) log.info({ resolved: fired }, 'Sent incident-resolved notifications');
}
