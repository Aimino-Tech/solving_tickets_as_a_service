/**
 * Incidents API (AIM-4631) — monitoring-induced incident tracking.
 *
 * Mounted at /api/v1/incidents.
 *
 * - GET /            list incidents (filters: severity, status, source, from, to)
 * - GET /stats       impact stats (total, MTTR, by SEV/status)
 * - GET /services    service catalog list
 * - POST /services   create service → repo mapping
 * - PUT /services/:id  update service mapping
 * - DELETE /services/:id  remove service mapping
 * - GET /:id         incident detail (timeline + linked repos/PRs)
 * - POST /:id/status transition incident status (open → investigating → fixing → resolved)
 */

import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { incidentRepository, serviceCatalogRepository } from '../db/repositories/index.js';
import { rootLogger } from '../utils/logger.js';
import type { NewIncident, NewServiceCatalogEntry } from '../db/types/index.js';

const log = rootLogger.child({ module: 'incidents-api' });

const router: Router = Router();

router.use(requireAuth);

const VALID_STATUSES = new Set(['open', 'investigating', 'fixing', 'resolved']);

router.get('/', async (req: Request, res: Response) => {
  try {
    const filters = {
      severity: typeof req.query.severity === 'string' ? req.query.severity : undefined,
      status: typeof req.query.status === 'string' ? req.query.status : undefined,
      source: typeof req.query.source === 'string' ? req.query.source : undefined,
      from: typeof req.query.from === 'string' ? req.query.from : undefined,
      to: typeof req.query.to === 'string' ? req.query.to : undefined,
      limit: Math.min(Math.abs(Number(req.query.limit) || 50), 200),
      offset: Math.abs(Number(req.query.offset) || 0),
    };
    const { rows, total } = await incidentRepository.list(filters);
    res.json({ data: rows, total, limit: filters.limit, offset: filters.offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list incidents');
    res.status(500).json({ error: 'Failed to list incidents' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const stats = await incidentRepository.getStats();
    res.json(stats);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to load incident stats');
    res.status(500).json({ error: 'Failed to load incident stats' });
  }
});

router.get('/services', async (req: Request, res: Response) => {
  try {
    const services = await serviceCatalogRepository.list();
    res.json({ data: services });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list service catalog');
    res.status(500).json({ error: 'Failed to list service catalog' });
  }
});

router.post('/services', async (req: Request, res: Response) => {
  try {
    const body = req.body as Partial<NewServiceCatalogEntry>;
    if (!body.name?.trim()) {
      res.status(400).json({ error: 'Service name is required' });
      return;
    }
    const service = await serviceCatalogRepository.create({
      name: body.name.trim(),
      purpose: body.purpose ?? null,
      repos: Array.isArray(body.repos) ? body.repos : [],
    });
    res.status(201).json({ data: service });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create service');
    res.status(500).json({ error: 'Failed to create service' });
  }
});

router.put('/services/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const body = req.body as Partial<Pick<NewServiceCatalogEntry, 'purpose' | 'repos'>>;
    const service = await serviceCatalogRepository.update(id, {
      purpose: body.purpose ?? null,
      repos: Array.isArray(body.repos) ? body.repos : undefined,
    });
    if (!service) {
      res.status(404).json({ error: 'Service not found' });
      return;
    }
    res.json({ data: service });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update service');
    res.status(500).json({ error: 'Failed to update service' });
  }
});

router.delete('/services/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    await serviceCatalogRepository.remove(id);
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to delete service');
    res.status(500).json({ error: 'Failed to delete service' });
  }
});

router.get('/:id', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const incident = await incidentRepository.getById(id);
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    const [timeline, repos] = await Promise.all([
      incidentRepository.getTimeline(id),
      incidentRepository.getRepos(id),
    ]);
    res.json({ data: { ...incident, timeline, repos } });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to load incident detail');
    res.status(500).json({ error: 'Failed to load incident detail' });
  }
});

router.post('/:id/status', async (req: Request, res: Response) => {
  try {
    const id = Number(req.params.id);
    if (Number.isNaN(id)) {
      res.status(400).json({ error: 'Invalid id' });
      return;
    }
    const status = String(req.body?.status ?? '');
    if (!VALID_STATUSES.has(status)) {
      res.status(400).json({ error: `Invalid status. Must be one of: ${[...VALID_STATUSES].join(', ')}` });
      return;
    }
    const incident = await incidentRepository.getById(id);
    if (!incident) {
      res.status(404).json({ error: 'Incident not found' });
      return;
    }
    const resolvedAt = status === 'resolved' ? new Date() : null;
    const updated = await incidentRepository.updateStatus(id, status, { resolvedAt });
    await incidentRepository.addTimeline({
      incidentId: id,
      event: `status:${status}`,
      detail: `Status transitioned from ${incident.status} to ${status}`,
    });
    res.json({ data: updated });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to update incident status');
    res.status(500).json({ error: 'Failed to update incident status' });
  }
});

// Seed helper for tests/dev: create an incident (used by integration tests only).
export function createIncidentRouter(seedIncident?: NewIncident): Router {
  if (seedIncident) {
    void incidentRepository.create(seedIncident);
  }
  return router;
}

export const incidentsRouter = router;
