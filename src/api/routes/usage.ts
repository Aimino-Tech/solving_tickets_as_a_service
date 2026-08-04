/**
 * Usage API routes.
 *
 * GET /api/v1/usage         — Current usage for the authenticated user
 * GET /api/v1/usage/:repo   — Usage for a specific repo
 *
 * These endpoints expose the current usage state so users can monitor
 * their consumption and plan upgrades.
 */

import { Router, type Request, type Response } from 'express';
import { UsageTracker } from '../../core/usage-tracker.js';
import { rootLogger } from '../../utils/logger.js';

const log = rootLogger.child({ module: 'usage-api' });

// ---------------------------------------------------------------------------
// Singleton tracker
// ---------------------------------------------------------------------------

let tracker: UsageTracker | null = null;

function getTracker(): UsageTracker {
  if (!tracker) {
    tracker = new UsageTracker();
  }
  return tracker;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the userId from the request context.
 * Falls back to IP if no auth is present (public access).
 */
function resolveUserId(req: Request): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqAny = req as any;
  const userId: string | undefined =
    reqAny.userId ?? reqAny.githubUserId ?? req.headers['x-syntaro-user-id'] as string | undefined;
  return userId ?? req.ip ?? 'anonymous';
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

const router: Router = Router();

/**
 * GET /api/v1/usage
 *
 * Returns the current usage summary for the authenticated user across
 * all repositories.
 */
router.get('/', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);

    // For user-level usage, we iterate all known repos.
    // In a production deployment with a DB-backed store this would
    // aggregate across a subscription. For the self-hosted model we
    // return the per-repo usage of the repos the user has interacted with.
    const t = getTracker();
    const userUsage = t.getUserUsage(userId);

    // Build a summary across all repos
    const totalCurrentMonth = userUsage.length > 0 ? userUsage[0]!.fixCount : 0;
    const plan = process.env.SYNTARO_DEFAULT_TIER ?? 'cloud-free';

    res.json({
      userId,
      plan,
      currentMonthUsage: totalCurrentMonth,
      recentMonths: userUsage.slice(0, 12),
    });
  } catch (err) {
    log.error({ err: String(err), userId: resolveUserId(req) }, 'Failed to get usage');
    res.status(500).json({ error: 'Failed to get usage' });
  }
});

/**
 * GET /api/v1/usage/:repo
 *
 * Returns usage for a specific repository.
 */
router.get('/:repo', async (req: Request, res: Response) => {
  try {
    const userId = resolveUserId(req);
    const repoId = req.params.repo;
    const t = getTracker();

    const usage = t.getUsage(userId, repoId);
    const repoUsage = t.getRepoUsage(userId, repoId);

    res.json({
      userId,
      repoId,
      ...usage,
      recentMonths: repoUsage.slice(0, 12),
    });
  } catch (err) {
    log.error(
      { err: String(err), userId: resolveUserId(req), repo: req.params.repo },
      'Failed to get repo usage',
    );
    res.status(500).json({ error: 'Failed to get repo usage' });
  }
});

export { router as usageRouter };
