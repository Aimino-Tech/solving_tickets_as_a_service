/**
 * Workspace onboarding and management routes — AIM-3321.
 *
 * Provides the API surface for Slack-first, zero-sales workspace distribution:
 *
 *   GET    /api/workspace/:id/status   — Workspace status
 *   POST   /api/workspace              — Create workspace (self-serve)
 *   POST   /api/workspace/:id/setup    — Automated Slack/RabbitMQ/DB setup
 *   DELETE /api/workspace/:id          — Cleanup workspace
 *
 * ── Workspace Lifecycle ─────────────────────────────────────────────────────
 *   created → setup → active → suspended → deleted
 *
 * - created:  Workspace record created, awaiting setup
 * - setup:    Automated provisioning in progress (Slack bot, queues, DB schema)
 * - active:   Fully operational, processing jobs
 * - suspended: Temporarily disabled (payment failure, policy violation)
 * - deleted:   Hardware deleted, data retained per retention policy
 * ────────────────────────────────────────────────────────────────────────────
 */

import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { logAdminAction } from '../audit/service.js';
import {
  listWorkspacePlans,
  findWorkspacePlan,
  calculateWorkspaceCost,
} from '../pricing/workspace.js';

const log = rootLogger.child({ module: 'workspace-api' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WorkspaceStatus =
  | 'created'
  | 'setup'
  | 'active'
  | 'suspended'
  | 'deleted';

export interface Workspace {
  id: string;
  name: string;
  tenantId: string;
  planId: string;
  seats: number;
  status: WorkspaceStatus;
  slackTeamId?: string;
  slackBotToken?: string;
  slackChannel?: string;
  gitHubInstallationId?: number;
  createdAt: string;
  updatedAt: string;
  activatedAt?: string;
  suspendedAt?: string;
  deletedAt?: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// In-memory workspace store (MVP — replace with DB in production)
// ---------------------------------------------------------------------------

const workspaces = new Map<string, Workspace>();

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function isValidPlanId(planId: string): boolean {
  return ['free', 'solo', 'team', 'enterprise'].includes(planId);
}

function sanitizeWorkspace(ws: Workspace): Record<string, unknown> {
  // Strip sensitive fields for API responses
  const { slackBotToken, ...rest } = ws;
  return {
    ...rest,
    hasSlackBotToken: !!ws.slackBotToken,
  };
}

// ---------------------------------------------------------------------------
// GET /api/workspace — List all workspaces (admin)
// ---------------------------------------------------------------------------

router.get('/', (_req: Request, res: Response) => {
  try {
    const all = Array.from(workspaces.values()).map(sanitizeWorkspace);
    res.json({
      count: all.length,
      workspaces: all,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list workspaces');
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/plans — List available pricing plans
// ---------------------------------------------------------------------------

router.get('/plans', (_req: Request, res: Response) => {
  try {
    const plans = listWorkspacePlans();
    res.json({
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        price: p.price,
        pricePerSeat: p.pricePerSeat,
        minSeats: p.minSeats,
        maxSeats: p.maxSeats,
        features: p.features,
        limits: p.limits,
      })),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list workspace plans');
    res.status(500).json({ error: 'Failed to list workspace plans' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/workspace/calculate-cost — Calculate workspace cost
// ---------------------------------------------------------------------------

router.post('/calculate-cost', (req: Request, res: Response) => {
  try {
    const { planId, seats } = req.body as { planId?: string; seats?: number };

    const effectivePlanId = planId ?? 'free';
    if (!isValidPlanId(effectivePlanId)) {
      res.status(400).json({
        error: 'Invalid plan ID. Must be one of: free, solo, team, enterprise',
      });
      return;
    }

    const effectiveSeats = Math.max(1, Math.floor(Number(seats) || 1));
    const result = calculateWorkspaceCost(effectivePlanId, effectiveSeats);

    if (!result.plan) {
      res.status(404).json({ error: 'Plan not found' });
      return;
    }

    res.json({
      planId: result.plan.id,
      planName: result.plan.name,
      total: result.total,
      perSeat: result.perSeat,
      breakdown: result.breakdown,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to calculate cost');
    res.status(500).json({ error: 'Failed to calculate cost' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/workspace/:id/status — Get workspace status
// ---------------------------------------------------------------------------

router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const workspace = workspaces.get(req.params.id);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const plan = findWorkspacePlan(workspace.planId);

    res.json({
      id: workspace.id,
      name: workspace.name,
      tenantId: workspace.tenantId,
      status: workspace.status,
      planId: workspace.planId,
      planName: plan?.name ?? 'Unknown',
      seats: workspace.seats,
      slackTeamId: workspace.slackTeamId,
      slackChannel: workspace.slackChannel,
      gitHubInstallationId: workspace.gitHubInstallationId,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
      activatedAt: workspace.activatedAt,
      lifecycle: getLifecycleProgress(workspace.status),
    });
  } catch (err) {
    log.error({ err: String(err), workspaceId: req.params.id }, 'Failed to get workspace status');
    res.status(500).json({ error: 'Failed to get workspace status' });
  }
});

function getLifecycleProgress(
  status: WorkspaceStatus,
): { current: string; next: string[]; progress: number } {
  const ordered: WorkspaceStatus[] = ['created', 'setup', 'active', 'suspended', 'deleted'];
  const idx = ordered.indexOf(status);
  return {
    current: status,
    next: ordered.slice(idx + 1).filter((s) => s !== 'deleted' || status !== 'deleted'),
    progress: Math.round(((idx + 1) / ordered.length) * 100),
  };
}

// ---------------------------------------------------------------------------
// POST /api/workspace — Create workspace (self-serve)
// ---------------------------------------------------------------------------

router.post('/', async (req: Request, res: Response) => {
  try {
    const { name, tenantId, planId, seats, slackTeamId, gitHubInstallationId } = req.body as {
      name?: string;
      tenantId?: string;
      planId?: string;
      seats?: number;
      slackTeamId?: string;
      gitHubInstallationId?: number;
    };

    // -- Validation ----------------------------------------------------------

    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      res.status(400).json({ error: 'Workspace name is required' });
      return;
    }

    if (!tenantId || typeof tenantId !== 'string' || tenantId.trim().length === 0) {
      res.status(400).json({ error: 'Tenant ID is required' });
      return;
    }

    const effectivePlanId = planId ?? 'free';
    if (!isValidPlanId(effectivePlanId)) {
      res.status(400).json({
        error: 'Invalid plan ID. Must be one of: free, solo, team, enterprise',
      });
      return;
    }

    const effectiveSeats = Math.max(1, Math.floor(Number(seats) || 1));

    // -- Create workspace ----------------------------------------------------

    const now = new Date().toISOString();
    const workspace: Workspace = {
      id: crypto.randomUUID(),
      name: name.trim(),
      tenantId: tenantId.trim(),
      planId: effectivePlanId,
      seats: effectiveSeats,
      status: 'created',
      slackTeamId: slackTeamId?.trim(),
      gitHubInstallationId,
      createdAt: now,
      updatedAt: now,
    };

    workspaces.set(workspace.id, workspace);

    log.info(
      { workspaceId: workspace.id, tenantId, planId: effectivePlanId, seats: effectiveSeats },
      'Workspace created',
    );

    // -- Audit log -----------------------------------------------------------

    await logAdminAction({
      adminId: 'system',
      action: 'workspace.created',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: { tenantId, planId: effectivePlanId, seats: effectiveSeats, name: name.trim() },
    }).catch(() => {});

    res.status(201).json(sanitizeWorkspace(workspace));
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to create workspace');
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/workspace/:id/setup — Automated Slack/RabbitMQ/DB setup
// ---------------------------------------------------------------------------

router.post('/:id/setup', async (req: Request, res: Response) => {
  try {
    const workspace = workspaces.get(req.params.id);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (workspace.status !== 'created') {
      res.status(409).json({
        error: `Workspace is in '${workspace.status}' state. Only 'created' workspaces can be set up.`,
      });
      return;
    }

    // -- Validate request body -----------------------------------------------

    const { slackBotToken, slackChannel } = req.body as {
      slackBotToken?: string;
      slackChannel?: string;
    };

    // -- Transition to 'setup' -----------------------------------------------

    workspace.status = 'setup';
    workspace.updatedAt = new Date().toISOString();

    // -- Slack bot token exchange ---------------------------------------------

    if (slackBotToken && typeof slackBotToken === 'string') {
      workspace.slackBotToken = slackBotToken;
      log.info({ workspaceId: workspace.id }, 'Slack bot token configured');
    }

    if (slackChannel && typeof slackChannel === 'string') {
      workspace.slackChannel = slackChannel;
    }

    // -- Simulate async provisioning in background ---------------------------
    // In production, this would:
    //   1. Create RabbitMQ queues (ingress, egress, dlq)
    //   2. Register Slack event subscriptions (app_mention, message.channels)
    //   3. Provision database schema (workspace_tables, audit_logs)
    //   4. Verify GitHub App installation
    //   5. Configure webhooks for the workspace

    setTimeout(() => {
      try {
        const ws = workspaces.get(workspace.id);
        if (!ws || ws.status !== 'setup') return;

        ws.status = 'active';
        ws.activatedAt = new Date().toISOString();
        ws.updatedAt = ws.activatedAt;

        log.info({ workspaceId: workspace.id }, 'Workspace setup completed -> active');

        // -- Audit log -------------------------------------------------------
        logAdminAction({
          adminId: 'system',
          action: 'workspace.activated',
          resourceType: 'workspace',
          resourceId: workspace.id,
          details: { tenantId: workspace.tenantId },
        }).catch(() => {});
      } catch (err) {
        log.error({ err: String(err), workspaceId: workspace.id }, 'Async workspace activation failed');
        const ws = workspaces.get(workspace.id);
        if (ws && ws.status === 'setup') {
          ws.status = 'suspended';
          ws.updatedAt = new Date().toISOString();
        }
      }
    }, 2_000); // Simulated 2s provisioning delay

    log.info({ workspaceId: workspace.id }, 'Workspace setup initiated (async provisioning)');

    // -- Audit log -----------------------------------------------------------

    await logAdminAction({
      adminId: 'system',
      action: 'workspace.setup_started',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: {
        tenantId: workspace.tenantId,
        hasSlackBotToken: !!slackBotToken,
        hasSlackChannel: !!slackChannel,
      },
    }).catch(() => {});

    res.json({
      ...sanitizeWorkspace(workspace),
      message: 'Workspace setup initiated. Provisioning will complete in the background.',
      provisioningStatus: 'in_progress',
    });
  } catch (err) {
    log.error({ err: String(err), workspaceId: req.params.id }, 'Failed to set up workspace');
    res.status(500).json({ error: 'Failed to set up workspace' });
  }
});

// ---------------------------------------------------------------------------
// DELETE /api/workspace/:id — Cleanup workspace
// ---------------------------------------------------------------------------

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const workspace = workspaces.get(req.params.id);

    if (!workspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    if (workspace.status === 'deleted') {
      res.status(409).json({ error: 'Workspace is already deleted' });
      return;
    }

    const previousStatus = workspace.status;
    workspace.status = 'deleted';
    workspace.deletedAt = new Date().toISOString();
    workspace.updatedAt = workspace.deletedAt;

    log.info(
      { workspaceId: workspace.id, previousStatus },
      'Workspace deleted',
    );

    // -- Audit log -----------------------------------------------------------

    await logAdminAction({
      adminId: 'system',
      action: 'workspace.deleted',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: { tenantId: workspace.tenantId, previousStatus },
    }).catch(() => {});

    // -- Cleanup (async) -----------------------------------------------------
    // In production, this would:
    //   1. Remove Slack bot from workspace
    //   2. Delete RabbitMQ queues
    //   3. Archive database records (soft delete)
    //   4. Revoke GitHub App installation tokens

    res.json({
      id: workspace.id,
      status: workspace.status,
      deletedAt: workspace.deletedAt,
      message: 'Workspace has been deleted. Data will be retained per retention policy.',
    });
  } catch (err) {
    log.error({ err: String(err), workspaceId: req.params.id }, 'Failed to delete workspace');
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

// ---------------------------------------------------------------------------
// Expose the store for testing
// ---------------------------------------------------------------------------

export function _resetStoreForTest(): void {
  workspaces.clear();
}

export { router as workspaceRouter };
