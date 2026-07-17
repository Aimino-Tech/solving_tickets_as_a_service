import { Router, type Request, type Response } from 'express';
import {
  isFeatureEnabled,
  enabledFor,
  setFeatureFlag,
  deleteFeatureFlag,
  listFeatureFlags,
  setAccountOverride,
  removeAccountOverride,
  recordFlagError,
  getErrorRate,
  invalidateCache,
} from '../services/featureFlags.js';
import { renderFeatureFlagMetrics } from '../featureFlags/metrics.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'feature-flags-admin' });

const router: Router = Router();


router.get('/', async (req: Request, res: Response) => {
  try {
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const flags = await listFeatureFlags(accountId);
    res.json({ flags });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to list feature flags');
    res.status(500).json({ error: 'Failed to list feature flags' });
  }
});

router.get('/metrics/prometheus', (_req: Request, res: Response) => {
  try {
    const metrics = renderFeatureFlagMetrics();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(metrics || '# feature_flag_metrics empty\n');
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to render feature flag metrics');
    res.status(500).json({ error: 'Failed to render metrics' });
  }
});

router.post('/:name/evaluate', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const { accountId } = req.body;
    const enabled = await enabledFor(name, accountId ? Number(accountId) : undefined);
    res.json({ flag: name, enabled, accountId: accountId ?? null });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to evaluate feature flag');
    res.status(500).json({ error: 'Failed to evaluate feature flag' });
  }
});

router.get('/:name', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const enabled = await isFeatureEnabled(name, accountId);
    const errorRate = await getErrorRate(name);
    res.json({ flag: name, enabled, accountId: accountId ?? null, errorRate: Number(errorRate.toFixed(4)) });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to check feature flag');
    res.status(500).json({ error: 'Failed to check feature flag' });
  }
});

router.put('/:name', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const { enabled, accountId, percentageRollout } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    const parsedAccountId = accountId ? Number(accountId) : undefined;
    const parsedPercentage = percentageRollout !== undefined ? Number(percentageRollout) : undefined;

    if (parsedPercentage !== undefined && (parsedPercentage < 0 || parsedPercentage > 100)) {
      res.status(400).json({ error: 'percentageRollout must be between 0 and 100' });
      return;
    }

    if (parsedAccountId) {
      await setAccountOverride(name, parsedAccountId, enabled);
    } else {
      await setFeatureFlag(name, enabled, undefined, parsedPercentage);
    }
    log.info({ flag: name, enabled, accountId, percentageRollout }, 'Feature flag updated via admin API');
    res.json({ flag: name, enabled, accountId: accountId ?? null, percentageRollout: parsedPercentage });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to update feature flag');
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    await deleteFeatureFlag(name, accountId);
    res.json({ deleted: true });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to delete feature flag');
    res.status(500).json({ error: 'Failed to delete feature flag' });
  }
});

router.post('/:name/record-error', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    await recordFlagError(name);
    res.json({ flag: name, recorded: true });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to record error');
    res.status(500).json({ error: 'Failed to record error' });
  }
});

router.post('/:name/override', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const { accountId, enabled } = req.body;

    if (!accountId || typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'accountId and enabled are required' });
      return;
    }

    await setAccountOverride(name, Number(accountId), enabled);
    res.json({ flag: name, accountId: Number(accountId), enabled });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to set override');
    res.status(500).json({ error: 'Failed to set override' });
  }
});

router.delete('/:name/override', async (req: Request, res: Response) => {
  try {
    const name = String(req.params.name);
    const { accountId } = req.body;

    if (!accountId) {
      res.status(400).json({ error: 'accountId is required' });
      return;
    }

    await removeAccountOverride(name, Number(accountId));
    res.json({ flag: name, accountId: Number(accountId), removed: true });
  } catch (err) {
    log.error({ err: String(err), flag: String(req.params.name) }, 'Failed to remove override');
    res.status(500).json({ error: 'Failed to remove override' });
  }
});

export { router as featureFlagsRouter };
