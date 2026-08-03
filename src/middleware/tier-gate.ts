/**
 * TierGate — Express middleware for usage-based tier gating.
 *
 * Checks usage before processing fix requests and returns 402 Payment
 * Required with upgrade information if the monthly limit has been exceeded.
 *
 * Response headers:
 *   X-Syntaro-Usage-Remaining — Remaining fixes this month
 *   X-Syntaro-Usage-Limit     — Monthly fix limit
 *   X-Syntaro-Plan            — Current plan name
 *   X-Syntaro-Usage-Reset     — ISO timestamp of next reset
 */

import type { Request, Response, NextFunction } from 'express';
import { UsageTracker } from '../core/usage-tracker.js';
import { rootLogger } from '../utils/logger.js';
import { queryWithRetry } from '../db/connection.js';
import { planIdToTier } from '../billing/plans.js';
import type { PlanId } from '../billing/plans.js';

const log = rootLogger.child({ module: 'tier-gate-middleware' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TierGateOptions {
  /** UsageTracker instance. Defaults to a new singleton. */
  tracker?: UsageTracker;
  /** Whether to skip enforcement (e.g. for self-hosted mode). */
  skipEnforcement?: boolean;
  /** Upgrade URL to include in 402 responses. */
  upgradeUrl?: string;
}

// ---------------------------------------------------------------------------
// Singleton
// ---------------------------------------------------------------------------

let defaultTracker: UsageTracker | null = null;

function getDefaultTracker(): UsageTracker {
  if (!defaultTracker) {
    defaultTracker = new UsageTracker();
  }
  return defaultTracker;
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create a tier gate middleware that checks monthly usage limits before
 * allowing fix requests to proceed.
 *
 * The middleware expects `req.userId` to be set by an earlier authentication
 * layer (e.g., `authMiddleware`). If `userId` is missing, it falls back to
 * the request IP or a generic identifier.
 *
 * @param options  Configuration options for the middleware.
 */
export function createTierGate(options: TierGateOptions = {}) {
  const tracker = options.tracker ?? getDefaultTracker();
  const upgradeUrl = options.upgradeUrl ?? 'https://syntaro.ai/pricing';
  const skip = options.skipEnforcement ?? false;

  return async function tierGate(req: Request, res: Response, next: NextFunction): Promise<void> {
    // In self-hosted mode or when enforcement is disabled, pass through
    if (skip) {
      next();
      return;
    }

    // Resolve user identity
    const userId = resolveUserId(req);
    const repoId = resolveRepoId(req);

    if (!repoId) {
      // No repo context — can't check tier, pass through with a warning
      log.warn({ path: req.path }, 'TierGate: no repoId in request context');
      next();
      return;
    }

    // Resolve plan from users table for SaaS email/password auth path.
    // Falls back to env-based resolution for GitHub OAuth and self-hosted.
    let tierOverride: string | undefined;
    if (userId && userId !== 'anonymous' && userId !== '0') {
      try {
        const userResult = await queryWithRetry<{ plan: string }>(
          'SELECT plan FROM users WHERE id = $1::uuid',
          [userId],
        );
        if (userResult?.rows?.[0]) {
          tierOverride = planIdToTier(userResult.rows[0].plan as PlanId);
        }
      } catch (err) {
        log.warn({ err: String(err), userId }, 'Failed to resolve plan from users table');
      }
    }

    // Check quota before proceeding
    const quota = tracker.checkQuota(userId, repoId, 'fix-run', tierOverride);

    // Get usage summary for headers
    const usage = tracker.getUsage(userId, repoId, tierOverride);

    // Set usage-related response headers
    if (usage.unlimited) {
      res.setHeader('X-Syntaro-Usage-Remaining', 'Unlimited');
    } else {
      res.setHeader('X-Syntaro-Usage-Remaining', String(usage.remaining));
    }
    res.setHeader('X-Syntaro-Usage-Limit', String(usage.monthlyLimit));
    res.setHeader('X-Syntaro-Plan', usage.plan);
    res.setHeader('X-Syntaro-Usage-Reset', usage.resetAt);

    if (!quota.allowed) {
      log.warn(
        {
          userId,
          repoId,
          plan: usage.plan,
          currentMonthUsage: usage.currentMonthUsage,
          monthlyLimit: usage.monthlyLimit,
        },
        'Tier gate blocked fix request',
      );

      res.status(402).json({
        error: 'Payment Required',
        message: quota.reason,
        plan: usage.plan,
        limit: usage.monthlyLimit,
        used: usage.currentMonthUsage,
        remaining: usage.remaining,
        resetAt: usage.resetAt,
        upgradeUrl,
      });
      return;
    }

    next();
  };
}

// ---------------------------------------------------------------------------
// Identity resolution helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the authenticated user ID from the request.
 * Falls back to IP if no auth context is available.
 */
function resolveUserId(req: Request): string {
  // These fields can be set by an auth middleware
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const reqAny = req as any;
  const userId: string | undefined =
    reqAny.userId ?? reqAny.githubUserId ?? req.headers['x-syntaro-user-id'] as string | undefined;

  return userId ?? req.ip ?? 'anonymous';
}

/**
 * Resolve the repository identifier from the request context.
 */
function resolveRepoId(req: Request): string | null {
  // Check path parameters
  const repoParam = req.params.repoId ?? req.params.repo;
  if (repoParam) return repoParam;

  // Check query parameter
  const repoQuery = req.query.repoId as string | undefined;
  if (repoQuery) return repoQuery;

  // Check header
  const repoHeader = req.headers['x-syntaro-repo-id'] as string | undefined;
  if (repoHeader) return repoHeader;

  // Check body
  if (typeof req.body?.repoId === 'string') return req.body.repoId;
  if (typeof req.body?.repo === 'string') return req.body.repo;
  if (typeof req.body?.repository?.full_name === 'string') return req.body.repository.full_name;

  return null;
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

/**
 * Close the default tracker (for graceful shutdown).
 */
export function closeDefaultTracker(): void {
  if (defaultTracker) {
    defaultTracker.close();
    defaultTracker = null;
  }
}
