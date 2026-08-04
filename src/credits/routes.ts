/**
 * Credit system REST API routes.
 *
 * ── Endpoints ───────────────────────────────────────────────────────────────
 *   GET    /api/v1/credits/balance       — Current balance for authenticated account
 *   GET    /api/v1/credits/transactions  — Paginated transaction history
 *   POST   /api/v1/credits/top-up        — Initiate credit purchase (Stripe Checkout)
 *   GET    /api/v1/credits/usage         — Usage statistics (daily/weekly/monthly)
 *   POST   /api/v1/admin/credits/adjust  — Admin endpoint to adjust credits
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── Authentication ──────────────────────────────────────────────────────────
 * Regular endpoints authenticate via `x-account-id` header.
 * Admin endpoints require `x-admin-key` header matching the configured key.
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ Zod validation on all request bodies/query params
 * ✅ 400 for validation failures with descriptive messages
 * ✅ 401 for missing/invalid auth
 * ✅ 402 for insufficient credits / payment required
 * ✅ 404 for unknown price IDs
 * ✅ 500 for unexpected errors (logged, no stack leak)
 * ────────────────────────────────────────────────────────────────────────────
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { createCheckoutSession } from '../stripe/checkout.js';
import { CREDIT_PACKS, getCreditPacks } from '../stripe/credit-packs.js';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';
import { requireAuth } from '../auth/middleware.js';

const log = rootLogger.child({ module: 'credits-routes' });

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

export const creditRouter: Router = Router();

creditRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Auth helpers
// ---------------------------------------------------------------------------

/**
 * Extract the authenticated account ID from the request.
 * Reads from `x-account-id` header or JWT user context.
 */
async function getAccountId(req: Request): Promise<number | null> {
  const header = req.headers['x-account-id'];
  if (header) {
    const id = Number(Array.isArray(header) ? header[0] : header);
    if (Number.isFinite(id) && id > 0 && Number.isInteger(id)) return id;
  }
    if (req.user) {
    try {
      const result = await queryWithRetry<{ id: number }>(
        'SELECT id FROM accounts WHERE email = $1 LIMIT 1',
        [req.user.email],
      );
      if (result.rows.length > 0) return result.rows[0].id;
    } catch {
      // DB table may not exist — return null
    }
    return null;
  }
  return null;
}

/**
 * Require a valid account ID. Sends 401 if missing/invalid.
 */
async function requireAccount(req: Request, res: Response): Promise<number | null> {
  const accountId = await getAccountId(req);
  if (!accountId) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Provide x-account-id header or valid JWT token.',
    });
    return null;
  }
  return accountId;
}

function requireAdmin(req: Request, res: Response): boolean {
  const adminKey = req.headers['x-admin-key'];
  const expectedKey = config.admin.apiKey;
  if (!expectedKey) {
    res.status(501).json({
      error: 'Not Implemented',
      message: 'Admin API is not configured. Set ADMIN_API_KEY environment variable to enable.',
    });
    return false;
  }
  if (!adminKey || (Array.isArray(adminKey) ? adminKey[0] : adminKey) !== expectedKey) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Missing or invalid x-admin-key header.',
    });
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Validation schemas
// ---------------------------------------------------------------------------

const PaginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});

const TopUpSchema = z.object({
  priceId: z.string().min(1, 'priceId is required'),
  successUrl: z.string().url('successUrl must be a valid URL'),
  cancelUrl: z.string().url('cancelUrl must be a valid URL'),
});

const AdminAdjustSchema = z.object({
  accountId: z.number().int().positive('accountId must be a positive integer'),
  amount: z.number().int('amount must be an integer').refine((n) => n !== 0, 'amount must not be zero'),
  description: z.string().optional(),
  type: z.enum(['purchase', 'refund', 'adjustment']).default('adjustment'),
});

