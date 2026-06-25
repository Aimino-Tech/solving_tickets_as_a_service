/**
 * Dashboard API routes for the STAS premium hosted service.
 *
 * These routes provide the data backing for the React dashboard.
 * All routes require JWT authentication.
 *
 * GET    /api/runs       — List runs (paginated, filterable)
 * GET    /api/runs/:id   — Run detail
 * GET    /api/repos      — Connected repos
 * POST   /api/repos      — Connect a repo
 * DELETE /api/repos/:id  — Disconnect a repo
 * GET    /api/stats      — Aggregate dashboard statistics
 * GET    /api/audit      — Audit log entries (paginated)
 * GET    /api/settings   — Current bot settings
 * PUT    /api/settings   — Update bot settings
 */

import { Router, type Request, type Response } from 'express';
import { rootLogger } from '../../../src/utils/logger.js';
import { jwtAuth } from '../middleware/auth.js';
import {
  resolveAccountId,
  listRuns,
  getRun,
  listRepos,
  createRepo,
  deleteRepo,
  getStats,
  listAuditLogs,
  getSettings as loadSettings,
  updateSettings as saveSettings,
} from '../services/dashboardService.js';

const log = rootLogger.child({ module: 'premium-dashboard-routes' });

const router = Router();

router.use(jwtAuth);

async function getAccountId(req: Request, res: Response): Promise<number | null> {
  const githubId = req.user?.githubId;
  if (!githubId) {
    res.status(401).json({ error: 'User not authenticated' });
    return null;
  }
  const accountId = await resolveAccountId(githubId);
  if (!accountId) {
    res.status(404).json({ error: 'Account not found' });
    return null;
  }
  return accountId;
}

router.get('/runs', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
    const status = req.query.status as string | undefined;
    const repo = req.query.repo as string | undefined;

    const result = await listRuns(accountId, page, perPage, status, repo);
    log.debug({ page, perPage, total: result.total, status, repo }, 'List runs');
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const runId = Number(req.params.id);
    if (!Number.isFinite(runId) || runId <= 0) {
      res.status(400).json({ error: 'Invalid run ID' });
      return;
    }

    const run = await getRun(accountId, runId);
    if (!run) {
      res.status(404).json({ error: 'Run not found' });
      return;
    }

    res.json(run);
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to get run');
    res.status(500).json({ error: 'Failed to get run' });
  }
});

router.get('/repos', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const repos = await listRepos(accountId);
    res.json(repos);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list repos');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

router.post('/repos', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const { owner, repo, installationId } = req.body;
    if (!owner || !repo) {
      res.status(400).json({ error: 'owner and repo are required' });
      return;
    }

    const created = await createRepo(accountId, owner, repo, installationId ?? null);
    log.info({ owner, repo, user: req.user?.username }, 'Repo connected');

    res.status(201).json(created);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to connect repo');
    res.status(500).json({ error: 'Failed to connect repo' });
  }
});

router.delete('/repos/:id', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const repoId = Number(req.params.id);
    if (!Number.isFinite(repoId) || repoId <= 0) {
      res.status(400).json({ error: 'Invalid repo ID' });
      return;
    }

    const deleted = await deleteRepo(accountId, repoId);
    if (!deleted) {
      res.status(404).json({ error: 'Repo not found' });
      return;
    }

    log.info({ repoId, user: req.user?.username }, 'Repo disconnected');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to disconnect repo');
    res.status(500).json({ error: 'Failed to disconnect repo' });
  }
});

router.get('/stats', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const stats = await getStats(accountId);
    res.json(stats);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get stats');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

router.get('/audit', async (req: Request, res: Response) => {
  try {
    const accountId = await getAccountId(req, res);
    if (!accountId) return;

    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 30));

    const result = await listAuditLogs(accountId, page, perPage);
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list audit entries');
    res.status(500).json({ error: 'Failed to list audit entries' });
  }
});

router.get('/settings', async (_req: Request, res: Response) => {
  try {
    const settings = loadSettings();
    res.json(settings);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get settings');
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

router.put('/settings', async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    const result = saveSettings(updates);
    log.info({ updates, user: req.user?.username }, 'Settings updated');
    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update settings');
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export { router as dashboardRouter };
