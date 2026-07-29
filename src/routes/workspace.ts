import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { logAdminAction } from '../audit/service.js';
import { workspaceRepository } from '../db/repositories/index.js';
import type { Workspace as DbWorkspace } from '../db/types/index.js';
import {
  listWorkspacePlans,
  findWorkspacePlan,
  calculateWorkspaceCost,
} from '../pricing/workspace.js';

const log = rootLogger.child({ module: 'workspace-api' });

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

const router: Router = Router();

function isValidPlanId(planId: string): boolean {
  return ['free', 'solo', 'team', 'enterprise'].includes(planId);
}

function dbToWorkspace(ws: DbWorkspace): Workspace {
  return {
    id: ws.id,
    name: ws.name,
    tenantId: ws.tenantId,
    planId: ws.planId,
    seats: ws.seats,
    status: ws.status as WorkspaceStatus,
    slackTeamId: ws.slackTeamId ?? undefined,
    slackBotToken: ws.slackBotToken ?? undefined,
    slackChannel: ws.slackChannel ?? undefined,
    gitHubInstallationId: ws.githubInstallationId ?? undefined,
    createdAt: ws.createdAt instanceof Date ? ws.createdAt.toISOString() : String(ws.createdAt),
    updatedAt: ws.updatedAt instanceof Date ? ws.updatedAt.toISOString() : String(ws.updatedAt),
    activatedAt: ws.activatedAt instanceof Date ? ws.activatedAt.toISOString() : ws.activatedAt ?? undefined,
    suspendedAt: ws.suspendedAt instanceof Date ? ws.suspendedAt.toISOString() : ws.suspendedAt ?? undefined,
    deletedAt: ws.deletedAt instanceof Date ? ws.deletedAt.toISOString() : ws.deletedAt ?? undefined,
    metadata: ws.metadata ?? undefined,
  };
}

function sanitizeWorkspace(ws: Workspace): Record<string, unknown> {
  const { slackBotToken, ...rest } = ws;
  return {
    ...rest,
    hasSlackBotToken: !!ws.slackBotToken,
  };
}

router.get('/', async (_req: Request, res: Response) => {
  try {
    const all = await workspaceRepository.list();
    const result = all.map((ws) => sanitizeWorkspace(dbToWorkspace(ws)));
    res.json({
      count: result.length,
      workspaces: result,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list workspaces');
    res.status(500).json({ error: 'Failed to list workspaces' });
  }
});

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

router.get('/:id/status', async (req: Request, res: Response) => {
  try {
    const dbWorkspace = await workspaceRepository.findById(req.params.id);

    if (!dbWorkspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspace = dbToWorkspace(dbWorkspace);
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

    const dbWorkspace = await workspaceRepository.create({
      name: name.trim(),
      tenantId: tenantId.trim(),
      planId: effectivePlanId,
      seats: effectiveSeats,
      status: 'created',
      slackTeamId: slackTeamId?.trim() ?? null,
      githubInstallationId: gitHubInstallationId ?? null,
    });

    const workspace = dbToWorkspace(dbWorkspace);

    log.info(
      { workspaceId: workspace.id, tenantId, planId: effectivePlanId, seats: effectiveSeats },
      'Workspace created',
    );

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

router.post('/:id/setup', async (req: Request, res: Response) => {
  try {
    const dbWorkspace = await workspaceRepository.findById(req.params.id);

    if (!dbWorkspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspace = dbToWorkspace(dbWorkspace);

    if (workspace.status !== 'created') {
      res.status(409).json({
        error: `Workspace is in '${workspace.status}' state. Only 'created' workspaces can be set up.`,
      });
      return;
    }

    const { slackBotToken, slackChannel } = req.body as {
      slackBotToken?: string;
      slackChannel?: string;
    };

    const updateData: Record<string, unknown> = {
      status: 'setup',
    };

    if (slackBotToken && typeof slackBotToken === 'string') {
      updateData.slackBotToken = slackBotToken;
      log.info({ workspaceId: workspace.id }, 'Slack bot token configured');
    }

    if (slackChannel && typeof slackChannel === 'string') {
      updateData.slackChannel = slackChannel;
    }

    await workspaceRepository.update(workspace.id, updateData as Parameters<typeof workspaceRepository.update>[1]);

    setTimeout(async () => {
      try {
        const current = await workspaceRepository.findById(workspace.id);
        if (!current || current.status !== 'setup') return;

        await workspaceRepository.update(workspace.id, {
          status: 'active',
          activatedAt: new Date(),
        });

        log.info({ workspaceId: workspace.id }, 'Workspace setup completed -> active');

        logAdminAction({
          adminId: 'system',
          action: 'workspace.activated',
          resourceType: 'workspace',
          resourceId: workspace.id,
          details: { tenantId: workspace.tenantId },
        }).catch(() => {});
      } catch (err) {
        log.error({ err: String(err), workspaceId: workspace.id }, 'Async workspace activation failed');
        const current = await workspaceRepository.findById(workspace.id).catch(() => null);
        if (current && current.status === 'setup') {
          await workspaceRepository.update(workspace.id, {
            status: 'suspended',
            suspendedAt: new Date(),
          }).catch(() => {});
        }
      }
    }, 2_000);

    log.info({ workspaceId: workspace.id }, 'Workspace setup initiated (async provisioning)');

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

    const updatedDb = await workspaceRepository.findById(workspace.id);
    const updatedWs = updatedDb ? dbToWorkspace(updatedDb) : workspace;

    res.json({
      ...sanitizeWorkspace(updatedWs),
      message: 'Workspace setup initiated. Provisioning will complete in the background.',
      provisioningStatus: 'in_progress',
    });
  } catch (err) {
    log.error({ err: String(err), workspaceId: req.params.id }, 'Failed to set up workspace');
    res.status(500).json({ error: 'Failed to set up workspace' });
  }
});

router.delete('/:id', async (req: Request, res: Response) => {
  try {
    const dbWorkspace = await workspaceRepository.findById(req.params.id);

    if (!dbWorkspace) {
      res.status(404).json({ error: 'Workspace not found' });
      return;
    }

    const workspace = dbToWorkspace(dbWorkspace);

    if (workspace.status === 'deleted') {
      res.status(409).json({ error: 'Workspace is already deleted' });
      return;
    }

    const previousStatus = workspace.status;
    await workspaceRepository.softDelete(workspace.id);

    log.info(
      { workspaceId: workspace.id, previousStatus },
      'Workspace deleted',
    );

    await logAdminAction({
      adminId: 'system',
      action: 'workspace.deleted',
      resourceType: 'workspace',
      resourceId: workspace.id,
      details: { tenantId: workspace.tenantId, previousStatus },
    }).catch(() => {});

    res.json({
      id: workspace.id,
      status: 'deleted',
      deletedAt: new Date().toISOString(),
      message: 'Workspace has been deleted. Data will be retained per retention policy.',
    });
  } catch (err) {
    log.error({ err: String(err), workspaceId: req.params.id }, 'Failed to delete workspace');
    res.status(500).json({ error: 'Failed to delete workspace' });
  }
});

export async function _resetStoreForTest(): Promise<void> {
  const all = await workspaceRepository.list();
  for (const ws of all) {
    await workspaceRepository.deletePermanent(ws.id);
  }
}

export { router as workspaceRouter };