const UsageSchema = z.object({
  period: z.enum(['daily', 'weekly', 'monthly']).default('monthly'),
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/balance
// ---------------------------------------------------------------------------

/**
 * Get the current credit balance for the authenticated account.
 *
 * Response:
 * ```json
 * {
 *   "accountId": 42,
 *   "balance": 1500,
 *   "lifetimeCredits": 5000
 * }
 * ```
 */
creditRouter.get('/credits/balance', async (req: Request, res: Response) => {
  const accountId = await getAccountId(req);

  // Not authenticated at all → 401
  if (!accountId && !req.user) {
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Provide x-account-id header or valid JWT token.',
    });
    return;
  }

  // Return zero balance if user is authenticated but has no account record yet
  if (!accountId) {
    res.json({ accountId: 0, balance: 0, lifetimeCredits: 0 });
    return;
  }

  try {
    const balance = await creditsRepository.getBalance(accountId);
    res.json({
      accountId: balance.accountId,
      balance: balance.balance,
      lifetimeCredits: balance.lifetimeCredits,
    });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to fetch credit balance');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/packs
// ---------------------------------------------------------------------------

/**
 * Get the available credit packs with config-resolved Stripe price IDs.
 *
 * Response:
 * ```json
 * [
 *   { "credits": 100, "bonus": 0, "priceCents": 1000, "priceId": "price_..." },
 *   { "credits": 500, "bonus": 50, "priceCents": 4500, "priceId": "price_..." },
 *   { "credits": 2000, "bonus": 200, "priceCents": 15000, "priceId": "price_..." }
 * ]
 * ```
 */
creditRouter.get('/credits/packs', (_req: Request, res: Response) => {
  res.json(
    getCreditPacks().map((p) => ({
      credits: p.credits,
      bonus: p.bonus,
      priceCents: p.amount,
      priceId: p.priceId,
    })),
  );
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/transactions
// ---------------------------------------------------------------------------

/**
 * Get paginated transaction history for the authenticated account.
 *
 * Query params:
 *   - limit  (number, 1-100, default 50)
 *   - offset (number, >=0, default 0)
 *
 * Response:
 * ```json
 * {
 *   "transactions": [...],
 *   "pagination": { "limit": 50, "offset": 0, "total": 123 }
 * }
 * ```
 */
creditRouter.get('/credits/transactions', async (req: Request, res: Response) => {
  const accountId = await requireAccount(req, res);
  if (!accountId) return;

  const parsed = PaginationSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid query parameters',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }

  const { limit, offset } = parsed.data;

  try {
    const transactions = await creditsRepository.getTransactions(accountId, limit, offset);

    // Get total count for pagination metadata
    const countResult = await queryWithRetry<{ total: number }>(
      'SELECT COUNT(*)::int AS total FROM credit_transactions WHERE account_id = $1',
      [accountId],
    );
    const total = countResult.rows[0]?.total ?? 0;

    res.json({
      transactions,
      pagination: { limit, offset, total },
    });
  } catch (err) {
    log.error({ err: String(err), accountId }, 'Failed to fetch transactions');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/credits/top-up
// ---------------------------------------------------------------------------

/**
 * Initiate a credit purchase via Stripe Checkout.
 *
 * Body:
 * ```json
 * {
 *   "priceId": "price_500credits",
 *   "successUrl": "https://example.com/success",
 *   "cancelUrl": "https://example.com/cancel"
 * }
 * ```
 *
 * Response:
 * ```json
 * {
 *   "url": "https://checkout.stripe.com/...",
 *   "sessionId": "cs_test_..."
 * }
 * ```
 */
creditRouter.post('/credits/top-up', async (req: Request, res: Response) => {
  const accountId = await requireAccount(req, res);
  if (!accountId) return;

  const parsed = TopUpSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }

  const { priceId, successUrl, cancelUrl } = parsed.data;

  try {
    const session = await createCheckoutSession({
      accountId,
      priceId,
      successUrl,
      cancelUrl,
    });

    log.info(
      { accountId, priceId, sessionId: session.sessionId },
      'Checkout session created for credit top-up',
    );

    res.json({
      url: session.url,
      sessionId: session.sessionId,
    });
  } catch (err) {
    const message = String(err);
    if (message.includes('Unknown price ID')) {
      res.status(404).json({
        error: 'Unknown price ID',
        message,
        validPriceIds: Object.values(CREDIT_PACKS).map((p) => p.priceId),
      });
      return;
    }

    log.error({ err: message, accountId }, 'Failed to create checkout session');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/v1/credits/usage
// ---------------------------------------------------------------------------

/**
 * Get usage statistics — total credits consumed per period.
 *
 * Query params:
 *   - period (enum: "daily" | "weekly" | "monthly", default "monthly")
 *
 * Response:
 * ```json
 * {
 *   "accountId": 42,
 *   "period": "monthly",
 *   "usage": [
 *     { "periodStart": "2025-01-01", "totalCredits": 150, "totalTransactions": 3 },
 *     ...
 *   ]
 * }
 * ```
 */
creditRouter.get('/credits/usage', async (req: Request, res: Response) => {
  const accountId = await requireAccount(req, res);
  if (!accountId) return;

  const parsed = UsageSchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid query parameters',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }

  const { period } = parsed.data;

  // Determine the SQL date truncation based on period
  const dateTrunc = period === 'daily' ? 'day' : period === 'weekly' ? 'week' : 'month';

  try {
    const result = await queryWithRetry<{
      period_start: Date;
      total_credits: number;
      total_transactions: number;
    }>(
      `SELECT
         DATE_TRUNC($1, created_at) AS period_start,
         ABS(SUM(amount))::int AS total_credits,
         COUNT(*)::int AS total_transactions
       FROM credit_transactions
       WHERE account_id = $2 AND amount < 0
       GROUP BY DATE_TRUNC($1, created_at)
       ORDER BY period_start DESC
       LIMIT 12`,
      [dateTrunc, accountId],
    );

    res.json({
      accountId,
      period,
      usage: result.rows.map((row) => ({
        periodStart: row.period_start,
        totalCredits: row.total_credits,
        totalTransactions: row.total_transactions,
      })),
    });
  } catch (err) {
    log.error({ err: String(err), accountId, period }, 'Failed to fetch usage stats');
    res.status(500).json({ error: 'Internal server error' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/v1/admin/credits/adjust
// ---------------------------------------------------------------------------

/**
 * Admin endpoint to manually adjust credits for an account.
 * Requires `x-admin-key` header.
 *
 * Body:
 * ```json
 * {
 *   "accountId": 42,
 *   "amount": 500,
 *   "description": "Customer compensation for outage",
 *   "type": "adjustment"
 * }
 * ```
 *
 * Positive amount = credit (add to balance)
 * Negative amount = debit (deduct from balance)
 *
 * Response:
 * ```json
 * {
 *   "accountId": 42,
 *   "newBalance": 2000,
 *   "amount": 500,
 *   "type": "adjustment",
 *   "description": "Customer compensation for outage"
 * }
 * ```
 */
creditRouter.post('/admin/credits/adjust', async (req: Request, res: Response) => {
  if (!requireAdmin(req, res)) return;

  const parsed = AdminAdjustSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: 'Invalid request body',
      details: parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    });
    return;
  }

  const { accountId, amount, description, type } = parsed.data;

  try {
    let newBalance;

    if (amount > 0) {
      // Credit the account
      const result = await creditsRepository.credit(accountId, amount, {
        type,
        description: description ?? `Admin adjustment: +${amount} credits`,
      });
      newBalance = result.balance;
    } else {
      // Debit the account (positive amount to deduct, since amount is negative)
      const positiveAmount = Math.abs(amount);
      try {
        const result = await creditsRepository.deduct(accountId, positiveAmount, {
          description: description ?? `Admin adjustment: -${positiveAmount} credits`,
        });
        newBalance = result.balance;
      } catch (deductErr) {
        if (deductErr instanceof Error && deductErr.message.includes('Insufficient credits')) {
          res.status(402).json({
            error: 'Insufficient credits',
            message: `Cannot deduct ${positiveAmount} credits. Account ${accountId} has insufficient balance.`,
          });
          return;
        }
        throw deductErr;
      }
    }

    log.info(
      { accountId, amount, type, description, newBalance },
      'Admin credit adjustment applied',
    );

    res.json({
      accountId,
      newBalance,
      amount,
      type,
      description: description ?? null,
    });
  } catch (err) {
    log.error(
      { err: String(err), accountId, amount, type },
      'Failed to apply admin credit adjustment',
    );
    res.status(500).json({ error: 'Internal server error' });
  }
});
