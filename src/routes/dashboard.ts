/**
 * Dashboard API Routes — endpoints for the React frontend.
 *
 * All routes are mounted at /api/v1/me and provide current account info,
 * usage statistics, and credit transaction history.
 *
 * @module routes/dashboard
 */

import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { accountsRepository } from '../db/repositories/index.js';
import { creditsRepository } from '../db/repositories/index.js';
import { usageRepository } from '../db/repositories/index.js';
import { queryWithRetry } from '../db/connection.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'dashboard-api' });

const router: Router = Router();

// ---------------------------------------------------------------------------
// Rate Limiting: 60 requests per minute per IP on dashboard endpoints
// ---------------------------------------------------------------------------

const dashboardLimiter = rateLimit({
  windowMs: 60_000, // 1 minute
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests', retryAfter: 'see Retry-After header' },
});

router.use(dashboardLimiter);

// ---------------------------------------------------------------------------
// Helper: extract account ID from request
// Uses x-account-id header (set by gateway/auth middleware) or query param
// ---------------------------------------------------------------------------

function getAccountId(req: Request): number | undefined {
  const headerId = req.headers['x-account-id'] as string | undefined;
  if (headerId) {
    const id = Number(headerId);
    if (!Number.isNaN(id)) return id;
  }

  const queryId = req.query.accountId as string | undefined;
  if (queryId) {
    const id = Number(queryId);
    if (!Number.isNaN(id)) return id;
  }

  return undefined;
}

// ---------------------------------------------------------------------------
// GET /api/v1/me — current account info
// ---------------------------------------------------------------------------

router.get('/', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required. Provide x-account-id header or accountId query param.' });
      return;
    }

    const account = await accountsRepository.findById(accountId);
    if (!account) {
      res.status(404).json({ error: 'Account not found' });
      return;
    }

    const balance = await creditsRepository.getBalance(accountId);

    res.json({
      id: account.id,
      githubInstallationId: account.githubInstallationId,
      email: account.email,
      name: account.name,
      tier: account.tier,
      creditBalance: balance.balance,
      lifetimeCredits: balance.lifetimeCredits,
      createdAt: account.createdAt,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch account info');
    res.status(500).json({ error: 'Failed to fetch account info' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/me/usage — usage stats
// ---------------------------------------------------------------------------

router.get('/usage', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const totalCreditsUsed = await usageRepository.totalCreditsUsed(accountId);

    // Current month usage
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthCredits = await usageRepository.creditsUsedInRange(accountId, startOfMonth, now);

    // Monthly stats for last 6 months
    const monthlyStats = await usageRepository.monthlyStats(accountId, 6);

    // Recent usage records
    const recentUsage = await usageRepository.listByAccount(accountId, 20, 0);

    res.json({
      totalCreditsUsed,
      currentMonth: {
        creditsUsed: monthCredits,
        startDate: startOfMonth.toISOString(),
      },
      monthlyStats,
      recentUsage,
    });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch usage stats');
    res.status(500).json({ error: 'Failed to fetch usage stats' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/me/transactions — credit transactions
// ---------------------------------------------------------------------------

router.get('/transactions', async (req: Request, res: Response) => {
  try {
    const accountId = getAccountId(req);
    if (!accountId) {
      res.status(400).json({ error: 'Account identification required.' });
      return;
    }

    const limit = Math.min(Math.abs(Number(req.query.limit) || 50), 200);
    const offset = Math.abs(Number(req.query.offset) || 0);

    const transactions = await creditsRepository.getTransactions(accountId, limit, offset);

    // Get total count
    const countResult = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*) as total FROM credit_transactions WHERE account_id = $1',
      [accountId],
    );
    const total = Number(countResult.rows[0]?.total ?? 0);

    res.json({ transactions, total, limit, offset });
  } catch (err) {
    log.error({ err: String(err) }, 'Failed to fetch transactions');
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});

export { router as dashboardRouter };
