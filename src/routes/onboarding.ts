/**
 * Onboarding wizard routes.
 *
 * Provides the API surface for the onboarding wizard flow:
 *   GET  /onboarding       — Returns the wizard UI / onboarding state
 *   POST /onboarding/github  — Records GitHub App installation completion
 *   POST /onboarding/linear  — Handles Linear OAuth callback
 *   GET  /onboarding/status — Returns structured onboarding progress
 *
 * State is managed by the `OnboardingStateMachine` in the workers package
 * via HTTP calls to the Celery task endpoint or direct Redis access.
 *
 * @module routes/onboarding
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'onboarding' });

// ---------------------------------------------------------------------------
// Rate Limiting: 10 requests per minute for onboarding endpoints
// ---------------------------------------------------------------------------

const onboardingLimiter = rateLimit({
  windowMs: 60_000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

const router = Router();

router.use(onboardingLimiter);

// ---------------------------------------------------------------------------
// Helper: extract tenant / account identifier
// ---------------------------------------------------------------------------

function getTenantId(req: Request): string | undefined {
  const headerId = req.headers['x-tenant-id'] as string | undefined;
  if (headerId) return headerId;
  const queryId = req.query.tenantId as string | undefined;
  if (queryId) return queryId;
  // Fall back to a default tenant in OSS mode
  if (config.stas.mode === 'oss') return 'default';
  return undefined;
}

// ---------------------------------------------------------------------------
// POST /onboarding/github — Record GitHub App installation
// ---------------------------------------------------------------------------

/**
 * Called after the tenant installs the GitHub App.  Marks the
 * `github_installed` state in the onboarding state machine.
 *
 * Body: { installationId: number, tenantId?: string }
 */
router.post('/github', async (req: Request, res: Response) => {
  try {
    const tenantId = req.body.tenantId ?? getTenantId(req);
    const { installationId } = req.body;

    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required. Provide x-tenant-id header, tenantId query param, or tenantId in body.' });
      return;
    }
    if (!installationId || typeof installationId !== 'number') {
      res.status(400).json({ error: 'installationId (number) is required in request body' });
      return;
    }

    // Record GitHub installation by dispatching to the Celery task
    const { default: fetch } = await import('node-fetch');
    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';

    const response = await fetch(`${workerUrl}/api/onboarding/github`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, installation_id: installationId }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, installationId, status: response.status, errorBody }, 'Worker onboarding task failed');
      res.status(502).json({ error: 'Failed to record GitHub installation', detail: errorBody });
      return;
    }

    const result = await response.json() as { state: string };
    log.info({ tenantId, installationId, state: result.state }, 'GitHub installation recorded');

    res.json({ success: true, state: result.state });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to process GitHub installation');
    res.status(500).json({ error: 'Failed to process GitHub installation' });
  }
});

// ---------------------------------------------------------------------------
// POST /onboarding/linear — Handle Linear OAuth callback
// ---------------------------------------------------------------------------

/**
 * Called when the tenant completes the Linear OAuth flow.  Marks the
 * `linear_authed` state.
 *
 * Body: { code: string, tenantId?: string }
 */
router.post('/linear', async (req: Request, res: Response) => {
  try {
    const tenantId = req.body.tenantId ?? getTenantId(req);
    const { code } = req.body;

    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required.' });
      return;
    }
    if (!code || typeof code !== 'string') {
      res.status(400).json({ error: 'OAuth authorization code (string) is required in request body' });
      return;
    }

    // Exchange the OAuth code for a token and record the auth state
    const { default: fetch } = await import('node-fetch');
    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';

    const response = await fetch(`${workerUrl}/api/onboarding/linear`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenant_id: tenantId, code }),
    });

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, status: response.status, errorBody }, 'Worker onboarding linear task failed');
      res.status(502).json({ error: 'Failed to process Linear OAuth', detail: errorBody });
      return;
    }

    const result = await response.json() as { state: string };
    log.info({ tenantId, state: result.state }, 'Linear OAuth completed');

    res.json({ success: true, state: result.state });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to process Linear OAuth');
    res.status(500).json({ error: 'Failed to process Linear OAuth' });
  }
});

