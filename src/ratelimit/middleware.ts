/**
 * Express rate limit middleware.
 *
 * Checks per-account and per-repo rate limits on incoming webhook requests
 * and adds standard rate limit headers to every API response.
 *
 * ── Headers added ───────────────────────────────────────────────────────────
 *   X-RateLimit-Limit       - Max requests in the current window
 *   X-RateLimit-Remaining   - Remaining requests in the current window
 *   X-RateLimit-Reset       - Unix timestamp (ms) when the window resets
 *   X-RateLimit-Strategy    - Which rate limiting strategy is in effect
 *
 * On 429:
 *   Retry-After             - Seconds until the client can retry
 * ────────────────────────────────────────────────────────────────────────────
 */

import type { NextFunction, Request, Response } from 'express';
import { rateLimiter } from './limiter.js';
import { getRateLimitForAccount } from './tiers.js';
import { rootLogger } from '../utils/logger.js';
import { recordRejectedRun } from '../bridge/metrics.js';

const log = rootLogger.child({ module: 'rate-middleware' });

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RateLimitMiddlewareOptions {
  /** Whether to skip rate limiting (e.g. in dev mode). */
  skip?: boolean;
  /** Account ID extractor — defaults to `res.locals.installationId`. */
  getAccountId?: (req: Request, res: Response) => number | undefined;
  /** Repo identifier extractor — defaults to `res.locals.repo`. */
  getRepo?: (req: Request, res: Response) => string | undefined;
}

// ---------------------------------------------------------------------------
// Default extractors
// ---------------------------------------------------------------------------

function defaultGetAccountId(_req: Request, res: Response): number | undefined {
  return res.locals.installationId as number | undefined;
}

function defaultGetRepo(_req: Request, res: Response): string | undefined {
  return res.locals.repo as string | undefined;
}

// ---------------------------------------------------------------------------
// Rate limit response helpers
// ---------------------------------------------------------------------------

/**
 * Apply rate limit headers to the response.
 */
function applyHeaders(
  res: Response,
  headers: {
    limit: number;
    remaining: number;
    reset: number;
    strategy: string;
  },
): void {
  res.setHeader('X-RateLimit-Limit', String(headers.limit));
  res.setHeader('X-RateLimit-Remaining', String(headers.remaining));
  res.setHeader('X-RateLimit-Reset', String(headers.reset));
  res.setHeader('X-RateLimit-Strategy', headers.strategy);
}

/**
 * Send a 429 Too Many Requests response.
 */
function sendRateLimited(res: Response, retryAfterSeconds: number, strategy: string): void {
  res.setHeader('Retry-After', String(Math.ceil(retryAfterSeconds)));
  res.status(429).json({
    error: 'Too many requests',
    retryAfter: Math.ceil(retryAfterSeconds),
    strategy,
  });
}

// ---------------------------------------------------------------------------
// Middleware factory
// ---------------------------------------------------------------------------

/**
 * Create Express middleware that enforces per-account and per-repo rate limits
 * on webhook routes.
 *
 * Usage:
 *   app.use('/webhook', rateLimitMiddleware());
 *
 * The middleware expects `res.locals.installationId` to be set by an earlier
 * middleware that extracts the GitHub installation ID from the request.
 */
export function rateLimitMiddleware(options?: RateLimitMiddlewareOptions) {
  const skip = options?.skip ?? false;
  const getAccountId = options?.getAccountId ?? defaultGetAccountId;
  const getRepo = options?.getRepo ?? defaultGetRepo;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skip) {
      next();
      return;
    }

    try {
      const installationId = getAccountId(req, res);
      const repo = getRepo(req, res);

      // ── Account-level rate limit ────────────────────────────────────
      if (installationId !== undefined && installationId > 0) {
        const accountLimits = getRateLimitForAccount(installationId);
        const accountResult = await rateLimiter.increment('account', String(installationId), accountLimits.max);

        applyHeaders(res, {
          limit: accountResult.limit,
          remaining: accountResult.remaining,
          reset: accountResult.reset,
          strategy: `account:${installationId}`,
        });

        if (!accountResult.allowed) {
          const retryAfterSeconds = Math.max(1, (accountResult.reset - Date.now()) / 1000);
          log.warn(
            { installationId, current: accountResult.current, limit: accountResult.limit },
            'Account rate limit exceeded',
          );
          recordRejectedRun(String(installationId), 'account_rate_limit');
          sendRateLimited(res, retryAfterSeconds, `account:${installationId}`);
          return;
        }
      }

      // ── Repo-level rate limit ───────────────────────────────────────
      if (repo) {
        const repoMax = config.stas.rateLimit?.repoLimit ?? 5;
        const repoResult = await rateLimiter.increment('repo', repo, repoMax);

        // Repo-level headers are additive — they don't replace account headers
        res.setHeader('X-RateLimit-Repo-Limit', String(repoResult.limit));
        res.setHeader('X-RateLimit-Repo-Remaining', String(repoResult.remaining));
        res.setHeader('X-RateLimit-Repo-Reset', String(repoResult.reset));

        if (!repoResult.allowed) {
          const retryAfterSeconds = Math.max(1, (repoResult.reset - Date.now()) / 1000);
          log.warn(
            { repo, current: repoResult.current, limit: repoResult.limit },
            'Repo rate limit exceeded',
          );
          if (installationId !== undefined && installationId > 0) {
            recordRejectedRun(String(installationId), 'repo_rate_limit');
          }
          sendRateLimited(res, retryAfterSeconds, `repo:${repo}`);
          return;
        }
      }

      next();
    } catch (err) {
      // Fail-open: if the rate limiter itself fails, allow the request
      log.error({ err: String(err) }, 'Rate limit middleware error — allowing request');
      next();
    }
  };
}

/**
 * Per-IP rate limit check for unauthenticated endpoints.
 * Uses the existing express-rate-limit setup — this middleware just adds
 * the consistent header format.
 */
export function addRateLimitHeaders(options?: RateLimitMiddlewareOptions) {
  const skip = options?.skip ?? false;
  const getAccountId = options?.getAccountId ?? defaultGetAccountId;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (skip) {
      next();
      return;
    }

    try {
      const installationId = getAccountId(req, res);

      if (installationId !== undefined && installationId > 0) {
        const accountLimits = getRateLimitForAccount(installationId);
        const result = await rateLimiter.checkLimit('account', String(installationId));

        applyHeaders(res, {
          limit: result.limit,
          remaining: result.remaining,
          reset: result.reset,
          strategy: `account:${installationId}`,
        });
      } else {
        // No account context — just indicate the general rate limit
        res.setHeader('X-RateLimit-Limit', String(30));
        res.setHeader('X-RateLimit-Remaining', String(30));
        res.setHeader('X-RateLimit-Reset', String(Date.now() + 60_000));
        res.setHeader('X-RateLimit-Strategy', 'ip');
      }

      next();
    } catch (err) {
      log.error({ err: String(err) }, 'Rate limit headers middleware error');
      next();
    }
  };
}
