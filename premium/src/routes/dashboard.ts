/**
 * Dashboard API routes for the STAS premium hosted service.
 *
 * These routes provide the data backing for the React dashboard.
 * All routes (except /stats) require JWT authentication.
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

const log = rootLogger.child({ module: 'premium-dashboard-routes' });

const router = Router();

// All routes require auth
router.use(jwtAuth);

// ---------------------------------------------------------------------------
// GET /api/runs
// ---------------------------------------------------------------------------
router.get('/runs', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 20));
    const status = req.query.status as string | undefined;
    const repo = req.query.repo as string | undefined;

    // TODO: Replace with actual DB queries when DB is wired
    const mockData = generateMockRuns();
    let filtered = mockData;

    if (status) {
      filtered = filtered.filter((r) => r.status === status);
    }
    if (repo) {
      filtered = filtered.filter((r) => `${r.repoOwner}/${r.repoName}`.includes(repo));
    }

    const total = filtered.length;
    const totalPages = Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const data = filtered.slice(start, start + perPage);

    log.debug({ page, perPage, total, status, repo }, 'List runs');
    res.json({ data, total, page, perPage, totalPages });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list runs');
    res.status(500).json({ error: 'Failed to list runs' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/runs/:id
// ---------------------------------------------------------------------------
router.get('/runs/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const runs = generateMockRuns();
    const run = runs.find((r) => r.id === id);

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

// ---------------------------------------------------------------------------
// GET /api/repos
// ---------------------------------------------------------------------------
router.get('/repos', async (_req: Request, res: Response) => {
  try {
    // TODO: Replace with DB query
    const repoList = generateMockRepos();
    res.json(repoList);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list repos');
    res.status(500).json({ error: 'Failed to list repos' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/repos
// ---------------------------------------------------------------------------
router.post('/repos', async (req: Request, res: Response) => {
  try {
    const { owner, repo, installationId } = req.body;

    if (!owner || !repo) {
      res.status(400).json({ error: 'owner and repo are required' });
      return;
    }

    // TODO: Persist to DB
    log.info({ owner, repo, installationId, user: req.user?.username }, 'Repo connected');

    res.status(201).json({
      id: `repo-${owner}-${repo}`,
      owner,
      repo,
      active: true,
      installationId: installationId || null,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to connect repo');
    res.status(500).json({ error: 'Failed to connect repo' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/repos/:id
// ---------------------------------------------------------------------------
router.delete('/repos/:id', async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    // TODO: Delete from DB
    log.info({ repoId: id, user: req.user?.username }, 'Repo disconnected');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err), id: req.params.id }, 'Failed to disconnect repo');
    res.status(500).json({ error: 'Failed to disconnect repo' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/stats
// ---------------------------------------------------------------------------
router.get('/stats', async (_req: Request, res: Response) => {
  try {
    // TODO: Aggregate from DB
    const mockRuns = generateMockRuns();
    const totalRuns = mockRuns.length;
    const passed = mockRuns.filter((r) => r.status === 'success').length;
    const passRate = totalRuns > 0 ? passed / totalRuns : 0;
    const avgDuration = totalRuns > 0
      ? Math.round(mockRuns.reduce((s, r) => s + (r.durationSeconds || 0), 0) / totalRuns)
      : 0;

    // Generate mock daily data
    const now = new Date();
    const runsByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (13 - i));
      const dayStr = d.toISOString().slice(0, 10);
      const count = Math.floor(Math.random() * 8) + 1;
      const passedCount = Math.floor(count * (0.5 + Math.random() * 0.4));
      return { date: dayStr, count, passed: passedCount };
    });

    const costByDay = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (13 - i));
      return { date: d.toISOString().slice(0, 10), costCents: Math.floor(Math.random() * 500) + 50 };
    });

    const fixRateByWeek = Array.from({ length: 8 }, (_, i) => {
      const d = new Date(now);
      d.setDate(d.getDate() - (7 - i) * 7);
      const weekStr = d.toISOString().slice(0, 10);
      return { week: weekStr, rate: 0.5 + Math.random() * 0.4 };
    });

    res.json({
      totalRuns,
      passRate,
      avgDurationSeconds: avgDuration,
      activeRepos: generateMockRepos().length,
      runsByDay,
      costByDay,
      fixRateByWeek,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get stats');
    res.status(500).json({ error: 'Failed to get stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/audit
// ---------------------------------------------------------------------------
router.get('/audit', async (req: Request, res: Response) => {
  try {
    const page = Math.max(1, Number(req.query.page) || 1);
    const perPage = Math.min(100, Math.max(1, Number(req.query.perPage) || 30));

    const entries = generateMockAuditEntries();
    const total = entries.length;
    const totalPages = Math.ceil(total / perPage);
    const start = (page - 1) * perPage;
    const data = entries.slice(start, start + perPage);

    res.json({ data, total, page, perPage, totalPages });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list audit entries');
    res.status(500).json({ error: 'Failed to list audit entries' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/settings
// ---------------------------------------------------------------------------
router.get('/settings', async (_req: Request, res: Response) => {
  try {
    // TODO: Load from DB/config
    res.json({
      label: process.env.STAS_LABEL || 'stas:fix',
      model: process.env.OPENCODE_MODEL || 'aimino/agi-v1',
      maxConcurrent: Number(process.env.STAS_MAX_CONCURRENT) || 3,
      sandboxPoolSize: Number(process.env.SANDBOX_POOL_SIZE) || 10,
      auditLogEnabled: process.env.STAS_AUDIT_LOG === 'true',
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get settings');
    res.status(500).json({ error: 'Failed to get settings' });
  }
});

// ---------------------------------------------------------------------------
// PUT /api/settings
// ---------------------------------------------------------------------------
router.put('/settings', async (req: Request, res: Response) => {
  try {
    const updates = req.body;
    // TODO: Persist to DB
    log.info({ updates, user: req.user?.username }, 'Settings updated');
    res.json({ success: true });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update settings');
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

export { router as dashboardRouter };

// ---------------------------------------------------------------------------
// Mock data generators (placeholder until DB is wired)
// ---------------------------------------------------------------------------


function generateMockRuns() {
  const statuses: Array<'queued' | 'running' | 'success' | 'failed' | 'cancelled'> = [
    'success', 'success', 'success', 'failed', 'success', 'running', 'queued',
  ];
  const repos = [
    { owner: 'my-org', repo: 'frontend-app' },
    { owner: 'my-org', repo: 'api-service' },
    { owner: 'acme-inc', repo: 'mobile-app' },
  ];

  return Array.from({ length: 50 }, (_, i) => {
    const repo = repos[i % repos.length];
    const status = statuses[i % statuses.length];
    const createdAt = new Date(Date.now() - i * 3600000 * (1 + Math.random()));
    const duration = status === 'success' ? 60 + Math.floor(Math.random() * 600) : undefined;
    return {
      id: 'repo-2',
      repoOwner: repo.owner,
      repoName: repo.repo,
      issueNumber: 100 + i,
      issueTitle: `Fix login edge case on ${repo.repo}`,
      status,
      modelUsed: 'aimino/agi-v1',
      costCents: status === 'success' ? Math.floor(Math.random() * 300) + 50 : undefined,
      durationSeconds: duration,
      prUrl: status === 'success' ? `https://github.com/${repo.owner}/${repo.repo}/pull/${200 + i}` : undefined,
      errorMessage: status === 'failed' ? 'Sandbox timeout after 300s. Agent exceeded max iterations.' : undefined,
      createdAt: createdAt.toISOString(),
      updatedAt: new Date(createdAt.getTime() + (duration || 60) * 1000).toISOString(),
    };
  });
}

function generateMockRepos() {
  return [
    {
      id: 'repo-1',
      owner: 'my-org',
      repo: 'frontend-app',
      active: true,
      installationId: 123456,
      createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    },
    {
      id: 'repo-2',
      owner: 'my-org',
      repo: 'api-service',
      active: true,
      installationId: 123456,
      createdAt: new Date(Date.now() - 25 * 86400000).toISOString(),
    },
    {
      id: 'repo-3',
      owner: 'acme-inc',
      repo: 'mobile-app',
      active: true,
      installationId: 789012,
      createdAt: new Date(Date.now() - 14 * 86400000).toISOString(),
    },
  ];
}

function generateMockAuditEntries() {
  const actions = ['run_started', 'run_completed', 'run_failed', 'repo_connected', 'repo_disconnected', 'settings_updated', 'user_login'];
  const usernames = ['alice', 'bob', 'charlie', 'system'];

  return Array.from({ length: 100 }, (_, i) => {
    const action = actions[i % actions.length];
    return {
      id: `audit-${i + 1}`,
      action,
      actor: usernames[i % usernames.length],
      target: action.includes('run') ? `Run #${100 + i}` : action.includes('repo') ? `my-org/repo-${i}` : undefined,
      details: Math.random() > 0.5 ? { repo: 'my-org/frontend-app', issue: 100 + i } : undefined,
      createdAt: new Date(Date.now() - i * 7200000).toISOString(),
    };
  });
}