// ---------------------------------------------------------------------------
// GET /onboarding/status — Returns structured onboarding progress
// ---------------------------------------------------------------------------

/**
 * Returns the current onboarding state for a tenant.
 *
 * Query params: tenantId (optional, falls back to x-tenant-id header)
 */
router.get('/status', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      res.status(400).json({ error: 'Tenant identification required. Provide x-tenant-id header or tenantId query param.' });
      return;
    }

    // Fetch onboarding state from the worker
    const { default: fetch } = await import('node-fetch');
    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';

    const response = await fetch(`${workerUrl}/api/onboarding/status?tenant_id=${encodeURIComponent(tenantId)}`);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, status: response.status, errorBody }, 'Worker onboarding status fetch failed');
      res.status(502).json({ error: 'Failed to fetch onboarding status', detail: errorBody });
      return;
    }

    const result = await response.json() as {
      tenant_id: string;
      state: string;
      github_installed: boolean;
      linear_authed: boolean;
      repo_selected: boolean;
      completed: boolean;
      installed_repos?: number;
      created_at?: string;
      updated_at?: string;
    };

    res.json({
      tenantId: result.tenant_id,
      state: result.state,
      steps: {
        githubInstalled: result.github_installed,
        linearAuthed: result.linear_authed,
        repoSelected: result.repo_selected,
        completed: result.completed,
      },
      installedRepos: result.installed_repos ?? 0,
      createdAt: result.created_at ?? null,
      updatedAt: result.updated_at ?? null,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get onboarding status');
    res.status(500).json({ error: 'Failed to get onboarding status' });
  }
});

// ---------------------------------------------------------------------------
// GET /onboarding — Returns the full wizard state for the UI
// ---------------------------------------------------------------------------

/**
 * Returns the current onboarding state and any relevant metadata
 * for rendering the wizard UI.
 *
 * Query params: tenantId (optional, falls back to x-tenant-id header)
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const tenantId = getTenantId(req);

    if (!tenantId) {
      // In OSS mode, if no tenant is identified, return the minimal response
      if (config.stas.mode === 'oss') {
        res.json({
          wizard: 'oss',
          state: 'not_started',
          steps: {
            githubInstalled: false,
            linearAuthed: false,
            repoSelected: false,
            completed: false,
          },
          githubAppUrl: `https://github.com/apps/${config.github.appId}/installations/new`,
        });
        return;
      }
      res.status(400).json({ error: 'Tenant identification required.' });
      return;
    }

    // Fetch full onboarding status from the worker
    const { default: fetch } = await import('node-fetch');
    const workerUrl = process.env.WORKER_API_URL ?? 'http://localhost:9090';

    const response = await fetch(`${workerUrl}/api/onboarding/status?tenant_id=${encodeURIComponent(tenantId)}`);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ tenantId, status: response.status, errorBody }, 'Worker onboarding fetch failed');
      res.status(502).json({ error: 'Failed to fetch onboarding data', detail: errorBody });
      return;
    }

    const result = await response.json() as {
      tenant_id: string;
      state: string;
      github_installed: boolean;
      linear_authed: boolean;
      repo_selected: boolean;
      completed: boolean;
      installed_repos?: number;
      created_at?: string;
      updated_at?: string;
    };

    res.json({
      wizard: 'hosted',
      tenantId: result.tenant_id,
      state: result.state,
      steps: {
        githubInstalled: result.github_installed,
        linearAuthed: result.linear_authed,
        repoSelected: result.repo_selected,
        completed: result.completed,
      },
      installedRepos: result.installed_repos ?? 0,
      githubAppUrl: `https://github.com/apps/${config.github.appId}/installations/new`,
      createdAt: result.created_at ?? null,
      updatedAt: result.updated_at ?? null,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get onboarding wizard');
    res.status(500).json({ error: 'Failed to get onboarding wizard' });
  }
});

export { router as onboardingRouter };
