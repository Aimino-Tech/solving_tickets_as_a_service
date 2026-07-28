import { Router, type Request, type Response } from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getAggregatedUsage } from '../litellm/client.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'litellm-usage-routes' });
const router: Router = Router();

router.get('/litellm/usage', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = String(req.user!.id);
    const usage = await getAggregatedUsage(userId);
    if (!usage) {
      res.json({
        configured: false,
        message: 'LiteLLM is not configured or unavailable',
        budget: null,
        todayTokens: { input: 0, output: 0, total: 0 },
        thisMonthTokens: { input: 0, output: 0, total: 0 },
        rateLimit: null,
      });
      return;
    }
    res.json({
      configured: true,
      ...usage,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get LiteLLM usage');
    res.json({
      configured: false,
      message: 'Failed to fetch LiteLLM usage data',
      budget: null,
      todayTokens: { input: 0, output: 0, total: 0 },
      thisMonthTokens: { input: 0, output: 0, total: 0 },
      rateLimit: null,
    });
  }
});

export { router as litellmUsageRouter };
