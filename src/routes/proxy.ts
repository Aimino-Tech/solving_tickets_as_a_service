/**
 * STAS Proxy Management Routes — AIM-3191.
 *
 * Provides the API surface for proxy management:
 *
 *   GET    /api/v1/proxy/status            — Proxy module status & health
 *   GET    /api/v1/proxy/model/config       — Current model router configuration
 *   PUT    /api/v1/proxy/model/config       — Update model router configuration
 *   POST   /api/v1/proxy/model/select       — Select a model for a given task
 *   GET    /api/v1/proxy/dispatch/status    — GitHub Actions dispatch status
 *   POST   /api/v1/proxy/dispatch/trigger   — Trigger a workflow dispatch
 *
 * ── Authentication ───────────────────────────────────────────────────────────
 * All endpoints require the ADMIN_API_KEY as a Bearer token in the
 * Authorization header, matching the existing admin auth pattern.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { rootLogger } from '../utils/logger.js';
import { adminAuthMiddleware } from '../security/adminAuth.js';
import { proxy } from '../proxy/index.js';

const log = rootLogger.child({ module: 'proxy-routes' });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

// ── GET /api/v1/proxy/status ───────────────────────────────────────────────

/**
 * Get the overall proxy module status.
 */
router.get('/status', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    res.json({
      initialized: proxy.initialized,
      meta: proxy.meta,
      dispatchStatus: proxy.githubActionsDispatcher.getStatus(),
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get proxy status');
    res.status(500).json({ error: 'Failed to get proxy status' });
  }
});

// ── GET /api/v1/proxy/model/config ─────────────────────────────────────────

/**
 * Get the current model router configuration.
 */
router.get('/model/config', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const registry = proxy.modelRouter.getRegistry();
    res.json({
      enabled: config.proxy.modelRouterEnabled,
      defaultModel: config.opencode.model,
      fallbackModels: config.opencode.fallbackModels,
      registry,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get model config');
    res.status(500).json({ error: 'Failed to get model config' });
  }
});

// ── PUT /api/v1/proxy/model/config ─────────────────────────────────────────

/**
 * Update the model router configuration.
 *
 * Body (partial):
 *   {
 *     "complexity": "fix",
 *     "tier": "pro",
 *     "models": [
 *       { "id": "gpt-4o", "name": "GPT-4o", "available": true, ... }
 *     ],
 *     "modelAvailability": { "modelId": "gpt-4o", "available": false }
 *   }
 */
router.put('/model/config', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { complexity, tier, models, modelAvailability } = req.body as {
      complexity?: import('../proxy/modelRouter.js').TaskComplexity;
      tier?: import('../proxy/modelRouter.js').AccountTier;
      models?: import('../proxy/modelRouter.js').ModelOption[];
      modelAvailability?: { modelId: string; available: boolean };
    };

    if (complexity && tier && models) {
      const validComplexities = ['triage', 'fix', 'review'];
      const validTiers = ['free', 'pro', 'enterprise'];

      if (!validComplexities.includes(complexity) || !validTiers.includes(tier ?? '')) {
        res.status(400).json({
          error: `Invalid complexity or tier. Complexity must be one of: ${validComplexities.join(', ')}. Tier must be one of: ${validTiers.join(', ')}`,
        });
        return;
      }

      proxy.modelRouter.setModels(complexity, tier!, models);
      log.info({ complexity, tier, modelCount: models.length }, 'Model registry updated via API');
    }

    if (modelAvailability) {
      proxy.modelRouter.setModelAvailability(modelAvailability.modelId, modelAvailability.available);
      log.info(
        { modelId: modelAvailability.modelId, available: modelAvailability.available },
        'Model availability updated via API',
      );
    }

    if (!complexity && !modelAvailability) {
      res.status(400).json({ error: 'Provide complexity+tier+models or modelAvailability to update' });
      return;
    }

    // Return the updated config
    const registry = proxy.modelRouter.getRegistry();
    res.json({
      updated: true,
      registry,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to update model config');
    res.status(500).json({ error: 'Failed to update model config' });
  }
});

// ── POST /api/v1/proxy/model/select ────────────────────────────────────────

/**
 * Select a model for a given task.
 *
 * Body:
 *   {
 *     "complexity": "fix",
 *     "accountTier": "pro",
 *     "preferredModel": "gpt-4o"
 *   }
 */
router.post('/model/select', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { complexity, accountTier, preferredModel, skipAvailabilityCheck } = req.body as {
      complexity?: string;
      accountTier?: string;
      preferredModel?: string;
      skipAvailabilityCheck?: boolean;
    };

    if (!complexity || !['triage', 'fix', 'review'].includes(complexity)) {
      res.status(400).json({ error: 'complexity must be one of: triage, fix, review' });
      return;
    }

    const result = await proxy.modelRouter.selectModel({
      complexity: complexity as import('../proxy/modelRouter.js').TaskComplexity,
      accountTier: (accountTier as import('../proxy/modelRouter.js').AccountTier) ?? 'free',
      preferredModel,
      skipAvailabilityCheck,
    });

    res.json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to select model');
    res.status(500).json({ error: 'Failed to select model' });
  }
});

// ── GET /api/v1/proxy/dispatch/status ──────────────────────────────────────

/**
 * Get the current GitHub Actions dispatch status.
 */
router.get('/dispatch/status', adminAuthMiddleware, async (_req: Request, res: Response) => {
  try {
    const status = proxy.githubActionsDispatcher.getStatus();
    res.json(status);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get dispatch status');
    res.status(500).json({ error: 'Failed to get dispatch status' });
  }
});

// ── POST /api/v1/proxy/dispatch/trigger ────────────────────────────────────

/**
 * Trigger a GitHub Actions workflow dispatch.
 *
 * Body:
 *   {
 *     "owner": "myorg",
 *     "repo": "myrepo",
 *     "workflowId": "ci.yml",
 *     "ref": "main",
 *     "inputs": { "issue_number": "42" }
 *   }
 */
router.post('/dispatch/trigger', adminAuthMiddleware, async (req: Request, res: Response) => {
  try {
    const { owner, repo, workflowId, ref, inputs } = req.body as {
      owner?: string;
      repo?: string;
      workflowId?: string;
      ref?: string;
      inputs?: Record<string, string>;
    };

    if (!owner || !repo || !workflowId || !ref) {
      res.status(400).json({
        error: 'Missing required fields: owner, repo, workflowId, ref',
      });
      return;
    }

    const result = await proxy.githubActionsDispatcher.dispatchWorkflow({
      owner,
      repo,
      workflowId,
      ref,
      inputs,
    });

    const httpStatus = result.success ? 200 : result.statusCode >= 400 && result.statusCode <= 599 ? result.statusCode : 502;
    res.status(httpStatus).json(result);
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to trigger workflow dispatch');
    res.status(500).json({ error: 'Failed to trigger workflow dispatch' });
  }
});

export { router as proxyRouter };
