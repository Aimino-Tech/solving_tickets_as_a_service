import { Router, type Request, type Response } from 'express';
import { isFeatureEnabled, setFeatureFlag, deleteFeatureFlag, listFeatureFlags } from '../services/featureFlags.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'feature-flags-admin' });

const router = Router();

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

router.put('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const { enabled, accountId } = req.body;

    if (typeof enabled !== 'boolean') {
      res.status(400).json({ error: 'enabled must be a boolean' });
      return;
    }

    await setFeatureFlag(name, enabled, accountId ? Number(accountId) : undefined);
    log.info({ flag: name, enabled, accountId }, 'Feature flag updated via admin API');
    res.json({ flag: name, enabled, accountId: accountId ?? null });
  } catch (err) {
    log.error({ err: String(err), flag: req.params.name }, 'Failed to update feature flag');
    res.status(500).json({ error: 'Failed to update feature flag' });
  }
});

router.delete('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    await deleteFeatureFlag(name, accountId);
    log.info({ flag: name, accountId }, 'Feature flag deleted via admin API');
    res.json({ deleted: true });
  } catch (err) {
    log.error({ err: String(err), flag: req.params.name }, 'Failed to delete feature flag');
    res.status(500).json({ error: 'Failed to delete feature flag' });
  }
});

router.get('/:name', async (req: Request, res: Response) => {
  try {
    const { name } = req.params;
    const accountId = req.query.accountId ? Number(req.query.accountId) : undefined;
    const enabled = await isFeatureEnabled(name, accountId);
    res.json({ flag: name, enabled, accountId: accountId ?? null });
  } catch (err) {
    log.error({ err: String(err), flag: req.params.name }, 'Failed to check feature flag');
    res.status(500).json({ error: 'Failed to check feature flag' });
  }
});

export { router as featureFlagsRouter };
