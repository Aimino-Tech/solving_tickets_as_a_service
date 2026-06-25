/**
 * PLG self-serve onboarding routes — AIM-2075.
 *
 * Provides the API surface for product-led growth onboarding flow:
 *
 *   GET  /plg/install           — Redirect to GitHub App install (OAuth flow)
 *   GET  /plg/status            — Get current tenant PLG status (onboarding + usage)
 *   POST /plg/webhook/auto-config — Auto-configure webhook for a tenant
 *   POST /plg/welcome-issue     — Create a welcome issue in the selected repo
 *   GET  /plg/dashboard         — Dashboard data (usage, repos, recent runs)
 *
 * The back-end Celery tasks live in workers/billing/plg.py.
 *
 * ── Design Philosophy ─────────────────────────────────────────────────────────
 * - GitHub App install is the primary onboarding action (single-click).
 * - Webhook config is auto-detected and self-healing (no manual setup).
 * - The welcome issue is a "try me" issue that walks the user through the flow.
 * - The dashboard surface is minimal — usage count + connected repos + first fix
 *   guidance. Full analytics is in the premium dashboard.
 * ──────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'plg-onboarding' });

// ---------------------------------------------------------------------------
// Rate Limiting: 20 requests per minute for PLG onboarding endpoints
// ---------------------------------------------------------------------------

const plgLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

const router = Router();

router.use(plgLimiter);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTenantId(req: Request): string | undefined {
  const headerId = req.headers['x-tenant-id'] as string | undefined;
  if (headerId) return headerId;
  const queryId = req.query.tenantId as string | undefined;
  if (queryId) return queryId;
  if (config.stas.mode === 'oss') return 'default';
  return undefined;
}

function getInstallationId(req: Request): number | undefined {
  const headerVal = req.headers['x-installation-id'] as string | undefined;
  if (headerVal) {
    const id = Number(headerVal);
    if (Number.isFinite(id) && id > 0) return id;
  }
  const queryVal = req.query.installationId as string | undefined;
  if (queryVal) {
    const id = Number(queryVal);
    if (Number.isFinite(id) && id > 0) return id;
  }
  const bodyVal = req.body?.installationId;
  if (bodyVal && typeof bodyVal === 'number' && bodyVal > 0) return bodyVal;
  if (bodyVal && typeof bodyVal === 'string') {
    const id = Number(bodyVal);
    if (Number.isFinite(id) && id > 0) return id;
  }
  return undefined;
}

function buildInstallUrl(): string {
  return `https://github.com/apps/${config.github.appId}/installations/new`;
}

// ---------------------------------------------------------------------------
// GET /plg/install — Redirect to GitHub App install flow
// ---------------------------------------------------------------------------

router.get('/install', (req: Request, res: Response) => {
  const tenantId = getTenantId(req);
  const redirect = req.query.redirect as string | undefined;
  const state = crypto.randomUUID();

  res.cookie('plg_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.nodeEnv === 'production',
    maxAge: 600_000,
    path: '/',
  });

  const installUrl = buildInstallUrl();
  const params = new URLSearchParams({ state });
  if (tenantId) params.set('tenant_id', tenantId);

  const targetUrl = redirect
    ? `${installUrl}?${params.toString()}&redirect_uri=${encodeURIComponent(redirect)}`
    : `${installUrl}?${params.toString()}`;

  log.info({ tenantId, redirect }, 'Redirecting to GitHub App install');
  res.redirect(302, targetUrl);
});

// ---------------------------------------------------------------------------
// GET /plg/status — Get current tenant PLG status
// ---------------------------------------------------------------------------

router.get('/status', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required. Provide x-tenant-id header or tenantId query param.' });
      return;
    }

    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';
    const response = await fetch(
      `${workerUrl}/api/plg/status?tenant_id=${encodeURIComponent(tenantId)}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, status: response.status, errorBody }, 'Worker PLG status fetch failed');
      res.status(502).json({ error: 'Failed to fetch PLG status', detail: errorBody });
      return;
    }

    const result = await response.json() as {
      tenant_id: string;
      state: string;
      github_installed: boolean;
      repo_selected: boolean;
      completed: boolean;
      usage: { count: number; remaining: number };
      connected_repos: number;
      installed_repos: number;
      first_fix_completed: boolean;
      joined_at?: string;
    };

    res.json({
      tenantId: result.tenant_id,
      onboarding: {
        state: result.state,
        githubInstalled: result.github_installed,
        repoSelected: result.repo_selected,
        completed: result.completed,
      },
      usage: {
        count: result.usage.count,
        remaining: result.usage.remaining,
        display: `${result.usage.count}/${result.usage.count + Math.max(0, result.usage.remaining)} free fixes`,
      },
      connectedRepos: result.connected_repos,
      installedRepos: result.installed_repos,
      firstFixCompleted: result.first_fix_completed,
      joinedAt: result.joined_at ?? null,
      installUrl: buildInstallUrl(),
      nextAction: deriveNextAction(result),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get PLG status');
    res.status(500).json({ error: 'Failed to get PLG status' });
  }
});

function deriveNextAction(status: {
  state: string;
  github_installed: boolean;
  repo_selected: boolean;
  completed: boolean;
  first_fix_completed: boolean;
  connected_repos: number;
}): { action: string; label: string; url?: string } {
  if (!status.github_installed) {
    return { action: 'install_github_app', label: 'Install STAS GitHub App', url: buildInstallUrl() };
  }
  if (!status.repo_selected) {
    return { action: 'select_repos', label: 'Select repositories to monitor' };
  }
  if (!status.completed) {
    return { action: 'complete_onboarding', label: 'Complete onboarding setup' };
  }
  if (!status.first_fix_completed) {
    return { action: 'create_first_issue', label: 'Label an issue with stas:fix to get your first fix' };
  }
  return { action: 'dashboard', label: 'View your fix history and usage' };
}

// ---------------------------------------------------------------------------
// POST /plg/webhook/auto-config — Auto-configure webhook for tenant
// ---------------------------------------------------------------------------

router.post('/webhook/auto-config', async (req: Request, res: Response) => {
  try {
    const tenantId = req.body.tenantId ?? getTenantId(req);
    const installationId = getInstallationId(req);

    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required.' });
      return;
    }
    if (!installationId) {
      res.status(400).json({ error: 'installationId (number) is required. Provide x-installation-id header, installationId query param, or installationId in body.' });
      return;
    }

    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';
    const response = await fetch(`${workerUrl}/api/plg/webhook/auto-config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        installation_id: installationId,
        webhook_url: `${req.protocol}://${req.get('host')}/webhook`,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, installationId, status: response.status, errorBody }, 'Webhook auto-config failed');
      res.status(502).json({ error: 'Failed to auto-configure webhook', detail: errorBody });
      return;
    }

    const result = await response.json() as {
      configured: boolean;
      webhook_id?: number;
      active: boolean;
      events: string[];
    };

    log.info({ tenantId, installationId, webhookId: result.webhook_id }, 'Webhook auto-configured');
    res.json({
      configured: result.configured,
      webhookId: result.webhook_id,
      active: result.active,
      events: result.events,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to auto-configure webhook');
    res.status(500).json({ error: 'Failed to auto-configure webhook' });
  }
});

// ---------------------------------------------------------------------------
// POST /plg/welcome-issue — Create a welcome issue in the selected repo
// ---------------------------------------------------------------------------

router.post('/welcome-issue', async (req: Request, res: Response) => {
  try {
    const tenantId = req.body.tenantId ?? getTenantId(req);
    const installationId = getInstallationId(req);
    const { repoOwner, repoName } = req.body as { repoOwner?: string; repoName?: string };

    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required.' });
      return;
    }
    if (!installationId) {
      res.status(400).json({ error: 'installationId (number) is required.' });
      return;
    }
    if (!repoOwner || !repoName) {
      res.status(400).json({ error: 'repoOwner and repoName are required in request body.' });
      return;
    }

    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';
    const response = await fetch(`${workerUrl}/api/plg/welcome-issue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tenant_id: tenantId,
        installation_id: installationId,
        repo_owner: repoOwner,
        repo_name: repoName,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, installationId, repoOwner, repoName, status: response.status, errorBody }, 'Welcome issue creation failed');
      res.status(502).json({ error: 'Failed to create welcome issue', detail: errorBody });
      return;
    }

    const result = await response.json() as {
      issue_url: string;
      issue_number: number;
    };

    log.info({ tenantId, repoOwner, repoName, issueNumber: result.issue_number }, 'Welcome issue created');
    res.json({
      issueUrl: result.issue_url,
      issueNumber: result.issue_number,
      message: `Welcome issue #${result.issue_number} created! Label it with \`${config.stas.label}\` to see STAS in action.`,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create welcome issue');
    res.status(500).json({ error: 'Failed to create welcome issue' });
  }
});

// ---------------------------------------------------------------------------
// GET /plg/dashboard — Dashboard data (usage, repos, recent runs)
// ---------------------------------------------------------------------------

router.get('/dashboard', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);
    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required.' });
      return;
    }

    const limit = Math.min(Math.abs(Number(req.query.limit) || 10), 50);

    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';
    const response = await fetch(
      `${workerUrl}/api/plg/dashboard?tenant_id=${encodeURIComponent(tenantId)}&limit=${limit}`,
      { headers: { Accept: 'application/json' } },
    );

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, status: response.status, errorBody }, 'Worker dashboard fetch failed');
      res.status(502).json({ error: 'Failed to fetch dashboard data', detail: errorBody });
      return;
    }

    const result = await response.json() as {
      tenant_id: string;
      usage: { count: number; remaining: number; tier: string; display: string };
      connected_repos: Array<{ owner: string; name: string; active: boolean }>;
      recent_runs: Array<{
        id: string;
        issue_title: string;
        status: string;
        repo: string;
        created_at: string;
        pr_url?: string;
      }>;
      first_fix_completed: boolean;
      onboarding_completed: boolean;
    };

    res.json({
      tenantId: result.tenant_id,
      usage: result.usage,
      connectedRepos: result.connected_repos,
      recentRuns: result.recent_runs,
      firstFixCompleted: result.first_fix_completed,
      onboardingCompleted: result.onboarding_completed,
      installUrl: buildInstallUrl(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get dashboard data');
    res.status(500).json({ error: 'Failed to get dashboard data' });
  }
});

export { router as plgRouter };
