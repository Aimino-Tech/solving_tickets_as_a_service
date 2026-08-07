/**
 * PLG self-serve onboarding routes — AIM-2075 / AIM-3321.
 *
 * Provides the API surface for product-led growth onboarding flow:
 *
 *   GET   /plg/install                      — Redirect to GitHub App install (OAuth flow)
 *   GET   /plg/status                       — Get current tenant PLG status (onboarding + usage)
 *   POST  /plg/webhook/auto-config          — Auto-configure webhook for a tenant
 *   POST  /plg/welcome-issue                — Create a welcome issue in the selected repo
 *   GET   /plg/dashboard                    — Dashboard data (usage, repos, recent runs)
 *
 *   GET   /plg/workspace/:id/status         — Workspace status (AIM-3321)
 *   POST  /plg/workspace/setup              — Auto-configuration: Slack bot token + workspace setup
 *
 * The back-end Celery tasks live in workers/billing/plg.py.
 *
 * ── Design Philosophy ─────────────────────────────────────────────────────────
 * - GitHub App install is the primary onboarding action (single-click).
 * - Webhook config is auto-detected and self-healing (no manual setup).
 * - The welcome issue is a "try me" issue that walks the user through the flow.
 * - The dashboard surface is minimal — usage count + connected repos + first fix
 *   guidance. Full analytics is in the premium dashboard.
 * - Workspace setup integrates Slack bot token exchange for zero-friction
 *   onboarding (AIM-3321).
 * ──────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { logAdminAction } from '../audit/service.js';
import { findWorkspacePlan } from '../pricing/workspace.js';

const log = rootLogger.child({ module: 'plg-onboarding' });

// ---------------------------------------------------------------------------
// Rate Limiting: 20 requests per minute for PLG onboarding endpoints
// ---------------------------------------------------------------------------

const router: Router = Router();


// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getTenantId(req: Request): string | undefined {
  const headerId = req.headers['x-tenant-id'] as string | undefined;
  if (headerId) return headerId;
  const queryId = req.query.tenantId as string | undefined;
  if (queryId) return queryId;
  if (config.syntaro.mode === 'oss') return 'default';
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
  return `https://github.com/apps/${config.github.appName}/installations/new`;
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
    return { action: 'install_github_app', label: 'Install SYNTARO GitHub App', url: buildInstallUrl() };
  }
  if (!status.repo_selected) {
    return { action: 'select_repos', label: 'Select repositories to monitor' };
  }
  if (!status.completed) {
    return { action: 'complete_onboarding', label: 'Complete onboarding setup' };
  }
  if (!status.first_fix_completed) {
    return { action: 'create_first_issue', label: 'Label an issue with syntaro:fix to get your first fix' };
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
      message: `Welcome issue #${result.issue_number} created! Label it with \`${config.syntaro.label}\` to see SYNTARO in action.`,
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

// ===========================================================================
// AIM-3321: Viktor-Inspired Distribution — Workspace integration
// ===========================================================================

// ---------------------------------------------------------------------------
// GET /plg/workspace/:id/status — Workspace status
// ---------------------------------------------------------------------------
// Queries the workspace store for a given workspace ID and returns status,
// plan info, lifecycle progress, and associated Slack/GitHub identifiers.
//
// Response includes the workspace plan details from the pricing module.

router.get('/workspace/:id/status', async (req: Request, res: Response) => {
  try {
    const workspaceId = req.params.id;

    // Forward to the workspace API's status endpoint
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const response = await fetch(
      `${baseUrl}/api/workspace/${encodeURIComponent(workspaceId)}/status`,
      {
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      },
    );

    if (!response.ok) {
      if (response.status === 404) {
        res.status(404).json({ error: 'Workspace not found' });
        return;
      }
      const errorBody = await response.text().catch(() => 'unknown');
      log.error({ workspaceId, status: response.status, errorBody }, 'Workspace status fetch failed');
      res.status(502).json({ error: 'Failed to fetch workspace status', detail: errorBody });
      return;
    }

    const result = await response.json();
    res.json(result);
  } catch (err) {
    log.error({ err: String(err), workspaceId: req.params.id }, 'Failed to get workspace status');
    res.status(500).json({ error: 'Failed to get workspace status' });
  }
});

// ---------------------------------------------------------------------------
// POST /plg/workspace/setup — Auto-configuration with Slack bot token exchange
// ---------------------------------------------------------------------------
// This is the key Viktor-inspired endpoint: a single POST that:
//   1. Accepts a Slack bot token (from Slack OAuth flow)
//   2. Creates or updates the workspace
//   3. Configures Slack event subscriptions
//   4. Provisions RabbitMQ queues and database schema
//   5. Returns workspace status

router.post('/workspace/setup', async (req: Request, res: Response) => {
  try {
    const {
      workspaceName,
      tenantId,
      planId,
      seats,
      slackBotToken,
      slackTeamId,
      slackChannel,
      gitHubInstallationId,
    } = req.body as {
      workspaceName?: string;
      tenantId?: string;
      planId?: string;
      seats?: number;
      slackBotToken?: string;
      slackTeamId?: string;
      slackChannel?: string;
      gitHubInstallationId?: number;
    };

    // -- Validation ----------------------------------------------------------

    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      res.status(400).json({ error: 'tenantId is required' });
      return;
    }

    const effectivePlanId = planId ?? 'free';
    const validPlans = ['free', 'solo', 'team', 'enterprise'];
    if (!validPlans.includes(effectivePlanId)) {
      res.status(400).json({
        error: 'Invalid plan ID. Must be one of: free, solo, team, enterprise',
      });
      return;
    }

    const effectiveSeats = Math.max(1, Math.floor(Number(seats) || 1));
    const name = workspaceName?.trim() ?? `Workspace-${tenantId.trim().slice(0, 8)}`;

    // -- Create workspace via internal API -----------------------------------

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const createResponse = await fetch(`${baseUrl}/api/workspace`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        tenantId: tenantId.trim(),
        planId: effectivePlanId,
        seats: effectiveSeats,
        slackTeamId: slackTeamId?.trim(),
        gitHubInstallationId,
      }),
    });

    if (!createResponse.ok) {
      const errorBody = await createResponse.text().catch(() => 'unknown');
      log.error({ tenantId, planId: effectivePlanId, status: createResponse.status, errorBody }, 'Workspace creation failed');
      res.status(502).json({ error: 'Failed to create workspace', detail: errorBody });
      return;
    }

    const created = await createResponse.json() as { id: string };

    // -- Trigger setup with Slack bot token -----------------------------------

    const setupResponse = await fetch(`${baseUrl}/api/workspace/${created.id}/setup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        slackBotToken,
        slackChannel: slackChannel?.trim(),
      }),
    });

    if (!setupResponse.ok) {
      const errorBody = await setupResponse.text().catch(() => 'unknown');
      log.error({ workspaceId: created.id, status: setupResponse.status, errorBody }, 'Workspace setup trigger failed');
      res.status(502).json({ error: 'Workspace created but setup failed', detail: errorBody });
      return;
    }

    const setupResult = await setupResponse.json();

    // -- Audit log -----------------------------------------------------------

    await logAdminAction({
      adminId: 'system',
      action: 'plg.workspace_setup',
      resourceType: 'workspace',
      resourceId: created.id,
      details: {
        tenantId: tenantId.trim(),
        planId: effectivePlanId,
        seats: effectiveSeats,
        hasSlackBotToken: !!slackBotToken,
        slackTeamId,
      },
    }).catch(() => {});

    // -- Respond -------------------------------------------------------------

    const plan = findWorkspacePlan(effectivePlanId);

    res.status(201).json({
      workspaceId: created.id,
      name,
      planId: effectivePlanId,
      planName: plan?.name ?? 'Unknown',
      seats: effectiveSeats,
      status: 'setup',
      provisioningStatus: 'in_progress',
      slackBotConfigured: !!slackBotToken,
      slackTeamId: slackTeamId ?? null,
      slackChannel: slackChannel ?? null,
      message: 'Workspace created and setup initiated. Slack bot will be ready shortly.',
      nextSteps: [
        'Configure Slack event subscriptions for app_mention',
        'Install the SYNTARO GitHub App in your repos',
        'Label an issue with syntaro:fix to trigger your first automated fix',
      ],
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to set up workspace via PLG');
    res.status(500).json({ error: 'Failed to set up workspace' });
  }
});

export { router as plgRouter };
