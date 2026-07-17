/**
 * Deduct middleware — checks and deducts credits before each fix run.
 *
 * ── Flow ─────────────────────────────────────────────────────────────────────
 * 1. Extract account ID from the request (body, header, or custom resolver)
 * 2. Look up current credit balance
 * 3. If insufficient → respond 402 with upgrade prompt, do NOT call next()
 * 4. If sufficient → deduct credits, attach deduction info to req, call next()
 * 5. On failure of the downstream handler, call refundCredits() to restore
 * ────────────────────────────────────────────────────────────────────────────
 *
 * ── Error Handling ──────────────────────────────────────────────────────────
 * ✅ Missing account ID → log warn, allow through (no enforcement possible)
 * ✅ DB errors → log error, allow through (degraded behaviour)
 * ✅ Insufficient credits → 402 with clear upgrade CTA and current balance
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { NextFunction, Request, Response } from 'express';
import { creditsRepository } from '../db/repositories/CreditsRepository.js';
import { rootLogger } from '../utils/logger.js';

const log = rootLogger.child({ module: 'credits-middleware' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface DeductOptions {
  /** Amount of credits to deduct for this operation. Defaults to 50. */
  amount?: number;
  /** Optional description recorded in the credit transaction. */
  description?: string;
  /**
   * Custom function to extract the accountId from the request.
   * Defaults to reading `x-account-id` header or `body.accountId`.
   */
  getAccountId?: (req: Request) => number | null;
}

// ---------------------------------------------------------------------------
// Default account ID extractor
// ---------------------------------------------------------------------------

/**
 * Default account-ID extractor.
 * Priority:
 *   1. `x-account-id` header
 *   2. `req.body.accountId`
 *   3. `req.body.installation?.id` (GitHub webhook pattern)
 * Returns null if none found.
 */
export function defaultGetAccountId(req: Request): number | null {
  const header = req.headers['x-account-id'];
  if (header) {
    const id = Number(Array.isArray(header) ? header[0] : header);
    if (Number.isFinite(id) && id > 0) return id;
  }
  if (req.body?.accountId) return Number(req.body.accountId);
  if (req.body?.installation?.id) return Number(req.body.installation.id);
  return null;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Express middleware that checks and deducts credits before a fix run.
 *
 * Usage:
 *   ```ts
 *   import { deductMiddleware } from './credits/index.js';
 *
 *   app.post('/webhook', deductMiddleware({ amount: 50 }), handleWebhook);
 *   ```
 *
 * On success, `req.creditDeduction` is set with the deduction details so
 * downstream handlers (and tests) can inspect what was deducted.
 */
export function deductMiddleware(options?: DeductOptions) {
  const amount = options?.amount ?? 50; // Default 50 credits per fix run
  const description = options?.description ?? 'Fix run credit deduction';
  const getAccountId = options?.getAccountId ?? defaultGetAccountId;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const accountId = getAccountId(req);

    if (!accountId || accountId <= 0) {
      log.warn({ path: req.path }, 'No account ID found for credit deduction — allowing request through');
      next();
      return;
    }

    try {
      // Check balance
      const balance = await creditsRepository.getBalance(accountId);

      if (balance.balance < amount) {
        log.warn(
          { accountId, balance: balance.balance, required: amount },
          'Insufficient credits — rejecting request',
        );

        res.status(402).json({
          error: 'Insufficient credits',
          message: `You need ${amount} credits for this fix run. ` +
            `Your current balance is ${balance.balance} credits. ` +
            'Please top up to continue.',
          balance: balance.balance,
          required: amount,
          missing: amount - balance.balance,
          upgradeUrl: '/api/v1/credits/top-up',
        });
        return;
      }

      // Deduct credits
      const newBalance = await creditsRepository.deduct(accountId, amount, { description });

      // Attach deduction info to request for downstream use and potential refund
      (req as unknown as Record<string, unknown>).creditDeduction = {
        accountId,
        amount,
        previousBalance: balance.balance,
        newBalance: newBalance.balance,
        description,
      };

      log.info(
        { accountId, amount, previousBalance: balance.balance, newBalance: newBalance.balance },
        'Credits deducted for fix run',
      );

      next();
    } catch (err) {
      log.error(
        { err: String(err), accountId, path: req.path },
        'Credit deduction middleware error — allowing request through',
      );
      next();
    }
  };
}

// ---------------------------------------------------------------------------
// Refund utility
// ---------------------------------------------------------------------------

/**
 * Refund credits for a failed fix run.
 *
 * Call this from your error handler or catch block when a fix run fails
 * after credits have already been deducted.
 *
 * Usage:
 *   ```ts
 *   import { refundCredits } from './credits/index.js';
 *
 *   try {
 *     await runFix();
 *   } catch (err) {
 *     await refundCredits(req.creditDeduction);
 *   }
 *   ```
 */
export async function refundCredits(deduction: {
  accountId: number;
  amount: number;
  description?: string;
}): Promise<void> {
  if (!deduction || !deduction.accountId || deduction.amount <= 0) {
    log.warn({ deduction }, 'Invalid refund request — skipping');
    return;
  }

  try {
    await creditsRepository.credit(deduction.accountId, deduction.amount, {
      type: 'refund',
      description: deduction.description
        ? `Refund: ${deduction.description}`
        : 'Refund for failed fix run',
    });
    log.info(
      { accountId: deduction.accountId, amount: deduction.amount },
      'Credits refunded for failed fix run',
    );
  } catch (err) {
    log.error(
      { err: String(err), accountId: deduction.accountId, amount: deduction.amount },
      'Failed to refund credits — manual reconciliation required',
    );
  }
}

// Extend Express Request to include creditDeduction
declare global {
  namespace Express {
    interface Request {
      creditDeduction?: {
        accountId: number;
        amount: number;
        previousBalance: number;
        newBalance: number;
        description: string;
      };
    }
  }
}
