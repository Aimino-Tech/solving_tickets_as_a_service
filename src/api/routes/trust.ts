/**
 * Trust dashboard API routes.
 *
 * GET /api/v1/trust          — Full leaderboard + global stats
 * GET /api/v1/trust/:repo    — Single-repo metrics with derived rates
 *
 * These endpoints are public (no auth required) so the trust dashboard
 * page can load without authentication.
 */
import { Router, type Request, type Response } from 'express';
import { TrustStore } from '../../core/trust-store.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'trust-routes' });

// ---------------------------------------------------------------------------
// Singleton store — created once, lives for the server lifetime
// ---------------------------------------------------------------------------

let store: TrustStore | null = null;

function getStore(): TrustStore {
  if (!store) {
    store = new TrustStore();
  }
  return store;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router = Router();

/**
 * GET /api/v1/trust/:repo
 *
 * Returns trust metrics for a single repo, including derived rates.
 */
router.get('/:repo', async (req: Request, res: Response) => {
  try {
    const metrics = await getStore().getMetrics(req.params.repo);

    if (!metrics) {
      res.status(404).json({ error: 'Repository not found' });
      return;
    }

    const totalFixes = metrics.totalFixes;
    const acceptanceRate =
      totalFixes > 0 ? metrics.acceptedFixes / totalFixes : 0;
    const regressionRate =
      totalFixes > 0 ? metrics.regressions7d / totalFixes : 0;

    res.json({
      ...metrics,
      acceptanceRate: Math.round(acceptanceRate * 10000) / 10000,
      regressionRate: Math.round(regressionRate * 10000) / 10000,
    });
  } catch (err) {
    log.error(
      { err: String(err), repo: req.params.repo },
      'Failed to get trust metrics',
    );
    res.status(500).json({ error: 'Failed to get trust metrics' });
  }
});

/**
 * GET /api/v1/trust
 *
 * Returns the full leaderboard and global aggregate stats.
 */
router.get('/', async (_req: Request, res: Response) => {
  try {
    const repos = await getStore().getLeaderboard(100);

    const totalFixes = repos.reduce((sum, r) => sum + r.totalFixes, 0);
    const totalAccepted = repos.reduce((sum, r) => sum + r.acceptedFixes, 0);
    const totalRegressions = repos.reduce(
      (sum, r) => sum + r.regressions7d,
      0,
    );

    const acceptanceRate =
      totalFixes > 0 ? totalAccepted / totalFixes : 0;
    const avgRegressionRate =
      totalFixes > 0 ? totalRegressions / totalFixes : 0;

    res.json({
      repos,
      global: {
        acceptanceRate: Math.round(acceptanceRate * 10000) / 10000,
        avgRegressionRate:
          Math.round(avgRegressionRate * 10000) / 10000,
        totalFixes,
        totalRepos: repos.length,
      },
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to get trust leaderboard');
    res.status(500).json({ error: 'Failed to get trust leaderboard' });
  }
});

export { router as trustRouter };
