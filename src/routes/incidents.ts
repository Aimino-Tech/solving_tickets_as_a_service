import { type Request, type Response, Router } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { isTableNotFoundError } from '../db/connection.js';
import { incidentServiceCatalogRepository } from '../db/repositories/index.js';
import { notifyIncidentResolutions, persistIncidentStates } from '../incidents/incidentNotifications.js';
import { computeStats, fetchOsQueue } from '../incidents/osClient.js';
import type { IncidentStats, NormalizedIncident } from '../incidents/types.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'incidents-api' });

const router: Router = Router();

function applyFilters(
  incidents: NormalizedIncident[],
  query: Record<string, string | undefined>,
): NormalizedIncident[] {
  let filtered = incidents;
  const status = query.status;
  if (status === 'active' || status === 'resolved') {
    filtered = filtered.filter((i) => i.status === status);
  }
  const severity = query.severity;
  if (severity) {
    const match = /SEV(\d)/i.exec(severity);
    const level = match ? Number(match[1]) : Number(severity);
    if (Number.isFinite(level)) {
      filtered = filtered.filter((i) => i.severity === level);
    }
  }
  const source = query.source;
  if (source) {
    filtered = filtered.filter((i) => i.service.toLowerCase() === source.toLowerCase());
  }
  const q = query.q?.trim().toLowerCase();
  if (q) {
    filtered = filtered.filter(
      (i) =>
        i.title.toLowerCase().includes(q) ||
        i.service.toLowerCase().includes(q) ||
        i.fingerprint.toLowerCase().includes(q),
    );
  }
  return filtered;
}

function attachCatalog(
  incidents: NormalizedIncident[],
  catalog: Array<{ name: string; repos: string[]; purpose: string | null; runbook: string | null }>,
) {
  const byName = new Map(catalog.map((c) => [c.name.toLowerCase(), c]));
  return incidents.map((incident) => {
    const entry = byName.get(incident.service.toLowerCase());
    return entry
      ? {
          ...incident,
          catalog: { repos: entry.repos, purpose: entry.purpose, runbook: entry.runbook },
        }
      : incident;
  });
}

router.get('/', requireAuth, async (req: Request, res: Response) => {
  try {
    const osResult = await fetchOsQueue();
    let incidents: NormalizedIncident[] = [];
    let reachable = false;
    if (osResult) {
      incidents = osResult.incidents;
      reachable = osResult.reachable;
    }

    const watcherPromise = Promise.all([notifyIncidentResolutions(incidents), persistIncidentStates(incidents)]).catch(
      (err) => log.warn({ err: String(err) }, 'Incident watcher failed'),
    );

    let catalog: Array<{ name: string; repos: string[]; purpose: string | null; runbook: string | null }> = [];
    try {
      catalog = await incidentServiceCatalogRepository.list();
    } catch (err) {
      if (!isTableNotFoundError(err)) log.warn({ err: String(err) }, 'Service catalog read failed');
    }

    const enriched = attachCatalog(incidents, catalog);
    const filtered = applyFilters(enriched, req.query as Record<string, string | undefined>);
    const stats = computeStats(filtered);

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(Math.max(1, Number(req.query.perPage) || 20), 100);
    const offset = (page - 1) * perPage;
    const data = filtered.slice(offset, offset + perPage);

    void watcherPromise;
    res.json({
      data,
      total: filtered.length,
      page,
      perPage,
      totalPages: Math.ceil(filtered.length / perPage),
      stats,
      source: reachable ? 'opensymphony' : 'unavailable',
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list incidents');
    res.status(500).json({ error: 'Failed to list incidents' });
  }
});

router.get('/service-catalog', requireAuth, async (_req: Request, res: Response) => {
  try {
    res.json({ data: await incidentServiceCatalogRepository.list() });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list service catalog');
    res.status(500).json({ error: 'Failed to list service catalog' });
  }
});

router.post('/service-catalog', requireAuth, async (req: Request, res: Response) => {
  const name = String(req.body?.name ?? '').trim();
  if (!name) {
    res.status(400).json({ error: 'name is required' });
    return;
  }
  try {
    const existing = await incidentServiceCatalogRepository.findByName(name);
    if (existing) {
      res.status(409).json({ error: 'A service with this name already exists' });
      return;
    }
    const created = await incidentServiceCatalogRepository.create({
      name,
      repos: Array.isArray(req.body.repos) ? req.body.repos.map(String) : [],
      purpose: req.body.purpose != null ? String(req.body.purpose) : null,
      runbook: req.body.runbook != null ? String(req.body.runbook) : null,
      providers: Array.isArray(req.body.providers) ? req.body.providers.map(String) : [],
    });
    res.status(201).json(created);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create service catalog entry');
    res.status(500).json({ error: 'Failed to create service catalog entry' });
  }
});

router.put('/service-catalog/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid service id' });
    return;
  }
  try {
    const existing = await incidentServiceCatalogRepository.findById(id);
    if (!existing) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    const body = req.body ?? {};
    const updated = await incidentServiceCatalogRepository.update(id, {
      name: body.name !== undefined ? String(body.name).trim() : undefined,
      repos: body.repos !== undefined ? (Array.isArray(body.repos) ? body.repos.map(String) : []) : undefined,
      purpose: body.purpose !== undefined ? (body.purpose != null ? String(body.purpose) : null) : undefined,
      runbook: body.runbook !== undefined ? (body.runbook != null ? String(body.runbook) : null) : undefined,
      providers:
        body.providers !== undefined ? (Array.isArray(body.providers) ? body.providers.map(String) : []) : undefined,
    });
    res.json(updated);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update service catalog entry');
    res.status(500).json({ error: 'Failed to update service catalog entry' });
  }
});

router.delete('/service-catalog/:id', requireAuth, async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid service id' });
    return;
  }
  try {
    const deleted = await incidentServiceCatalogRepository.delete(id);
    if (!deleted) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.status(204).end();
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to delete service catalog entry');
    res.status(500).json({ error: 'Failed to delete service catalog entry' });
  }
});

router.get('/:fingerprint', requireAuth, async (req: Request, res: Response) => {
  try {
    const osResult = await fetchOsQueue();
    const incidents = osResult?.incidents ?? [];
    const incident = incidents.find((i) => i.fingerprint === req.params.fingerprint);
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    const catalog = await incidentServiceCatalogRepository.list().catch(() => []);
    const [enriched] = attachCatalog([incident], catalog);
    const stats: IncidentStats = computeStats(incidents);
    res.json({ incident: enriched, stats });
  } catch (err) {
    log.error({ err: String(err), fingerprint: req.params.fingerprint }, 'Failed to fetch incident detail');
    res.status(500).json({ error: 'Failed to fetch incident detail' });
  }
});

export { router as incidentsRouter };
